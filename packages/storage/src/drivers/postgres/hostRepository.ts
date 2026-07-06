import { jwkThumbprint } from '@conduit/crypto';
import type { Host, HostState, Jwk } from '@conduit/core';
import type { Page, PageQuery } from '../../pagination.js';
import type { HostRepository, NewHost } from '../../repositories.js';
import type { Queryable } from './queryable.js';
import { clampLimit, decodeCursor, encodeCursor, mapHostRow, type HostRow } from './rowMappers.js';

const COLS =
  'id, public_key_jwk, jwks_url, key_thumbprint, user_id, default_capabilities, status, created_at, updated_at';

/** Postgres-backed {@link HostRepository}. Raw SQL stays inside this driver. */
export class PostgresHostRepository implements HostRepository {
  constructor(private readonly db: () => Queryable) {}

  async create(input: NewHost): Promise<Host> {
    // The RFC 7638 thumbprint of an inline key is denormalized for fast `iss` lookups.
    const thumbprint = input.publicKeyJwk ? jwkThumbprint(input.publicKeyJwk) : null;
    const { rows } = await this.db().query<HostRow>(
      `INSERT INTO hosts (public_key_jwk, jwks_url, key_thumbprint, user_id, default_capabilities, status)
       VALUES ($1::jsonb, $2, $3, $4, $5::text[], $6::host_state)
       RETURNING ${COLS}`,
      [
        input.publicKeyJwk ? JSON.stringify(input.publicKeyJwk) : null,
        input.jwksUrl,
        thumbprint,
        input.userId,
        input.defaultCapabilities,
        input.status,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('host insert returned no row');
    }
    return mapHostRow(row);
  }

  async findById(id: string): Promise<Host | null> {
    const { rows } = await this.db().query<HostRow>(`SELECT ${COLS} FROM hosts WHERE id = $1`, [id]);
    return rows[0] ? mapHostRow(rows[0]) : null;
  }

  async findByThumbprint(iss: string): Promise<Host | null> {
    const { rows } = await this.db().query<HostRow>(
      `SELECT ${COLS} FROM hosts WHERE key_thumbprint = $1`,
      [iss],
    );
    return rows[0] ? mapHostRow(rows[0]) : null;
  }

  async updateStatus(id: string, status: HostState): Promise<void> {
    await this.db().query(`UPDATE hosts SET status = $2::host_state, updated_at = now() WHERE id = $1`, [
      id,
      status,
    ]);
  }

  async updatePublicKey(id: string, publicKeyJwk: Jwk): Promise<void> {
    const thumbprint = jwkThumbprint(publicKeyJwk);
    await this.db().query(
      `UPDATE hosts SET public_key_jwk = $2::jsonb, key_thumbprint = $3, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(publicKeyJwk), thumbprint],
    );
  }

  async setUserId(id: string, userId: string | null): Promise<void> {
    await this.db().query(`UPDATE hosts SET user_id = $2, updated_at = now() WHERE id = $1`, [id, userId]);
  }

  async list(page: PageQuery): Promise<Page<Host>> {
    const limit = clampLimit(page.limit);
    let rows: HostRow[];
    if (page.cursor) {
      const { ts, id } = decodeCursor(page.cursor);
      rows = (
        await this.db().query<HostRow>(
          `SELECT ${COLS} FROM hosts WHERE (created_at, id) < ($1::timestamptz, $2::uuid)
           ORDER BY created_at DESC, id DESC LIMIT $3`,
          [ts, id, limit + 1],
        )
      ).rows;
    } else {
      rows = (
        await this.db().query<HostRow>(
          `SELECT ${COLS} FROM hosts ORDER BY created_at DESC, id DESC LIMIT $1`,
          [limit + 1],
        )
      ).rows;
    }
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapHostRow);
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}
