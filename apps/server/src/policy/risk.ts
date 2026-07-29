import type { RiskLevel } from '@conduit/core';

const WRITE = /(create|send|post|delete|update|write|rotate|revoke|remove|put|patch|add|merge|deploy)/i;
const READ = /(list|get|search|read|describe|fetch|query|status|view)/i;

/**
 * Coarse risk level for a request, from its operation + capability name. Writes/destructive verbs rank
 * high, reads low, unknown medium. Used by the policy engine (risk-gated rules) and surfaced on grants.
 */
export function riskLevel(operation: string | null, capability: string): RiskLevel {
  const text = `${operation ?? ''} ${capability}`;
  if (WRITE.test(text)) {
    return 'high';
  }
  if (READ.test(text)) {
    return 'low';
  }
  return 'med';
}

const RANK: Record<RiskLevel, number> = { low: 1, med: 2, high: 3 };

/** Numeric rank for comparisons (low < med < high). */
export function riskRank(level: RiskLevel): number {
  return RANK[level];
}
