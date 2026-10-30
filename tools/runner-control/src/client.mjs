import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { deriveToken } from './auth.mjs';

export class RunnerClient extends EventEmitter {
  constructor(endpoint, key, { refreshEndpoint, maxAttempts = 12, retryBaseMs = 500, retryMaxMs = 5000 } = {}) {
    super(); this.endpoint = endpoint; this.key = key;
    this.token = deriveToken(key, endpoint); this.pending = new Map();
    this.refreshEndpoint = refreshEndpoint;
    this.maxAttempts = maxAttempts; this.retryBaseMs = retryBaseMs; this.retryMaxMs = retryMaxMs;
  }
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const url = new URL('/control', this.endpoint.url); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.token}` }, handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 });
      this.ws = ws;
      ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(pending.timer);
          msg.error ? pending.reject(Error(msg.error.message)) : pending.resolve(msg.result);
        } else this.emit('event', msg);
      });
      ws.once('open', resolve); ws.once('error', reject);
      ws.on('error', () => {});
      ws.on('close', () => {
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Socket disconnected; retry with same request id')); }
        this.pending.clear(); this.emit('disconnected');
      });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async call(method, params = {}, id = randomUUID()) {
    // Retry only transport failures, keeping the same id for exactly-once side effects within this session.
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        await this.connect();
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(id); reject(Error('RPC transport timeout'));
          }, 30000);
          this.pending.set(id, { resolve, reject, timer });
          this.ws.send(JSON.stringify({ id, method, params }), error => {
            if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
          });
        });
      } catch (error) {
        if (attempt === this.maxAttempts - 1 || !/disconnected|timeout|timed out|socket hang up|ECONN|ENOTFOUND|EAI_AGAIN|Unexpected server response: (502|503|530)/i.test(error.message)) throw error;
        this.ws?.terminate();
        await new Promise(r => setTimeout(r, Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** attempt)));
        if (this.refreshEndpoint) {
          const endpoint = await this.refreshEndpoint();
          if (endpoint) {
            this.endpoint = endpoint;
            this.token = deriveToken(this.key, endpoint);
          }
        }
      }
    }
  }
  async wait(processId, { output = true, pollMs = 1500, timeoutMs = 7200000 } = {}) {
    const started = Date.now(); let cursor = 0;
    while (Date.now() - started < timeoutMs) {
      let replay;
      do {
        replay = await this.call('events.since', { after: cursor, limit: 250 });
        if (replay.truncated && cursor) this.emit('gap', replay);
        for (const event of replay.events) {
          if (event.type === 'exec.output' && event.processId === processId && output) process.stdout.write(event.data);
          cursor = event.seq;
        }
        if (!replay.events.length) cursor = replay.latestSeq;
      } while (cursor < replay.latestSeq);
      const item = await this.call('exec.get', { processId });
      if (!item.running) return item;
      await new Promise(r => setTimeout(r, pollMs));
    }
    throw Error('Client wait timeout; remote process may still be running');
  }
  headers() { return { Authorization: `Bearer ${this.token}` }; }
  fileUrl(remotePath) { const url = new URL('/files', this.endpoint.url); url.searchParams.set('path', remotePath); return url; }
  close() { this.ws?.close(); }
}
