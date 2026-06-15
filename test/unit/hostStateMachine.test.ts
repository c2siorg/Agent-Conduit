import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_TRANSITIONS,
  canTransitionHost,
} from '../../apps/server/src/identity/hostStateMachine.ts';

describe('host state machine (AAP §2.11)', () => {
  it('defines all four AAP host states', () => {
    assert.deepEqual(Object.keys(HOST_TRANSITIONS).sort(), ['active', 'pending', 'rejected', 'revoked']);
  });

  it('allows pending -> active|rejected and active -> revoked', () => {
    assert.ok(canTransitionHost('pending', 'active'));
    assert.ok(canTransitionHost('pending', 'rejected'));
    assert.ok(canTransitionHost('active', 'revoked'));
  });

  it('rejects illegal transitions', () => {
    assert.ok(!canTransitionHost('active', 'pending'));
    assert.ok(!canTransitionHost('revoked', 'active'));
    assert.ok(!canTransitionHost('rejected', 'active'));
    assert.ok(!canTransitionHost('pending', 'revoked'));
  });

  it('treats revoked and rejected as terminal', () => {
    assert.deepEqual(HOST_TRANSITIONS.revoked, []);
    assert.deepEqual(HOST_TRANSITIONS.rejected, []);
  });
});
