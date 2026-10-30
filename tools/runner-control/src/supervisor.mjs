import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DefaultArtifactClient } from '@actions/artifact';
import { deriveToken } from './auth.mjs';
import { createWorker } from './worker.mjs';

const identity = { repository: process.env.GITHUB_REPOSITORY, sessionId: process.env.SESSION_ID,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1' };
const stateDir = path.resolve(process.env.SESSION_STATE_DIR);
const token = deriveToken(process.env.RUNNER_KEY, identity);
console.log(`::add-mask::${token}`);
delete process.env.RUNNER_KEY;
let tunnel, stopping = false, generation = 0, retryTimer, readyTimer;
const worker = await createWorker({ token, identity, workspace: process.env.GITHUB_WORKSPACE,
  stateDir, port: 8787,
  idleMs: Number(process.env.IDLE_MINUTES || 15) * 60000,
  maxMs: Number(process.env.MAX_MINUTES || 120) * 60000,
  onFinish: async summary => {
    stopping = true; clearTimeout(retryTimer); clearTimeout(readyTimer);
    tunnel?.kill('SIGTERM');
    await fs.writeFile(path.join(stateDir, 'exit-code'), summary.result === 'passed' ? '0' : '1');
    process.exitCode = summary.result === 'passed' ? 0 : 1;
    console.log(`Session finished: ${summary.result}`);
  },
});
if (process.env.PREPARE_APP === 'true') {
  const preparation = await worker.rpc('exec.start', {
    command: 'node builder/.github/scripts/runner-control/prepare-app.cjs', timeoutMs: 1200000,
  });
  console.log(`Initial app preparation process: ${preparation.processId}`);
}
async function publish(url) {
  const endpoint = { ...identity, url, generation: ++generation, publishedAt: new Date().toISOString(),
    appRepository: process.env.APP_OWNER + '/' + process.env.APP_REPO,
    sourceSha: process.env.APP_SOURCE_SHA, workspace: process.env.GITHUB_WORKSPACE };
  const dir = path.join(stateDir, `endpoint-${generation}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'endpoint.json');
  await fs.writeFile(file, JSON.stringify(endpoint, null, 2));
  await fs.writeFile(path.join(stateDir, 'endpoint.json'), JSON.stringify(endpoint, null, 2));
  await new DefaultArtifactClient().uploadArtifact(`runner-${identity.sessionId}-endpoint-${String(generation).padStart(4, '0')}`,
    [file], dir, { retentionDays: 1 });
  console.log(`Session endpoint published (generation ${generation}): ${url}`);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\nSession \`${identity.sessionId}\`, endpoint generation ${generation}: ${url}\n`);
}
function startTunnel() {
  if (stopping) return;
  let buffer = '', published = false;
  const child = spawn(process.env.CLOUDFLARED_BIN || 'cloudflared',
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${worker.port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  tunnel = child;
  readyTimer = setTimeout(() => { if (!published) child.kill(); }, 90000);
  const read = data => {
    const text = data.toString(); process.stdout.write(text);
    buffer = (buffer + text).slice(-10000);
    const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (url && !published) {
      published = true; clearTimeout(readyTimer);
      publish(url[0]).catch(async error => {
        console.error('Endpoint publication failed:', error.message);
        await worker.finish('failed', 'Unable to publish endpoint artifact');
      });
    }
  };
  child.stdout.on('data', read); child.stderr.on('data', read);
  child.on('error', error => console.error('Tunnel:', error.message));
  child.on('close', () => {
    clearTimeout(readyTimer);
    if (!stopping) { console.log('Tunnel exited; replacing endpoint'); retryTimer = setTimeout(startTunnel, 2000); }
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => worker.finish('failed', `Supervisor received ${signal}`));
startTunnel();
