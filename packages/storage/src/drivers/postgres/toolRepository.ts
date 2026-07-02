import type { AdapterType, CanonicalSchema, Tool } from '@conduit/core';
import type { Page, PageQuery } from '../../pagination.js';
import type { NewTool, ToolRepository } from '../../repositories.js';
import type { Queryable } from './queryable.js';

const COLS = 'id, name, adapter_type, adapter_config, schema_cache, schema_cached_at';

type Row = {
  id: string;
  name: string;
  adapter_type: AdapterType;
  adapter_config: Record<string, unknown>;
  schema_cache: CanonicalSchema | null;
  schema_cached_at: Date | null;
};

function map(r: Row): Tool {
  return {
    id: r.id,
    name: r.name,
    adapterType: r.adapter_type,
    adapterConfig: r.adapter_config,
    schemaCache: r.schema_cache,
    schemaCachedAt: r.schema_cached_at,
  };
}

/** Postgres-backed {@link ToolRepository}. */
export class PostgresToolRepository implements ToolRepository {
  constructor(private readonly db: () => Queryable) {}

  async upsert(input: NewTool): Promise<Tool> {
    const { rows } = await this.db().query<Row>(
      `INSERT INTO tools (name, adapter_type, adapter_config)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (name) DO UPDATE
         SET adapter_type = EXCLUDED.adapter_type,
             adapter_config = EXCLUDED.adapter_config,
             schema_cache = NULL,
             schema_cached_at = NULL,
             updated_at = now()
       RETURNING ${COLS}`,
      [input.name, input.adapterType, JSON.stringify(input.adapterConfig)],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('tool upsert returned no row');
    }
    return map(row);
  }

  async findByName(name: string): Promise<Tool | null> {
    const { rows } = await this.db().query<Row>(`SELECT ${COLS} FROM tools WHERE name = $1`, [name]);
    return rows[0] ? map(rows[0]) : null;
  }

  async list(page: PageQuery): Promise<Page<Tool>> {
    const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
    const { rows } = await this.db().query<Row>(
      `SELECT ${COLS} FROM tools ORDER BY name ASC LIMIT $1`,
      [limit + 1],
    );
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map(map), hasMore, nextCursor: null };
  }

  async cacheSchema(name: string, schema: Tool['schemaCache'], cachedAt: Date): Promise<void> {
    await this.db().query(
      `UPDATE tools SET schema_cache = $2::jsonb, schema_cached_at = $3, updated_at = now() WHERE name = $1`,
      [name, schema ? JSON.stringify(schema) : null, cachedAt],
    );
  }
}
