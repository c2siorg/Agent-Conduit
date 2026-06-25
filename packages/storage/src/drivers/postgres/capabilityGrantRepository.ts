import type { CapabilityGrant, Constraint, GrantStatus } from '@conduit/core';
import type { CapabilityGrantRepository, NewCapabilityGrant } from '../../repositories.js';
import type { Queryable } from './queryable.js';

const COLS =
  'id, agent_id, capability, connection_id, operation, status, constraints, ' +
  'granted_by, denied_by, reason, expires_at, created_at';

type Row = {
  id: string;
  agent_id: string;
  capability: string;
  connection_id: string | null;
  operation: string | null;
  status: GrantStatus;
  constraints: Record<string, Constraint>;
  granted_by: string | null;
  denied_by: string | null;
  reason: string | null;
  expires_at: Date | null;
  created_at: Date;
};

function map(r: Row): CapabilityGrant {
  return {
    id: r.id,
    agentId: r.agent_id,
    capability: r.capability,
    connectionId: r.connection_id,
    operation: r.operation,
    status: r.status,
    constraints: r.constraints,
    grantedBy: r.granted_by,
    deniedBy: r.denied_by,
    reason: r.reason,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

export class PostgresCapabilityGrantRepository implements CapabilityGrantRepository {
  constructor(private readonly db: () => Queryable) {}

  async upsert(input: NewCapabilityGrant): Promise<CapabilityGrant> {
    // One grant per (agent, capability): an operator's approval replaces a prior pending request, and a
    // re-grant replaces the prior mapping. Callers that need atomicity wrap this in storage.transaction.
    await this.db().query(`DELETE FROM capability_grants WHERE agent_id = $1::uuid AND capability = $2`, [
      input.agentId,
      input.capability,
    ]);
    const { rows } = await this.db().query<Row>(
      `INSERT INTO capability_grants
         (agent_id, capability, connection_id, operation, status, constraints, granted_by, expires_at)
       VALUES ($1::uuid, $2, $3, $4, $5::grant_status, $6::jsonb, $7, $8)
       RETURNING ${COLS}`,
      [
        input.agentId,
        input.capability,
        input.connectionId,
        input.operation,
        input.status,
        JSON.stringify(input.constraints),
        input.grantedBy,
        input.expiresAt,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('capability grant insert returned no row');
    }
    return map(row);
  }

  async findForAgent(agentId: string): Promise<CapabilityGrant[]> {
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM capability_grants WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId],
    );
    return rows.map(map);
  }

  /** The newest active, unexpired grant for (agent, capability). */
  async findActive(agentId: string, capability: string): Promise<CapabilityGrant | null> {
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM capability_grants
       WHERE agent_id = $1 AND capability = $2 AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC LIMIT 1`,
      [agentId, capability],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async setStatus(
    id: string,
    status: GrantStatus,
    deniedBy: string | null,
    reason: string | null,
  ): Promise<void> {
    await this.db().query(
      `UPDATE capability_grants SET status = $2::grant_status, denied_by = $3, reason = $4 WHERE id = $1`,
      [id, status, deniedBy, reason],
    );
  }

  async revokeAllForAgent(agentId: string): Promise<void> {
    await this.db().query(
      `UPDATE capability_grants SET status = 'denied' WHERE agent_id = $1 AND status <> 'denied'`,
      [agentId],
    );
  }
}
