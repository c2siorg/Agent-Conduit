/**
 * Session slide-forward: an actively-used agent must not expire. The state-check stage slides the session
 * clock forward by sessionTtlSeconds on each valid request (bounding INACTIVITY, not total lifetime), and
 * never extends a revoked/expired agent (the slide runs only after all checks pass).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StateCheckStage } from '../../apps/server/src/auth/stages/stateCheckStage.ts';

function ctxFor(agent: any) {
  return { expectedTyp: 'agent+jwt', host: { status: 'active' }, agent } as any;
}

function storageCapturingTouch() {
  const calls: Array<{ id: string; at: Date }> = [];
  const storage = { agents: { touchSession: async (id: string, at: Date) => { calls.push({ id, at }); } } } as any;
  return { storage, calls };
}

describe('state check — session slide-forward', () => {
  it('slides the session clock forward when the agent is valid and a TTL is configured', async () => {
    const { storage, calls } = storageCapturingTouch();
    const soon = new Date(Date.now() + 5_000); // valid, but about to expire
    const stage = new StateCheckStage(storage, 3600);
    await stage.execute(ctxFor({ id: 'a1', status: 'active', sessionExpiresAt: soon, maxLifetimeExpiresAt: null, absoluteExpiresAt: null }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.id, 'a1');
    assert.ok(calls[0]!.at.getTime() > Date.now() + 3_000_000, 'session pushed ~1h into the future');
  });

  it('does NOT slide when no TTL is configured (backward compatible)', async () => {
    const { storage, calls } = storageCapturingTouch();
    const stage = new StateCheckStage(storage); // no ttl
    await stage.execute(ctxFor({ id: 'a2', status: 'active', sessionExpiresAt: new Date(Date.now() + 5_000), maxLifetimeExpiresAt: null, absoluteExpiresAt: null }));
    assert.equal(calls.length, 0);
  });

  it('does NOT slide (or keep alive) a revoked agent — throws before the touch', async () => {
    const { storage, calls } = storageCapturingTouch();
    const stage = new StateCheckStage(storage, 3600);
    await assert.rejects(() => stage.execute(ctxFor({ id: 'a3', status: 'revoked' })));
    assert.equal(calls.length, 0);
  });

  it('does NOT slide an already session-expired agent — throws before the touch', async () => {
    const { storage, calls } = storageCapturingTouch();
    const stage = new StateCheckStage(storage, 3600);
    const past = new Date(Date.now() - 10_000);
    await assert.rejects(() => stage.execute(ctxFor({ id: 'a4', status: 'active', sessionExpiresAt: past, maxLifetimeExpiresAt: null, absoluteExpiresAt: null })));
    assert.equal(calls.length, 0);
  });

  it('never touches for a host token (host pipeline ends at the state check)', async () => {
    const { storage, calls } = storageCapturingTouch();
    const stage = new StateCheckStage(storage, 3600);
    await stage.execute({ expectedTyp: 'host+jwt', host: { status: 'active' } } as any);
    assert.equal(calls.length, 0);
  });
});
