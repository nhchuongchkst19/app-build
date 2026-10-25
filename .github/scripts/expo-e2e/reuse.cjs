const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const runId = process.env.BINARY_RUN;
if (!/^[0-9]+$/.test(runId)) throw Error('binary_run must be numeric');
const run = JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`]));
if (run.path !== '.github/workflows/expo-e2e.yml' || run.event !== 'workflow_dispatch' || run.status !== 'completed') {
  throw Error('Reuse requires a completed manually dispatched Expo Build and Test run');
}
// A UI-test failure does not invalidate the binary uploaded before the tests.
gh(['run', 'download', runId, '--repo', process.env.GITHUB_REPOSITORY,
  '--name', `expo-e2e-${process.env.PLATFORM}`, '--dir', 'binary']);
const manifest = JSON.parse(fs.readFileSync('binary/manifest.json'));
const expectedFile = process.env.PLATFORM === 'android' ? 'app.apk' : 'app.tar.gz';
if (manifest.schema !== 1 || manifest.platform !== process.env.PLATFORM || manifest.appId !== process.env.APP_ID
  || manifest.repository !== `${process.env.APP_OWNER}/${process.env.APP_REPO}`
  || manifest.runId !== runId || manifest.artifact !== expectedFile) {
  throw Error('Binary provenance does not match the selected app, platform or run');
}
const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join('binary', expectedFile))).digest('hex');
if (digest !== manifest.sha256) throw Error('Binary checksum mismatch');
