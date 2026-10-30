import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { deriveToken } from '../src/auth.mjs';
import { createWorker } from '../src/worker.mjs';
import { RunnerClient } from '../src/client.mjs';

const identity = { repository: 'test/builder', sessionId: 'unique-session', runId: '123', runAttempt: '1' };
const key = 'integration-test-key';
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-test-'));
  const workspace = path.join(dir, 'workspace'); await fs.mkdir(workspace);
  const token = deriveToken(key, identity);
  const worker = await createWorker({ token, identity, workspace, stateDir: path.join(dir, 'state'), ...overrides });
  const endpoint = { ...identity, url: `http://127.0.0.1:${worker.port}` };
  const client = new RunnerClient(endpoint, key);
  t.after(async () => { client.close(); await worker.finish('passed', 'test cleanup'); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, workspace, worker, client, endpoint, token };
}
async function wait(client, id) { return client.wait(id, { output: false, pollMs: 20, timeoutMs: 5000 }); }

test('authentication covers HTTP and WebSocket; token is bound to run attempt', async t => {
  const { endpoint, client, token } = await fixture(t);
  assert.notEqual(token, deriveToken(key, { ...identity, runAttempt: '2' }));
  assert.equal((await fetch(endpoint.url + '/health')).status, 401);
  assert.equal((await fetch(endpoint.url + '/files?path=anything', { method: 'PUT', body: 'no' })).status, 401);
  await assert.rejects(new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint.url.replace('http:', 'ws:') + '/control');
    ws.once('error', reject); ws.once('open', () => { ws.close(); resolve(); });
  }), /401/);
  assert.equal((await client.call('session.status')).runId, identity.runId);
});

test('concurrent duplicate commands execute once and survive disconnect; conflicts rejected', async t => {
  const { client, workspace } = await fixture(t);
  const params = { command: 'sleep 0.1; echo once >> count.txt; echo complete' };
  const [a, b] = await Promise.all([client.call('exec.start', params, 'duplicate'),
    new RunnerClient(client.endpoint, key).call('session.status').then(() => client.call('exec.start', params, 'duplicate'))]);
  assert.equal(a.processId, b.processId);
  // Close all connections, leaving the process on the worker.
  client.ws.terminate(); await new Promise(r => setTimeout(r, 30));
  const result = await wait(client, a.processId);
  assert.equal(result.exitCode, 0);
  assert.equal(await fs.readFile(path.join(workspace, 'count.txt'), 'utf8'), 'once\n');
  assert.equal((await client.call('exec.start', params, 'duplicate')).processId, a.processId);
  await assert.rejects(client.call('exec.start', { command: 'echo changed' }, 'duplicate'), /already used/);
  const replay = await client.call('events.since', { after: 0 });
  assert.ok(replay.events.some(e => e.type === 'exec.output' && e.data.includes('complete')));
});

test('failed command is recoverable; stdin, env and cancellation work', async t => {
  const { client } = await fixture(t);
  const fail = await client.call('exec.start', { command: 'exit 17' });
  assert.equal((await wait(client, fail.processId)).exitCode, 17);
  const read = await client.call('exec.start', { command: 'read -r answer; printf "%s:%s" "$answer" "$VALUE"', env: { VALUE: 'ok' } });
  await client.call('exec.write', { processId: read.processId, data: 'hello\n' });
  const result = await wait(client, read.processId);
  assert.equal(result.exitCode, 0);
  assert.equal((await client.call('fs.read', { path: result.logPath })).data, 'hello:ok');
  const sleeping = await client.call('exec.start', { command: 'sleep 300 & wait', timeoutMs: 0 });
  await client.call('exec.signal', { processId: sleeping.processId, signal: 'SIGKILL' });
  assert.equal((await wait(client, sleeping.processId)).signal, 'SIGKILL');
  const timeout = await client.call('exec.start', { command: 'sleep 300', timeoutMs: 50 });
  assert.equal((await wait(client, timeout.processId)).timedOut, true);
});

test('interactive PTY supports input and resizing', async t => {
  const { client } = await fixture(t);
  const p = await client.call('exec.start', { command: 'read -r answer; echo "reply=$answer"', pty: true });
  await client.call('exec.resize', { processId: p.processId, cols: 100, rows: 30 });
  await client.call('exec.write', { processId: p.processId, data: 'interactive\r' });
  const result = await wait(client, p.processId);
  assert.equal(result.exitCode, 0);
  assert.match((await client.call('fs.read', { path: result.logPath })).data, /reply=interactive/);
});

test('atomic files, binary HTTP transfer, ranged reads and git patch', async t => {
  const { client, workspace } = await fixture(t);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  await client.call('fs.write', { path: 'sample.txt', data: 'before\n' });
  await client.call('fs.patch', { patch: 'diff --git a/sample.txt b/sample.txt\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-before\n+after\n' });
  assert.equal((await client.call('fs.read', { path: 'sample.txt', offset: 1, length: 3 })).data, 'fte');
  const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const put = await fetch(client.fileUrl('nested/binary.bin'), { method: 'PUT', headers: client.headers(), body: binary });
  assert.equal(put.status, 200);
  const get = await fetch(client.fileUrl('nested/binary.bin'), { headers: client.headers() });
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), binary);
  await assert.rejects(client.call('fs.read', { path: 'sample.txt', length: 1000000 }), /integer/);
  await assert.rejects(client.call('exec.start', { command: 'true', timeoutMs: -1 }), /integer/);
});

test('finish records result, stops subprocesses and closes endpoint', async t => {
  const { client, worker, dir } = await fixture(t);
  const p = await client.call('exec.start', { command: 'sleep 300', timeoutMs: 0 });
  await worker.finish('passed', 'all checks passed');
  const summary = JSON.parse(await fs.readFile(path.join(dir, 'state/result.json'), 'utf8'));
  assert.equal(summary.result, 'passed');
  assert.throws(() => process.kill(p.pid, 0), /ESRCH/);
});

test('idle sessions stop without an agent', async t => {
  const { dir } = await fixture(t, { idleMs: 50 });
  await new Promise(r => setTimeout(r, 500));
  const summary = JSON.parse(await fs.readFile(path.join(dir, 'state/result.json'), 'utf8'));
  assert.equal(summary.result, 'failed'); assert.match(summary.reason, /Idle/);
});
