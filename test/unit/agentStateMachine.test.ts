import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';
import {
  AGENT_TRANSITIONS,
  canTransitionAgent,
} from '../../apps/server/src/identity/agentStateMachine.ts';

const ALL_STATES = ['pending', 'active', 'expired', 'revoked', 'rejected', 'claimed'] as const;
const TERMINAL = ['revoked', 'rejected', 'claimed'] as const;

describe('agent state machine (AAP §2.3)', () => {
  it('defines all six AAP agent states', () => {
    assert.deepEqual(Object.keys(AGENT_TRANSITIONS).sort(), [...ALL_STATES].sort());
  });

  it('allows the documented lifecycle transitions', () => {
    assert.ok(canTransitionAgent('pending', 'active'));
    assert.ok(canTransitionAgent('pending', 'rejected'));
    assert.ok(canTransitionAgent('active', 'expired'));
    assert.ok(canTransitionAgent('active', 'revoked'));
    assert.ok(canTransitionAgent('active', 'claimed'));
    assert.ok(canTransitionAgent('expired', 'active')); // reactivation
    assert.ok(canTransitionAgent('expired', 'revoked'));
  });

  it('rejects illegal transitions', () => {
    assert.ok(!canTransitionAgent('pending', 'expired'));
    assert.ok(!canTransitionAgent('pending', 'claimed'));
    assert.ok(!canTransitionAgent('active', 'pending'));
    assert.ok(!canTransitionAgent('revoked', 'active'));
    assert.ok(!canTransitionAgent('claimed', 'active'));
  });

  it('treats revoked, rejected, and claimed as terminal (no outgoing transitions)', () => {
    for (const s of TERMINAL) {
      assert.deepEqual(AGENT_TRANSITIONS[s], []);
    }
  });

  it('property: no transition ever leaves a terminal state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL),
        fc.constantFrom(...ALL_STATES),
        (from, to) => canTransitionAgent(from, to) === false,
      ),
    );
  });

  it('property: a state is never reachable from itself (no self-loops)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_STATES), (s) => canTransitionAgent(s, s) === false),
    );
  });
});
