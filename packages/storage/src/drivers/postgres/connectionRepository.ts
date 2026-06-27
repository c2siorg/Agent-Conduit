import type { Connection } from '@conduit/core';
import type { Page, PageQuery } from '../../pagination.js';
import type { ConnectionRepository, NewConnection } from '../../repositories.js';
import type { Queryable } from './queryable.js';
import { clampLimit, decodeCursor, encodeCursor } from './rowMappers.js';

const COLS = 'id, name, platform, credential_encrypted, allowed_operations, created_at';

type Row = {
  id: string;
  name: string;
  platform: string;
  credential_encrypted: Buffer;
  allowed_operations: string[];
  created_at: Date;
};

function map(r: Row): Connection {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    credentialEncrypted: new Uint8Array(r.credential_encrypted),
    allowedOperations: r.allowed_operations,
    createdAt: r.created_at,
  };
}

export class PostgresConnectionRepository implements ConnectionRepository {
  constructor(private readonly db: () => Queryable) {}

  async create(input: NewConnection): Promise<Connection> {
    const { rows } = await this.db().query<Row>(
      `INSERT INTO connections (name, platform, credential_encrypted, allowed_operations)
       VALUES ($1, $2, $3, $4::text[]) RETURNING ${COLS}`,
      [input.name, input.platform, Buffer.from(input.credentialEncrypted), input.allowedOperations],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('connection insert returned no row');
    }
    return map(row);
  }

  async findById(id: string): Promise<Connection | null> {
    const { rows } = await this.db().query<Row>(`SELECT ${COLS} FROM connections WHERE id = $1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  async getEncryptedCredential(id: string): Promise<Uint8Array | null> {
    const { rows } = await this.db().query<{ credential_encrypted: Buffer }>(
      `SELECT credential_encrypted FROM connections WHERE id = $1`,
      [id],
    );
    return rows[0] ? new Uint8Array(rows[0].credential_encrypted) : null;
  }

  async list(page: PageQuery): Promise<Page<Connection>> {
    const limit = clampLimit(page.limit);
    let rows: Row[];
    if (page.cursor) {
      const { ts, id } = decodeCursor(page.cursor);
      rows = (
        await this.db().query<Row>(
          `SELECT ${COLS} FROM connections WHERE (created_at, id) < ($1::timestamptz, $2::uuid)
           ORDER BY created_at DESC, id DESC LIMIT $3`,
          [ts, id, limit + 1],
        )
      ).rows;
    } else {
      rows = (
        await this.db().query<Row>(
          `SELECT ${COLS} FROM connections ORDER BY created_at DESC, id DESC LIMIT $1`,
          [limit + 1],
        )
      ).rows;
    }
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(map);
    const last = items[items.length - 1];
    return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }
}
