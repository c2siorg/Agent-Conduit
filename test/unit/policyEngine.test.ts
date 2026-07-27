import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PolicyConfig } from '../../packages/core/src/types/policy.ts';
import { createPolicyEngine } from '../../apps/server/src/policy/policyEngine.ts';
import { riskLevel } from '../../apps/server/src/policy/risk.ts';

const ctx = (o: Partial<Parameters<ReturnType<typeof createPolicyEngine>['evaluate']>[0]>) => ({
  agentMode: 'delegated',
  capability: 'send_message',
  platform: 'slack',
  operation: 'post_message',
  risk: 'high' as const,
  ...o,
});

describe('risk heuristic', () => {
  it('ranks writes high, reads low, unknown medium', () => {
    assert.equal(riskLevel('post_message', 'send'), 'high');
    assert.equal(riskLevel('delete', 'x'), 'high');
    assert.equal(riskLevel('list_channels', 'read'), 'low');
    assert.equal(riskLevel('frobnicate', 'do_thing'), 'med');
  });
});

describe('policy engine', () => {
  it('allows everything when disabled', () => {
    const e = createPolicyEngine((): PolicyConfig => ({ enabled: false, defaultEffect: 'deny', rules: [] }));
    assert.equal(e.evaluate(ctx({})).effect, 'allow');
  });

  it('first matching rule wins; falls back to default', () => {
    const cfg: PolicyConfig = {
      enabled: true,
      defaultEffect: 'allow',
      rules: [
        { id: 'no-autonomous-writes', effect: 'deny', agentModes: ['autonomous'], minRisk: 'high' },
        { id: 'slack-ok', effect: 'allow', platforms: ['slack'] },
      ],
    };
    const e = createPolicyEngine(() => cfg);
    // autonomous + high risk -> denied by first rule
    assert.deepEqual(e.evaluate(ctx({ agentMode: 'autonomous' })), { effect: 'deny', ruleId: 'no-autonomous-writes' });
    // delegated slack -> allowed by second rule
    assert.deepEqual(e.evaluate(ctx({ agentMode: 'delegated' })), { effect: 'allow', ruleId: 'slack-ok' });
    // no rule matches -> default
    assert.deepEqual(e.evaluate(ctx({ platform: 'github', agentMode: 'delegated' })), { effect: 'allow', ruleId: null });
  });

  it('risk-gates: require_approval for any high-risk op', () => {
    const e = createPolicyEngine((): PolicyConfig => ({
      enabled: true,
      defaultEffect: 'allow',
      rules: [{ id: 'gate-high-risk', effect: 'require_approval', minRisk: 'high' }],
    }));
    assert.equal(e.evaluate(ctx({ risk: 'high' })).effect, 'require_approval');
    assert.equal(e.evaluate(ctx({ risk: 'low' })).effect, 'allow'); // default (rule doesn't match)
  });

  it('capability/operation wildcards match', () => {
    const e = createPolicyEngine((): PolicyConfig => ({
      enabled: true,
      defaultEffect: 'deny',
      rules: [{ id: 'allow-all-reads', effect: 'allow', operations: ['*'], minRisk: 'low' }],
    }));
    assert.equal(e.evaluate(ctx({ risk: 'low' })).effect, 'allow');
  });
});
