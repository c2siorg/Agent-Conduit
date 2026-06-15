/** Outcome of an audited action. */
export type AuditOutcome = 'success' | 'denied' | 'error';

/**
 * One agent-attributed audit entry.
 * Raw args are NEVER stored — only `argsHash`.
 */
export interface AuditEntry {
  id: string;
  agentId: string | null;
  hostId: string | null;
  eventType: string;
  capability: string | null;
  connectionId: string | null;
  operation: string | null;
  outcome: AuditOutcome;
  /** Stable hash of request args — never the raw values. */
  argsHash: string | null;
  durationMs: number | null;
  createdAt: Date;
}

/** Security-event categories surfaced on the live event stream. */
export type SecurityEventType =
  | 'jtiReplayDetected'
  | 'tokenConfusion'
  | 'signatureInvalid'
  | 'clockSkewRejected'
  | 'constraintViolated'
  | 'rateLimitExceeded'
  | 'revokedPrincipalDenied';

/** A security-relevant event (replay, token confusion, skew, constraint bypass, …). */
export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  agentId: string | null;
  hostId: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}
