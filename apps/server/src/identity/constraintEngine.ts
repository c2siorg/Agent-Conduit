import { ConduitError, ErrorCode } from '@conduit/core';
import type { Constraint, ConstraintObject, ConstraintScalar, ConstraintViolation } from '@conduit/core';

/**
 * ConstraintEngine — enforces capability constraints (AAP §2.13).
 *
 * Operators: `max` / `min` / `in` / `not_in`. Top-level input fields ONLY. Exact value + operator MUST
 * NOT combine on one field. Unknown operator -> `unknown_constraint_operator`. The server MAY narrow but
 * MUST NOT widen; `intersect` takes the intersection of agent-proposed and server-policy constraints.
 */
export interface ConstraintEngine {
  /** Return all violations of `args` against `constraints` (empty array = valid). */
  validate(constraints: Record<string, Constraint>, args: Record<string, unknown>): ConstraintViolation[];
  /** Intersect two constraint sets into the narrower combined set; never widens. */
  intersect(a: Record<string, Constraint>, b: Record<string, Constraint>): Record<string, Constraint>;
}

const KNOWN_OPS: readonly string[] = ['max', 'min', 'in', 'not_in'];

function isScalar(c: Constraint): c is ConstraintScalar {
  return typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean';
}
function isObject(c: Constraint): c is ConstraintObject {
  return typeof c === 'object' && c !== null;
}

/** Reject any operator key outside the spec's set (MUST NOT silently ignore). */
function assertKnownOperators(field: string, c: ConstraintObject): void {
  const unknown = Object.keys(c).filter((k) => !KNOWN_OPS.includes(k));
  if (unknown.length > 0) {
    throw new ConduitError(
      ErrorCode.unknownConstraintOperator,
      `unknown constraint operator(s) on "${field}": ${unknown.join(', ')}`,
      400,
      { unknownOperators: unknown },
    );
  }
}

/** Does `value` satisfy a single constraint? */
function satisfies(c: Constraint, value: unknown): boolean {
  if (isScalar(c)) {
    return value === c;
  }
  if (c.max !== undefined && !(typeof value === 'number' && value <= c.max)) {
    return false;
  }
  if (c.min !== undefined && !(typeof value === 'number' && value >= c.min)) {
    return false;
  }
  if (c.in !== undefined && !c.in.includes(value as ConstraintScalar)) {
    return false;
  }
  if (c.not_in !== undefined && c.not_in.includes(value as ConstraintScalar)) {
    return false;
  }
  return true;
}

function conflict(field: string, a: Constraint, b: Constraint): ConduitError {
  return new ConduitError(
    ErrorCode.invalidRequest,
    `cannot narrow conflicting constraints on "${field}"`,
    400,
    { field, a, b },
  );
}

function intersectField(field: string, a: Constraint, b: Constraint): Constraint {
  if (isObject(a)) {
    assertKnownOperators(field, a);
  }
  if (isObject(b)) {
    assertKnownOperators(field, b);
  }

  // Two exact values: must be identical (an exact is already maximally narrow).
  if (isScalar(a) && isScalar(b)) {
    if (a === b) {
      return a;
    }
    throw conflict(field, a, b);
  }
  // Exact + operator: the exact is narrower, but it must satisfy the operator.
  if (isScalar(a) && isObject(b)) {
    if (satisfies(b, a)) {
      return a;
    }
    throw conflict(field, a, b);
  }
  if (isObject(a) && isScalar(b)) {
    if (satisfies(a, b)) {
      return b;
    }
    throw conflict(field, a, b);
  }

  // Two operator objects: combine to the narrower of each operator.
  const oa = a as ConstraintObject;
  const ob = b as ConstraintObject;
  const merged: ConstraintObject = {};
  const maxes = [oa.max, ob.max].filter((v): v is number => v !== undefined);
  const mins = [oa.min, ob.min].filter((v): v is number => v !== undefined);
  if (maxes.length > 0) {
    merged.max = Math.min(...maxes);
  }
  if (mins.length > 0) {
    merged.min = Math.max(...mins);
  }
  if (oa.in !== undefined && ob.in !== undefined) {
    merged.in = oa.in.filter((v) => ob.in?.includes(v));
  } else if (oa.in !== undefined) {
    merged.in = oa.in;
  } else if (ob.in !== undefined) {
    merged.in = ob.in;
  }
  const notIn = [...(oa.not_in ?? []), ...(ob.not_in ?? [])];
  if (notIn.length > 0) {
    merged.not_in = [...new Set(notIn)];
  }
  return merged;
}

export function createConstraintEngine(): ConstraintEngine {
  return {
    validate(constraints, args) {
      const violations: ConstraintViolation[] = [];
      for (const [field, constraint] of Object.entries(constraints)) {
        if (isObject(constraint)) {
          assertKnownOperators(field, constraint);
        }
        if (!satisfies(constraint, args[field])) {
          violations.push({ field, constraint, actual: args[field] });
        }
      }
      return violations;
    },

    intersect(a, b) {
      const out: Record<string, Constraint> = {};
      const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const field of fields) {
        const ca = a[field];
        const cb = b[field];
        if (ca === undefined) {
          out[field] = cb as Constraint;
        } else if (cb === undefined) {
          out[field] = ca;
        } else {
          out[field] = intersectField(field, ca, cb);
        }
      }
      return out;
    },
  };
}
