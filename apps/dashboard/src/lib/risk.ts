/** Risk scoring heuristic for capability grants — drives the blast-radius view + badges. */
export type RiskLevel = 'high' | 'med' | 'low';

const WRITE = /(create|send|post|delete|update|write|rotate|revoke|remove|put|patch|add|merge|deploy)/i;
const READ = /(list|get|search|read|describe|fetch|query|status|view)/i;

/** Score a single grant by its operation/capability (write ≫ read). */
export function grantRisk(operation: string | null, capability: string): { level: RiskLevel; score: number } {
  const text = `${operation ?? ''} ${capability}`;
  if (WRITE.test(text)) {
    return { level: 'high', score: 3 };
  }
  if (READ.test(text)) {
    return { level: 'low', score: 1 };
  }
  return { level: 'med', score: 2 };
}

/** Blast radius = summed risk of an agent's active grants, bucketed for a badge. */
export function blastRadius(scores: number[]): { total: number; level: RiskLevel } {
  const total = scores.reduce((a, b) => a + b, 0);
  const level: RiskLevel = total >= 8 ? 'high' : total >= 3 ? 'med' : 'low';
  return { total, level };
}
