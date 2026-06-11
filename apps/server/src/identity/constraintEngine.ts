import type { Constraint, ConstraintViolation } from '@conduit/core';

/**
 * ConstraintEngine — enforces capability constraints (AAP §2.13).
 *
 * Operators: `max` / `min` / `in` / `not_in`. Top-level input fields ONLY (no nested paths).
 * Exact value + operator MUST NOT combine on one field. Unknown operator → `unknown_constraint_operator`
 * (MUST NOT silently ignore). The server MAY narrow but MUST NOT widen — `intersect` takes the
 * intersection of agent-proposed and server-policy constraints.
 */
export interface ConstraintEngine {
  /** Return all violations of `args` against `constraints` (empty array = valid). */
  validate(constraints: Record<string, Constraint>, args: Record<string, unknown>): ConstraintViolation[];
  /** Intersect two constraint sets; rejects any merge that would widen access. */
  intersect(
    a: Record<string, Constraint>,
    b: Record<string, Constraint>,
  ): Record<string, Constraint>;
}

/** Build the default constraint engine. @remarks Stub. */
export function createConstraintEngine(): ConstraintEngine {
  throw new Error('createConstraintEngine not implemented');
}
