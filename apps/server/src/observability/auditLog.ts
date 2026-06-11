import type { AuditOutcome } from '@conduit/core';

/** A single audit record (raw args are hashed before this is built). */
export interface AuditRecord {
  agentId: string | null;
  hostId: string | null;
  eventType: string;
  capability?: string;
  connectionId?: string;
  operation?: string;
  outcome: AuditOutcome;
  args?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * AuditLog — per-agent structured audit trail.
 * `hashArgs` produces the ONLY representation of request args that is ever persisted.
 * @remarks Stub.
 */
export interface AuditLog {
  record(entry: AuditRecord): Promise<void>;
  /** Stable hash of request args — raw values are discarded. */
  hashArgs(args: Record<string, unknown>): string;
}
