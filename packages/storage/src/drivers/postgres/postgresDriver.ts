import path from 'node:path';
import { runner as migrationRunner } from 'node-pg-migrate';
import { Pool } from 'pg';
import type { PoolClient, PoolConfig } from 'pg';
import type {
  AgentRepository,
  AuditLogRepository,
  CapabilityGrantRepository,
  ConnectionGrantRepository,
  ConnectionRepository,
  HostRepository,
  JtiCacheRepository,
  ToolRepository,
} from '../../repositories.js';
import type { StorageDriver } from '../../storageDriver.js';
import { stubRepository } from '../stubRepository.js';
import { PostgresAgentRepository } from './agentRepository.js';
import { PostgresAuditLogRepository } from './auditLogRepository.js';
import { PostgresCapabilityGrantRepository } from './capabilityGrantRepository.js';
import { PostgresConnectionRepository } from './connectionRepository.js';
import { PostgresHostRepository } from './hostRepository.js';
import { PostgresJtiCacheRepository } from './jtiCacheRepository.js';
import type { Queryable } from './queryable.js';

/** Postgres connection settings (from `storage.postgres`, plus test/transaction conveniences). */
export interface PostgresConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Alternative to discrete fields (e.g. tests). */
  connectionString?: string;
  poolSize?: number;
  ssl?: boolean;
  /** Override the migrations directory (defaults to `<cwd>/migrations/postgres`). */
  migrationsDir?: string;
}

function buildPoolConfig(c: PostgresConfig): PoolConfig {
  const cfg: PoolConfig = { max: c.poolSize ?? 10 };
  if (c.connectionString) {
    cfg.connectionString = c.connectionString;
  } else {
    cfg.host = c.host;
    cfg.port = c.port;
    cfg.database = c.database;
    cfg.user = c.user;
  }
  if (c.password !== undefined) {
    cfg.password = c.password;
  }
  if (c.ssl) {
    cfg.ssl = { rejectUnauthorized: false };
  }
  return cfg;
}

/**
 * PostgresStorageDriver — the DEFAULT and reference driver.
 *
 * Owns the Postgres-specific features the design relies on (jsonb, text[] arrays, row-level locking,
 * RETURNING). `hosts` and `agents` are implemented; the remaining repositories are stubbed until built.
 *
 * A transaction-scoped instance shares the same class, constructed with a single `PoolClient` as its
 * active queryable, so repositories behave identically inside and outside a transaction.
 */
export class PostgresStorageDriver implements StorageDriver {
  readonly name = 'postgres';

  private pool: Pool | null = null;
  private activeDb: Queryable | null;

  readonly hosts: HostRepository;
  readonly agents: AgentRepository;
  readonly capabilityGrants: CapabilityGrantRepository;
  readonly connections: ConnectionRepository;
  readonly connectionGrants: ConnectionGrantRepository =
    stubRepository<ConnectionGrantRepository>('PostgresConnectionGrantRepository');
  readonly tools: ToolRepository = stubRepository<ToolRepository>('PostgresToolRepository');
  readonly auditLog: AuditLogRepository;
  readonly jtiCache: JtiCacheRepository;

  constructor(
    private readonly config: PostgresConfig,
    activeDb: Queryable | null = null,
  ) {
    this.activeDb = activeDb;
    const db = (): Queryable => {
      if (!this.activeDb) {
        throw new Error('PostgresStorageDriver not initialized — call init() first');
      }
      return this.activeDb;
    };
    this.hosts = new PostgresHostRepository(db);
    this.agents = new PostgresAgentRepository(db);
    this.jtiCache = new PostgresJtiCacheRepository(db);
    this.capabilityGrants = new PostgresCapabilityGrantRepository(db);
    this.connections = new PostgresConnectionRepository(db);
    this.auditLog = new PostgresAuditLogRepository(db);
  }

  async init(): Promise<void> {
    if (this.activeDb) {
      return; // transaction-scoped, or already initialized
    }
    const pool = new Pool(buildPoolConfig(this.config));
    this.pool = pool;
    this.activeDb = pool;
    await pool.query('SELECT 1'); // validate connectivity, fail fast
  }

  async migrate(): Promise<void> {
    if (!this.pool) {
      throw new Error('migrate() requires init() first');
    }
    const dir = this.config.migrationsDir ?? path.resolve(process.cwd(), 'migrations', 'postgres');
    const client = await this.pool.connect();
    try {
      await migrationRunner({
        dbClient: client,
        dir,
        direction: 'up',
        migrationsTable: 'pgmigrations',
        count: Infinity,
      });
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.activeDb) {
      return false;
    }
    try {
      await this.activeDb.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async transaction<T>(fn: (tx: StorageDriver) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('transaction() requires a pool-backed driver');
    }
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new PostgresStorageDriver(this.config, client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.activeDb = null;
    }
  }
}
