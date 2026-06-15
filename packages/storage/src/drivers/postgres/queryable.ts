import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Minimal query surface shared by a connection pool and a single transaction client.
 * Both `pg.Pool` and `pg.PoolClient` satisfy this, so repositories work the same inside or outside
 * a transaction (the driver injects whichever is active).
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}
