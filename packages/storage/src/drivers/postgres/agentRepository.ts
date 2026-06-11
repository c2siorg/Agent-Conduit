import type { Agent, AgentState } from '@conduit/core';
import type { AgentLifetimes, AgentRepository, NewAgent } from '../../repositories.js';
import type { Queryable } from './queryable.js';
import { mapAgentRow, type AgentRow } from './rowMappers.js';

const COLS =
  'id, host_id, public_key_jwk, jwks_url, status, mode, activated_at, ' +
  'session_expires_at, max_lifetime_expires_at, absolute_expires_at, created_at, updated_at';

/** Postgres-backed {@link AgentRepository}. */
export class PostgresAgentRepository implements AgentRepository {
  constructor(private readonly db: () => Queryable) {}

  async create(input: NewAgent): Promise<Agent> {
    const { rows } = await this.db().query<AgentRow>(
      `INSERT INTO agents (host_id, public_key_jwk, jwks_url, mode, status)
       VALUES ($1::uuid, $2::jsonb, $3, $4::agent_mode, $5::agent_state)
       RETURNING ${COLS}`,
      [
        input.hostId,
        input.publicKeyJwk ? JSON.stringify(input.publicKeyJwk) : null,
        input.jwksUrl,
        input.mode,
        input.status,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('agent insert returned no row');
    }
    return mapAgentRow(row);
  }

  async findById(id: string): Promise<Agent | null> {
    const { rows } = await this.db().query<AgentRow>(`SELECT ${COLS} FROM agents WHERE id = $1`, [id]);
    return rows[0] ? mapAgentRow(rows[0]) : null;
  }

  /** The agent JWT `sub` is the agent id; used for the iss->sub fallback during key rotation (AAP §8.7). */
  async findBySubject(sub: string): Promise<Agent | null> {
    return this.findById(sub);
  }

  async listByHost(hostId: string): Promise<Agent[]> {
    const { rows } = await this.db().query<AgentRow>(
      `SELECT ${COLS} FROM agents WHERE host_id = $1 ORDER BY created_at ASC, id ASC`,
      [hostId],
    );
    return rows.map(mapAgentRow);
  }

  async updateStatus(id: string, status: AgentState): Promise<void> {
    await this.db().query(`UPDATE agents SET status = $2::agent_state, updated_at = now() WHERE id = $1`, [
      id,
      status,
    ]);
  }

  async touchSession(id: string, sessionExpiresAt: Date): Promise<void> {
    await this.db().query(
      `UPDATE agents SET session_expires_at = $2, updated_at = now() WHERE id = $1`,
      [id, sessionExpiresAt],
    );
  }

  async applyLifetimes(id: string, clocks: AgentLifetimes): Promise<void> {
    await this.db().query(
      `UPDATE agents
         SET activated_at = $2,
             session_expires_at = $3,
             max_lifetime_expires_at = $4,
             absolute_expires_at = $5,
             updated_at = now()
       WHERE id = $1`,
      [
        id,
        clocks.activatedAt,
        clocks.sessionExpiresAt,
        clocks.maxLifetimeExpiresAt,
        clocks.absoluteExpiresAt,
      ],
    );
  }
}
