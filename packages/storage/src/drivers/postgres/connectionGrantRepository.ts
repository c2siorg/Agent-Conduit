import type { ConnectionGrant } from '@conduit/core';
import type { ConnectionGrantRepository } from '../../repositories.js';
import type { Queryable } from './queryable.js';

const COLS = 'id, agent_id, connection_id, allowed_operations, rate_limit';

type Row = {
  id: string;
  agent_id: string;
  connection_id: string;
  allowed_operations: string[];
  rate_limit: number | null;
};

function map(r: Row): ConnectionGrant {
  return {
    id: r.id,
    agentId: r.agent_id,
    connectionId: r.connection_id,
    allowedOperations: r.allowed_operations,
    rateLimit: r.rate_limit,
  };
}

/** Postgres-backed {@link ConnectionGrantRepository}. */
export class PostgresConnectionGrantRepository implements ConnectionGrantRepository {
  constructor(private readonly db: () => Queryable) {}

  async upsert(grant: Omit<ConnectionGrant, 'id'>): Promise<ConnectionGrant> {
    const { rows } = await this.db().query<Row>(
      `INSERT INTO connection_grants (agent_id, connection_id, allowed_operations, rate_limit)
       VALUES ($1::uuid, $2::uuid, $3::text[], $4)
       ON CONFLICT (agent_id, connection_id) DO UPDATE
         SET allowed_operations = EXCLUDED.allowed_operations,
             rate_limit = EXCLUDED.rate_limit
       RETURNING ${COLS}`,
      [grant.agentId, grant.connectionId, grant.allowedOperations, grant.rateLimit],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('connection grant upsert returned no row');
    }
    return map(row);
  }

  async findForAgent(agentId: string, connectionId: string): Promise<ConnectionGrant | null> {
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM connection_grants WHERE agent_id = $1 AND connection_id = $2`,
      [agentId, connectionId],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async listByAgent(agentId: string): Promise<ConnectionGrant[]> {
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM connection_grants WHERE agent_id = $1 ORDER BY created_at ASC`,
      [agentId],
    );
    return rows.map(map);
  }

  async delete(agentId: string, connectionId: string): Promise<void> {
    await this.db().query(`DELETE FROM connection_grants WHERE agent_id = $1 AND connection_id = $2`, [
      agentId,
      connectionId,
    ]);
  }
}
