import { createHmac, timingSafeEqual } from 'node:crypto';

export function deriveToken(key, identity) {
  if (!key) throw new Error('RUNNER_KEY / repository secret KEY is required');
  const { repository, sessionId, runId, runAttempt } = identity;
  if (![repository, sessionId, runId, runAttempt].every(v => typeof v === 'string' && v.length)) {
    throw new Error('Incomplete session identity');
  }
  return createHmac('sha256', key).update(JSON.stringify([
    'runner-control:v1', repository, sessionId, runId, runAttempt,
  ])).digest('hex');
}

export function authorized(header, token) {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
