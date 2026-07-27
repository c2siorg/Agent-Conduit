import type { PolicyConfig, PolicyContext, PolicyDecision, PolicyRule } from '@conduit/core';
import { riskRank } from './risk.js';

/**
 * PolicyEngine — evaluates a request against an ordered rule set (Conduit extension). First matching rule
 * wins; if none match, the configured default effect applies. Reads its config LIVE so operator changes
 * take effect immediately. When disabled, everything is allowed.
 */
export interface PolicyEngine {
  evaluate(ctx: PolicyContext): PolicyDecision;
}

function listMatches(values: string[] | undefined, actual: string): boolean {
  if (!values || values.length === 0) {
    return true; // omitted condition matches anything
  }
  return values.includes('*') || values.includes(actual);
}

function ruleMatches(rule: PolicyRule, ctx: PolicyContext): boolean {
  return (
    listMatches(rule.agentModes, ctx.agentMode) &&
    listMatches(rule.capabilities, ctx.capability) &&
    listMatches(rule.platforms, ctx.platform) &&
    listMatches(rule.operations, ctx.operation) &&
    (rule.minRisk === undefined || riskRank(ctx.risk) >= riskRank(rule.minRisk))
  );
}

export function createPolicyEngine(getConfig: () => PolicyConfig): PolicyEngine {
  return {
    evaluate(ctx) {
      const config = getConfig();
      if (!config.enabled) {
        return { effect: 'allow', ruleId: null };
      }
      for (const rule of config.rules) {
        if (ruleMatches(rule, ctx)) {
          return { effect: rule.effect, ruleId: rule.id };
        }
      }
      return { effect: config.defaultEffect, ruleId: null };
    },
  };
}
