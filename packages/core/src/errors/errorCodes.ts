import type { Constraint } from '../types/capability.js';

/**
 * AAP standardized error codes (§5.13).
 * VALUES are wire constants (snake_case) fixed by the spec; the KEYS are camelCase for our code.
 */
export const ErrorCode = {
  invalidRequest: 'invalid_request',
  invalidJwt: 'invalid_jwt',
  unknownConstraintOperator: 'unknown_constraint_operator',
  capabilityNotGranted: 'capability_not_granted',
  constraintViolated: 'constraint_violated',
  limitExceeded: 'limit_exceeded',
  agentRevoked: 'agent_revoked',
  agentExpired: 'agent_expired',
  agentPending: 'agent_pending',
  agentRejected: 'agent_rejected',
  agentClaimed: 'agent_claimed',
  absoluteLifetimeExceeded: 'absolute_lifetime_exceeded',
  hostRevoked: 'host_revoked',
  hostPending: 'host_pending',
  unauthorized: 'unauthorized',
  rateLimited: 'rate_limited',
  internalError: 'internal_error',
  unsupportedMode: 'unsupported_mode',
  unsupportedAlgorithm: 'unsupported_algorithm',
  invalidCapabilities: 'invalid_capabilities',
  agentExists: 'agent_exists',
  alreadyGranted: 'already_granted',
  agentNotFound: 'agent_not_found',
  hostNotFound: 'host_not_found',
  capabilityNotFound: 'capability_not_found',
  authenticationRequired: 'authentication_required',
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeKey];

/** A single constraint violation, surfaced in the `violations` array. */
export interface ConstraintViolation {
  field: string;
  constraint: Constraint;
  actual: unknown;
}

/** Standard error envelope (AAP §5.13) plus optional structured fields. */
export interface ErrorEnvelope {
  error: ErrorCodeValue;
  message: string;
  violations?: ConstraintViolation[];
  invalidCapabilities?: string[];
  unknownOperators?: string[];
  [extra: string]: unknown;
}

/**
 * Canonical error thrown across all pillars. Carries an AAP code + HTTP status;
 * the error-handling middleware serializes it to the standard envelope.
 */
export class ConduitError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;
  readonly fields: Record<string, unknown>;

  constructor(
    code: ErrorCodeValue,
    message: string,
    httpStatus = 400,
    fields: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ConduitError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.fields = fields;
  }

  /** Serialize to the wire envelope. */
  toEnvelope(): ErrorEnvelope {
    return { error: this.code, message: this.message, ...this.fields };
  }
}
