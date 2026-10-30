import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authorized } from './auth.mjs';
import { normalizeLoadlyRequest } from './loadly.mjs';

const MAX_RPC = 1024 * 1024;
function checkString(v, name) {
  if (typeof v !== 'string' || !v.length || v.includes('\0')) throw Error(`Invalid ${name}`);
  return v;
}
function integer(v, fallback, min, max) {
  const n = v ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw Error(`Expected integer ${min}..${max}`);
  return n;
}
export async function createWorker({ token, identity, workspace, stateDir, port = 0, idleMs = 900000, maxMs = 7200000, onFinish = () => {} }) {
  workspace = path.resolve(workspace);
  await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const clients = new Set(), processes = new Map(), requests = new Map(), events = [];
  let seq = 0, lastActivity = Date.now(), finishing = false, finishPromise, loadlyRelease = null;
  const startedAt = Date.now();
  const resolvePath = value => path.resolve(workspace, checkString(value, 'path'));
  const redact = value => String(value).split(token).join('[REDACTED]');
  const eventLog = fs.createWriteStream(path.join(stateDir, 'events.jsonl'), { mode: 0o600 });
  const send = (ws, msg) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * MAX_RPC) { ws.terminate(); return; }
    ws.send(JSON.stringify(msg));
  };
  function emit(type, data = {}) {
    const event = { type, seq: ++seq, time: new Date().toISOString(), ...data };
    eventLog.write(JSON.stringify(event) + '\n');
    events.push(event);
    if (events.length > 2000) events.shift();
    for (const ws of clients) send(ws, event);
    return event;
  }
  const publicProcess = p => ({ processId: p.id, command: p.command, cwd: p.cwd, pid: p.child.pid,
    pty: p.pty, startedAt: p.startedAt, finishedAt: p.finishedAt, exitCode: p.exitCode,
    signal: p.signal, timedOut: p.timedOut, logPath: p.logPath, running: p.exitCode === undefined && !p.finishedAt });
  function signalProcess(p, signal = 'SIGTERM') {
    if (p.finishedAt) return;
    if (!['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGHUP'].includes(signal)) throw Error('Unsupported signal');
    // PTY children also own a process group on Unix; kill descendants as well.
    try { process.kill(-p.child.pid, signal); } catch (e) {
      if (e.code !== 'ESRCH') throw e;
      try { p.pty ? p.child.kill(signal) : p.child.kill(signal); } catch {}
    }
  }
  function spawnCommand(params) {
    if (processes.size >= 1000) throw Error('Process limit reached (1000/session)');
    const command = checkString(params.command, 'command');
    const cwd = params.cwd ? resolvePath(params.cwd) : workspace;
    const timeoutMs = integer(params.timeoutMs, 600000, 0, 21600000);
    if (params.env !== undefined && (!params.env || typeof params.env !== 'object' || Array.isArray(params.env))) throw Error('env must be an object');
    if (Object.values(params.env || {}).some(v => typeof v !== 'string')) throw Error('env values must be strings');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(RUNNER_KEY|SESSION_TOKEN|GH_TOKEN|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|KEY)$/.test(key)) delete env[key];
    Object.assign(env, params.env || {});
    const pty = params.pty === true;
    const id = randomUUID(), logPath = path.join(stateDir, `${id}.log`);
    const log = fs.createWriteStream(logPath, { mode: 0o600 });
    let child;
    try {
      if (pty) {
        // Loaded lazily so ordinary shell control remains available without native PTY support.
        const ptyModule = ptyLoader();
        child = ptyModule.spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], {
          cwd, env, name: 'xterm-256color', cols: integer(params.cols, 120, 1, 500), rows: integer(params.rows, 40, 1, 500),
        });
      } else child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { log.end(); throw e; }
    const p = { id, command, cwd, child, pty, logPath, startedAt: new Date().toISOString() };
    processes.set(id, p);
    let outputBytes = 0;
    const output = (stream, data) => {
      // Keep UTF-8 intact for streamed pipe output (setEncoding below).
      const text = redact(data);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > 64 * 1024 * 1024) { signalProcess(p, 'SIGKILL'); return; }
      log.write(text);
      for (let offset = 0; offset < text.length; offset += 16384) emit('exec.output', { processId: id, stream, data: text.slice(offset, offset + 16384) });
    };
    const done = (code, signal) => {
      if (p.finishedAt) return;
      p.exitCode = code ?? null; p.signal = signal ?? null; p.finishedAt = new Date().toISOString();
      clearTimeout(p.timer); clearTimeout(p.killTimer); log.end();
      emit('exec.exited', publicProcess(p));
    };
    emit('exec.started', publicProcess(p));
    if (pty) {
      child.onData(data => output('pty', data));
      child.onExit(({ exitCode, signal }) => done(exitCode, signal));
    } else {
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', data => output('stdout', data));
      child.stderr.on('data', data => output('stderr', data));
      child.stdin.on('error', () => {});
      child.on('error', e => { output('stderr', e.message); done(127, null); });
      child.on('close', done);
    }
    if (timeoutMs) p.timer = setTimeout(() => {
      p.timedOut = true; signalProcess(p);
      p.killTimer = setTimeout(() => signalProcess(p, 'SIGKILL'), 2000);
    }, timeoutMs);
    return publicProcess(p);
  }
  async function finish(result = 'failed', reason = '') {
    if (finishPromise) return finishPromise;
    finishing = true;
    finishPromise = (async () => {
      emit('session.finishing', { result, reason });
      for (const p of processes.values()) signalProcess(p);
      await new Promise(resolve => setTimeout(resolve, 300));
      for (const p of processes.values()) signalProcess(p, 'SIGKILL');
      const summary = { ...identity, result, reason, loadly: loadlyRelease, startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(), processes: [...processes.values()].map(publicProcess) };
      await fsp.writeFile(path.join(stateDir, 'result.json'), JSON.stringify(summary, null, 2));
      clearInterval(timer); clearInterval(heartbeat);
      for (const ws of clients) ws.close(1000, 'Session finished');
      setTimeout(() => { for (const ws of clients) ws.terminate(); }, 100).unref();
      await new Promise(resolve => server.close(resolve));
      wss.close(); eventLog.end();
      await onFinish(summary);
      return summary;
    })();
    return finishPromise;
  }
  async function rpc(method, p = {}) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('params must be an object');
    if (finishing) throw Error('Session finishing');
    if (method === 'session.status') return { ...identity, workspace, stateDir, startedAt, lastActivity, seq, loadly: loadlyRelease,
      processes: [...processes.values()].map(publicProcess) };
    if (method === 'release.loadly') {
      const request = await normalizeLoadlyRequest(p, workspace, process.env.PLATFORM);
      if (finishing) throw Error('Session finishing');
      const queued = { ...request, sessionId: identity.sessionId, queuedAt: new Date().toISOString() };
      try {
        await fsp.writeFile(path.join(stateDir, 'loadly-request.json'), JSON.stringify(queued, null, 2), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code === 'EEXIST') throw Error('A Loadly release is already queued for this session');
        throw error;
      }
      loadlyRelease = queued;
      emit('release.queued', queued);
      return { ...queued, status: 'queued', startsAfter: 'finish passed' };
    }
    if (method === 'session.finish') {
      if (!['passed', 'failed'].includes(p.result)) throw Error('result must be passed or failed');
      setTimeout(() => finish(p.result, String(p.reason || '')).catch(console.error), 50);
      return { accepted: true, result: p.result };
    }
    if (method === 'events.since') {
      const after = integer(p.after, 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = integer(p.limit, 100, 1, 250);
      return { events: events.filter(e => e.seq > after).slice(0, limit), oldestSeq: events[0]?.seq ?? seq,
        latestSeq: seq, truncated: !!events.length && after < events[0].seq - 1 };
    }
    if (method === 'exec.start') return spawnCommand(p);
    if (method === 'exec.list') return [...processes.values()].map(publicProcess);
    if (method.startsWith('exec.')) {
      const item = processes.get(p.processId);
      if (!item) throw Error('Unknown processId');
      if (method === 'exec.get') return publicProcess(item);
      if (method === 'exec.signal') { signalProcess(item, p.signal); return publicProcess(item); }
      if (method === 'exec.write') {
        if (item.finishedAt) throw Error('Process has exited');
        const data = typeof p.data === 'string' ? p.data : '';
        item.pty ? item.child.write(data) : item.child.stdin.write(data);
        if (p.eof && !item.pty) item.child.stdin.end();
        return { written: Buffer.byteLength(data) };
      }
      if (method === 'exec.resize') {
        if (!item.pty || item.finishedAt) throw Error('Expected running PTY');
        item.child.resize(integer(p.cols, 120, 1, 500), integer(p.rows, 40, 1, 500));
        return { resized: true };
      }
    }
    if (method === 'fs.read') {
      const handle = await fsp.open(resolvePath(p.path), 'r');
      try {
        const offset = integer(p.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const size = integer(p.length, 65536, 1, 262144), buf = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buf, 0, size, offset);
        return { data: buf.subarray(0, bytesRead).toString(p.encoding === 'base64' ? 'base64' : 'utf8'), bytesRead,
          nextOffset: offset + bytesRead, size: (await handle.stat()).size };
      } finally { await handle.close(); }
    }
    if (method === 'fs.write') {
      const target = resolvePath(p.path);
      if (typeof p.data !== 'string') throw Error('data must be a string');
      const data = Buffer.from(p.data, p.encoding === 'base64' ? 'base64' : 'utf8');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${randomUUID()}.tmp`;
      try { await fsp.writeFile(tmp, data); await fsp.rename(tmp, target); }
      finally { await fsp.rm(tmp, { force: true }); }
      return { path: target, bytes: data.length };
    }
    if (method === 'fs.patch') {
      checkString(p.patch, 'patch');
      const cwd = p.cwd ? resolvePath(p.cwd) : workspace;
      execFileSync('git', ['apply', '--check', '-'], { cwd, input: p.patch, timeout: 10000 });
      execFileSync('git', ['apply', '-'], { cwd, input: p.patch, timeout: 10000 });
      return { applied: true };
    }
    throw Error(`Unknown method: ${method}`);
  }
  const server = http.createServer(async (req, res) => {
    if (!authorized(req.headers.authorization, token)) { res.writeHead(401).end('Unauthorized'); return; }
    if (finishing) { res.writeHead(410).end('Session finished'); return; }
    lastActivity = Date.now();
    let temp;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...identity, ready: true })); return;
      }
      if (url.pathname !== '/files') { res.writeHead(404).end(); return; }
      const target = resolvePath(url.searchParams.get('path'));
      if (req.method === 'GET') {
        const info = await fsp.stat(target);
        if (!info.isFile()) throw Error('Expected file');
        const offset = integer(Number(url.searchParams.get('offset') || 0), 0, 0, info.size);
        const length = integer(Number(url.searchParams.get('length') || Math.max(1, info.size - offset)), 1, 1, 1024 ** 3);
        const count = Math.min(length, info.size - offset);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': count, 'Cache-Control': 'no-store' });
        if (!count) { res.end(); return; }
        await pipeline(fs.createReadStream(target, { start: offset, end: offset + count - 1 }), res);
      } else if (req.method === 'PUT') {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        temp = `${target}.${randomUUID()}.upload`;
        let bytes = 0;
        const limiter = new Transform({ transform(chunk, enc, cb) {
          bytes += chunk.length; cb(bytes > 256 * 1024 * 1024 ? Error('Upload exceeds 256 MiB') : null, chunk);
        } });
        await pipeline(req, limiter, fs.createWriteStream(temp, { mode: 0o600 }));
        await fsp.rename(temp, target); temp = undefined;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ path: target, bytes }));
      } else res.writeHead(405).end();
    } catch (e) {
      if (temp) await fsp.rm(temp, { force: true });
      if (!res.headersSent) res.writeHead(400).end(redact(e.message)); else res.destroy();
    }
  });
  server.requestTimeout = 300000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RPC, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/control' || !authorized(req.headers.authorization, token) || finishing) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    lastActivity = Date.now(); clients.add(ws); ws.alive = true;
    ws.on('error', () => {}); ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => clients.delete(ws));
    send(ws, { type: 'session.connected', ...identity, seq });
    ws.on('message', async data => {
      let msg;
      try {
        msg = JSON.parse(data);
        checkString(msg.id, 'id'); checkString(msg.method, 'method');
        if (msg.id.length > 128) throw Error('id too long');
        lastActivity = Date.now();
        const fingerprint = createHash('sha256').update(JSON.stringify([msg.method, msg.params || {}])).digest('hex');
        // Reads do not need deduplication; retaining every polling response would grow memory for hours.
        if (['session.status', 'events.since', 'exec.get', 'exec.list', 'fs.read'].includes(msg.method)) {
          send(ws, { id: msg.id, result: await rpc(msg.method, msg.params) });
          return;
        }
        let request = requests.get(msg.id);
        if (request && request.fingerprint !== fingerprint) throw Error('Request id already used with different params');
        if (!request) {
          if (requests.size >= 20000) throw Error('Request limit reached (20000/session)');
          request = { fingerprint, promise: Promise.resolve().then(() => rpc(msg.method, msg.params)).then(
            result => ({ id: msg.id, result }), error => ({ id: msg.id, error: { message: redact(error.message) } })) };
          requests.set(msg.id, request);
        }
        send(ws, await request.promise);
      } catch (e) { send(ws, { id: msg?.id || null, error: { message: redact(e.message) } }); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 20000);
  const timer = setInterval(() => {
    if (Date.now() - startedAt > maxMs) finish('failed', 'Maximum session lifetime exceeded').catch(console.error);
    else if (Date.now() - lastActivity > idleMs) finish('failed', 'Idle timeout exceeded').catch(console.error);
  }, Math.min(1000, idleMs));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port, finish, server, processes, rpc };
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ptyLoader = () => require('node-pty');
