import type { AuditEntry, AuditOutcome, SecurityEvent } from '@conduit/core';
import type { Page } from '../../pagination.js';
import type { AuditLogRepository, AuditQuery, NewAuditEntry } from '../../repositories.js';
import type { Queryable } from './queryable.js';
import { clampLimit, decodeCursor, encodeCursor } from './rowMappers.js';

const COLS =
  'id, agent_id, host_id, event_type, capability, connection_id, operation, ' +
  'outcome, args_hash, duration_ms, created_at';

type Row = {
  id: string;
  agent_id: string | null;
  host_id: string | null;
  event_type: string;
  capability: string | null;
  connection_id: string | null;
  operation: string | null;
  outcome: AuditOutcome;
  args_hash: string | null;
  duration_ms: number | null;
  created_at: Date;
};

function map(r: Row): AuditEntry {
  return {
    id: r.id,
    agentId: r.agent_id,
    hostId: r.host_id,
    eventType: r.event_type,
    capability: r.capability,
    connectionId: r.connection_id,
    operation: r.operation,
    outcome: r.outcome,
    argsHash: r.args_hash,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: () => Queryable) {}

  async append(entry: NewAuditEntry): Promise<void> {
    await this.db().query(
      `INSERT INTO audit_log
         (agent_id, host_id, event_type, capability, connection_id, operation, outcome, args_hash, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.agentId,
        entry.hostId,
        entry.eventType,
        entry.capability,
        entry.connectionId,
        entry.operation,
        entry.outcome,
        entry.argsHash,
        entry.durationMs,
      ],
    );
  }

  async query(filter: AuditQuery): Promise<Page<AuditEntry>> {
    const limit = clampLimit(filter.limit);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId) {
      params.push(filter.agentId);
      conds.push(`agent_id = $${params.length}`);
    }
    if (filter.outcome) {
      params.push(filter.outcome);
      conds.push(`outcome = $${params.length}`);
    }
    if (filter.cursor) {
      const { ts, id } = decodeCursor(filter.cursor);
      params.push(ts);
      const tsParam = params.length;
      params.push(id);
      conds.push(`(created_at, id) < ($${tsParam}::timestamptz, $${params.length}::uuid)`);
    }
    params.push(limit + 1);
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(map);
    const last = items[items.length - 1];
    return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  async recordSecurityEvent(_event: Omit<SecurityEvent, 'id' | 'createdAt'>): Promise<void> {
    // No dedicated security_events table yet; security events surface via the logger for now.
  }
}
