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

/** MySQL connection settings (from `storage.mysql`). */
export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  poolSize?: number;
}

/**
 * MysqlStorageDriver — the proof the abstraction holds.
 * Maps the Postgres-specific shapes the interface implies: `jsonb→JSON`, `bytea→BLOB/VARBINARY`,
 * array columns → a normalized table or JSON, and provides equivalent locking. Where a feature
 * can't be matched 1:1, THIS driver owns the difference — never the caller.
 * @remarks Scaffold — repositories are stubbed until implemented.
 */
export class MysqlStorageDriver implements StorageDriver {
  readonly name = 'mysql';

  readonly hosts: HostRepository = stubRepository('MysqlHostRepository');
  readonly agents: AgentRepository = stubRepository('MysqlAgentRepository');
  readonly capabilityGrants: CapabilityGrantRepository = stubRepository('MysqlCapabilityGrantRepository');
  readonly connections: ConnectionRepository = stubRepository('MysqlConnectionRepository');
  readonly connectionGrants: ConnectionGrantRepository = stubRepository('MysqlConnectionGrantRepository');
  readonly tools: ToolRepository = stubRepository('MysqlToolRepository');
  readonly auditLog: AuditLogRepository = stubRepository('MysqlAuditLogRepository');
  readonly jtiCache: JtiCacheRepository = stubRepository('MysqlJtiCacheRepository');

  constructor(private readonly config: MysqlConfig) {}

  init(): Promise<void> {
    throw new Error('MysqlStorageDriver.init not implemented');
  }
  migrate(): Promise<void> {
    throw new Error('MysqlStorageDriver.migrate not implemented');
  }
  healthCheck(): Promise<boolean> {
    throw new Error('MysqlStorageDriver.healthCheck not implemented');
  }
  transaction<T>(_fn: (tx: StorageDriver) => Promise<T>): Promise<T> {
    throw new Error('MysqlStorageDriver.transaction not implemented');
  }
  close(): Promise<void> {
    throw new Error('MysqlStorageDriver.close not implemented');
  }
}
