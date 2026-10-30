#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { RunnerClient } from './client.mjs';

const argv = process.argv.slice(2), options = {}, args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--') { args.push(...argv.slice(i + 1)); break; }
  if (argv[i].startsWith('--')) {
    const name = argv[i].slice(2);
    if (['background', 'pty', 'no-prepare'].includes(name)) options[name] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing --${name} value`); options[name] = argv[++i]; }
  } else args.push(argv[i]);
}
const command = args.shift();
const stateRoot = options['state-dir'] || path.join(os.homedir(), '.local/state/runnerctl');
const stateFile = options.state || path.join(stateRoot, 'current.json');
const gh = params => execFileSync('gh', params, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const json = value => console.log(JSON.stringify(value, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function save(state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}
async function discover(state) {
  const data = JSON.parse(gh(['api', `repos/${state.repository}/actions/runs/${state.runId}/artifacts?per_page=100`]));
  const prefix = `runner-${state.sessionId}-endpoint-`;
  const item = data.artifacts.filter(a => !a.expired && a.name.startsWith(prefix)).sort((a, b) => b.id - a.id)[0];
  if (!item) return false;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-endpoint-'));
  try {
    gh(['run', 'download', state.runId, '--repo', state.repository, '--name', item.name, '--dir', temp]);
    const endpoint = JSON.parse(await fs.readFile(path.join(temp, 'endpoint.json'), 'utf8'));
    if (endpoint.repository !== state.repository || endpoint.runId !== state.runId || endpoint.sessionId !== state.sessionId ||
        !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(endpoint.url)) throw Error('Endpoint identity/URL mismatch');
    if (state.runAttempt && state.runAttempt !== endpoint.runAttempt) throw Error('Runner was replaced by a new run attempt; start a fresh session instead of replaying commands');
    Object.assign(state, endpoint); await save(state); return true;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
async function main() {
  if (!command || command === 'help') {
    console.log(`runnerctl start --repo OWNER/APP --ref SHA [--platform android|ios] [--profile development|release] [--app-id ID]
runnerctl status | refresh | exec [--background] [--pty] [--cwd PATH] -- 'shell command'
runnerctl wait PROCESS_ID | logs PROCESS_ID | rpc METHOD 'JSON_PARAMS' [--id REQUEST_ID]
runnerctl upload LOCAL REMOTE | download REMOTE LOCAL | patch LOCAL_PATCH
runnerctl loadly [--profile development] [--path REMOTE_APK_OR_IPA] [--title TEXT]
runnerctl finish passed|failed [--reason TEXT]
Global: --state FILE, --key-file FILE. Credential: RUNNER_KEY (never stored in session state).
start defaults: Android, development, prepare enabled, 120-minute session, 15-minute idle timeout.
For multiple sessions, choose a different --state FILE for each session.`); return;
  }
  if (command === 'start') {
    const repository = options.builder || 'nhchuongchkst19/app-build';
    const app = options.repo;
    if (!app || !/^[\w.-]+\/[\w.-]+$/.test(app)) throw Error('--repo OWNER/APP required');
    const sessionId = randomUUID(), [owner, repo] = app.split('/');
    const inputs = { repo, owner, branch: options.ref || 'main', platform: options.platform || 'android',
      profile: options.profile || 'development', app_id: options['app-id'] || '', session_id: sessionId,
      prepare_app: options['no-prepare'] ? 'false' : 'true', max_minutes: options['max-minutes'] || '120',
      idle_minutes: options['idle-minutes'] || '15', api_level: options['api-level'] || '35' };
    gh(['workflow', 'run', 'expo-agent-session.yml', '--repo', repository, '--ref', options['workflow-ref'] || 'main',
      ...Object.entries(inputs).flatMap(([k, v]) => ['-f', `${k}=${v}`])]);
    console.log(`Dispatched session ${sessionId}`);
    const state = { repository, sessionId };
    const deadline = Date.now() + 15 * 60000;
    while (Date.now() < deadline) {
      if (!state.runId) {
        const runs = JSON.parse(gh(['run', 'list', '--repo', repository, '--workflow', 'expo-agent-session.yml', '--limit', '30',
          '--json', 'databaseId,displayTitle,status,conclusion,url']));
        const run = runs.find(r => r.displayTitle.includes(sessionId));
        if (run) { state.runId = String(run.databaseId); state.runUrl = run.url; await save(state); console.log(run.url); }
      }
      if (state.runId) {
        if (await discover(state)) { json(state); return; }
        const run = JSON.parse(gh(['run', 'view', state.runId, '--repo', repository, '--json', 'status,conclusion']));
        if (run.status === 'completed') throw Error(`Job ended before endpoint publication: ${run.conclusion}; ${state.runUrl}`);
      }
      await sleep(5000);
    }
    throw Error(`Endpoint not ready after 15 minutes; use refresh with --state ${stateFile}`);
  }
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  if (command === 'refresh') { if (!await discover(state)) throw Error('Endpoint not published yet'); json(state); return; }
  const key = options['key-file'] ? (await fs.readFile(options['key-file'], 'utf8')).trim() : process.env.RUNNER_KEY;
  if (!key) throw Error('Set RUNNER_KEY or --key-file (the existing builder KEY)');
  if (!state.url) { if (!await discover(state)) throw Error('Endpoint not ready; use refresh'); }
  const client = new RunnerClient(state, key, { refreshEndpoint: async () => await discover(state) ? state : null });
  async function call(method, params = {}, id = randomUUID()) {
    try { return await client.call(method, params, id); }
    catch (error) {
      if (!/disconnected|timeout|timed out|socket hang up|ECONN|ENOTFOUND|Unexpected server response: (502|503|530)/i.test(error.message)) throw error;
      if (await discover(state)) { client.close(); client.endpoint = state; return client.call(method, params, id); }
      throw error;
    }
  }
  try {
    if (command === 'status') json(await call('session.status'));
    else if (command === 'rpc') json(await call(args[0], JSON.parse(args[1] || '{}'), options.id || randomUUID()));
    else if (command === 'exec') {
      const item = await call('exec.start', { command: args.join(' '), cwd: options.cwd,
        env: options.env ? JSON.parse(options.env) : undefined, pty: !!options.pty,
        timeoutMs: Number(options.timeout ?? 600000) }, options.id || randomUUID());
      if (options.background) json(item);
      else { console.error(`processId=${item.processId}`); const result = await client.wait(item.processId); process.exitCode = result.exitCode ?? 1; }
    } else if (command === 'wait') {
      const result = await client.wait(args[0]); json(result); process.exitCode = result.exitCode ?? 1;
    } else if (command === 'logs') {
      const item = await call('exec.get', { processId: args[0] });
      const response = await fetch(client.fileUrl(item.logPath), { headers: client.headers(), signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error(`Download: ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), process.stdout);
    } else if (command === 'upload') {
      const response = await fetch(client.fileUrl(args[1]), { method: 'PUT', headers: client.headers(),
        body: createReadStream(args[0]), duplex: 'half', signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw Error(`Upload: ${response.status}`); json(await response.json());
    } else if (command === 'download') {
      const response = await fetch(client.fileUrl(args[0]), { headers: client.headers(), signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw Error(`Download: ${response.status}`);
      await fs.mkdir(path.dirname(path.resolve(args[1])), { recursive: true });
      await pipeline(Readable.fromWeb(response.body), createWriteStream(args[1]));
      console.log(path.resolve(args[1]));
    } else if (command === 'patch') json(await call('fs.patch', { patch: await fs.readFile(args[0], 'utf8'), cwd: options.cwd || 'app' }));
    else if (command === 'loadly') json(await call('release.loadly', {
      profile: options.profile || 'development', path: options.path, title: options.title,
    }, options.id || randomUUID()));
    else if (command === 'finish') json(await call('session.finish', { result: args[0], reason: options.reason || '' }));
    else throw Error(`Unknown command ${command}; use help`);
  } finally { client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
