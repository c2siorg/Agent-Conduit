/**
 * Declarative policy (Conduit extension). A readable, ordered rule set evaluated at execution time as a
 * sibling to the capability/constraint check: rules match on subject/resource/context and yield an effect.
 * First matching rule wins; if none match, the configured default effect applies. Every decision is
 * auditable (the matching rule id is recorded).
 */
export type PolicyEffect = 'allow' | 'deny' | 'require_approval';

/** Coarse risk level of a request (write ≫ read). */
export type RiskLevel = 'low' | 'med' | 'high';

/**
 * One policy rule. All present match conditions must hold (AND); omitted conditions match anything.
 * `capabilities`/`platforms`/`operations` accept exact values or `*`.
 */
export interface PolicyRule {
  id: string;
  description?: string;
  effect: PolicyEffect;
  agentModes?: string[];
  capabilities?: string[];
  platforms?: string[];
  operations?: string[];
  /** Matches when the request's risk is at least this level (e.g. `high` to gate destructive ops). */
  minRisk?: RiskLevel;
}

/** The full policy configuration (operator-editable at runtime). */
export interface PolicyConfig {
  enabled: boolean;
  /** Effect when no rule matches. */
  defaultEffect: 'allow' | 'deny';
  rules: PolicyRule[];
}

/** The request under evaluation. */
export interface PolicyContext {
  agentMode: string;
  capability: string;
  platform: string;
  operation: string;
  risk: RiskLevel;
}

/** The engine's verdict. `ruleId` is null when the default effect applied. */
export interface PolicyDecision {
  effect: PolicyEffect;
  ruleId: string | null;
}
