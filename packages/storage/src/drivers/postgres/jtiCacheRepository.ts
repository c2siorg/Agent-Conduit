import type { JtiCacheRepository } from '../../repositories.js';
import type { Queryable } from './queryable.js';

/**
 * Postgres-backed {@link JtiCacheRepository}. `put` is atomic (TOCTOU-safe): an `INSERT ... ON
 * CONFLICT DO NOTHING` that reports whether the row was new, so a replayed jti is detected even
 * under concurrent requests.
 */
export class PostgresJtiCacheRepository implements JtiCacheRepository {
  constructor(private readonly db: () => Queryable) {}

  /** True only if the jti is present AND still within its window (an expired entry does not count). */
  async has(jti: string): Promise<boolean> {
    const { rows } = await this.db().query(
      'SELECT 1 FROM jti_cache WHERE jti = $1 AND expires_at >= now()',
      [jti],
    );
    return rows.length > 0;
  }

  /**
   * Returns true when the jti was newly recorded (or reclaimed because the prior entry had expired);
   * false means an UNEXPIRED entry already existed — a replay. The upsert is atomic: on conflict it
   * only overwrites when the existing row has expired, so a live jti within its window is rejected.
   */
  async put(jti: string, expiresAt: Date): Promise<boolean> {
    const result = await this.db().query(
      `INSERT INTO jti_cache (jti, expires_at) VALUES ($1, $2)
       ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at
       WHERE jti_cache.expires_at < now()`,
      [jti, expiresAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.db().query('DELETE FROM jti_cache WHERE expires_at < $1', [now]);
    return result.rowCount ?? 0;
  }
}
