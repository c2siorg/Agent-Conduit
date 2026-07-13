import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { createRateLimiter, rateLimit } from '../../apps/server/src/server/rateLimiter.ts';

describe('fixed-window rate limiter', () => {
  it('allows up to max then blocks with a reset countdown', () => {
    let t = 1000;
    const rl = createRateLimiter(60_000, 2, () => t);
    assert.equal(rl.check('a').allowed, true);
    assert.equal(rl.check('a').allowed, true);
    const blocked = rl.check('a');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0);
    // A different key has its own budget.
    assert.equal(rl.check('b').allowed, true);
    // After the window elapses the budget resets.
    t += 61_000;
    assert.equal(rl.check('a').allowed, true);
  });
});

describe('rate-limit middleware returns 429 + Retry-After', () => {
  let server: any;
  let base = '';

  before(async () => {
    const app = express();
    app.use(rateLimit(createRateLimiter(60_000, 1), () => 'fixed-key'));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.httpStatus ?? 500).json(err.toEnvelope ? err.toEnvelope() : { error: 'internal' });
    });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server?.close());

  it('lets the first request through and blocks the second', async () => {
    assert.equal((await fetch(`${base}/x`)).status, 200);
    const res = await fetch(`${base}/x`);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    assert.equal(((await res.json()) as { error: string }).error, 'rate_limited');
  });
});
