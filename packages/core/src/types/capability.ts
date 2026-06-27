import type { CanonicalSchema } from './tool.js';

/** Constraint operators (AAP §2.13). Wire names are spec constants (e.g. `not_in`), not camelCase. */
export type ConstraintOperator = 'max' | 'min' | 'in' | 'not_in';

export type ConstraintScalar = string | number | boolean;

/** Exact-value OR operator object — the two MUST NOT combine on one field. */
export type Constraint = ConstraintScalar | ConstraintObject;

export interface ConstraintObject {
  max?: number;
  min?: number;
  in?: ConstraintScalar[];
  not_in?: ConstraintScalar[];
}

/** Per-capability grant status. */
export type GrantStatus = 'active' | 'pending' | 'denied';

/**
 * Capability descriptor (AAP §2.12). `name` is opaque snake_case `[a-z0-9_]+`.
 */
export interface Capability {
  name: string;
  description: string;
  /** Execute at a non-default URL — the agent JWT `aud` MUST equal this (AAP §2.12). */
  location?: string;
  input?: CanonicalSchema;
  output?: CanonicalSchema;
  /** Populated only on identity-scoped listings. */
  grantStatus?: GrantStatus;
}

/** Per-capability grant for an agent (AAP §3.3). Constraints key on top-level input fields only. */
export interface CapabilityGrant {
  id: string;
  agentId: string;
  capability: string;
  /** Conduit mapping: which connection + operation this capability invokes (Conduit extension). */
  connectionId: string | null;
  operation: string | null;
  status: GrantStatus;
  constraints: Record<string, Constraint>;
  grantedBy: string | null;
  deniedBy: string | null;
  reason: string | null;
  /** Independent of the agent's session TTL. */
  expiresAt: Date | null;
  createdAt: Date;
}
