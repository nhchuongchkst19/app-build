import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(import.meta.dirname, '../../../.github/scripts/runner-control/prepare-desktop.cjs');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-prepare-'));
  await fs.mkdir(path.join(root, 'app'));
  return root;
}

function run(root, env) {
  return spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('desktop preparation validates framework and project containment', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.match(run(root, { DESKTOP_FRAMEWORK: 'flutter' }).stderr, /must be electron or tauri/);
  assert.match(run(root, { DESKTOP_FRAMEWORK: 'electron', PROJECT_PATH: '../outside' }).stderr, /escapes the app checkout/);
});

test('desktop preparation validates Electron and Tauri project structure before installing', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app/package.json'), JSON.stringify({ dependencies: {} }));
  assert.match(run(root, { DESKTOP_FRAMEWORK: 'electron' }).stderr, /does not declare Electron/);
  assert.match(run(root, { DESKTOP_FRAMEWORK: 'tauri' }).stderr, /requires src-tauri\/Cargo.toml/);
});
