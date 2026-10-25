const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const helper = path.resolve('.github/scripts/expo-e2e/reuse.cjs');

function reuse(t, change = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-reuse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'binary'));
  fs.mkdirSync(path.join(dir, 'bin'));
  const data = Buffer.from('synthetic APK test bytes');
  const manifest = {
    schema: 1, repository: 'test-owner/test-app', platform: 'android', appId: 'com.test.app',
    runId: '123', artifact: 'app.apk', sha256: crypto.createHash('sha256').update(data).digest('hex'),
    ...change.manifest,
  };
  fs.writeFileSync(path.join(dir, 'binary/app.apk'), change.corrupt ? 'modified binary' : data);
  fs.writeFileSync(path.join(dir, 'binary/manifest.json'), JSON.stringify(manifest));
  const run = {
    path: '.github/workflows/expo-e2e.yml', event: 'workflow_dispatch', status: 'completed',
    conclusion: 'failure', ...change.run,
  };
  const fake = '#!/usr/bin/env node\nif(process.argv[2]==="api")process.stdout.write(process.env.FAKE_RUN);\n';
  fs.writeFileSync(path.join(dir, 'bin/gh'), fake, { mode: 0o755 });
  return spawnSync(process.execPath, [helper], { cwd: dir, encoding: 'utf8', env: {
    PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FAKE_RUN: JSON.stringify(run),
    BINARY_RUN: change.runId || '123', GITHUB_REPOSITORY: 'builder/repo', PLATFORM: 'android',
    APP_ID: 'com.test.app', APP_OWNER: 'test-owner', APP_REPO: 'test-app',
  } });
}
test('reuse accepts a completed run whose later UI tests failed', t => {
  const r = reuse(t); assert.equal(r.status, 0, r.stderr);
});
test('rejects binaries from a different app or platform', t => {
  for (const manifest of [{ repository: 'other/app' }, { appId: 'com.other.app' }, { platform: 'ios' }, { runId: '999' }]) {
    const r = reuse(t, { manifest }); assert.notEqual(r.status, 0); assert.match(r.stderr, /provenance/);
  }
});
test('rejects modified binary bytes', t => {
  const r = reuse(t, { corrupt: true }); assert.notEqual(r.status, 0); assert.match(r.stderr, /checksum/);
});
test('rejects another workflow, live runs and non-dispatch runs', t => {
  for (const run of [{ path: '.github/workflows/build.yml' }, { status: 'in_progress' }, { event: 'pull_request' }]) {
    const r = reuse(t, { run }); assert.notEqual(r.status, 0); assert.match(r.stderr, /completed manually dispatched/);
  }
});
test('rejects manifest paths that escape binary directory', t => {
  const r = reuse(t, { manifest: { artifact: '../outside.apk' } }); assert.notEqual(r.status, 0); assert.match(r.stderr, /provenance/);
});
test('rejects malformed run ID before invoking gh', t => {
  const r = reuse(t, { runId: '123/other' }); assert.notEqual(r.status, 0); assert.match(r.stderr, /numeric/);
});
