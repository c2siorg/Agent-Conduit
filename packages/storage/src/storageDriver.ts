import type {
  AgentRepository,
  AuditLogRepository,
  CapabilityGrantRepository,
  ConnectionGrantRepository,
  ConnectionRepository,
  HostRepository,
  JtiCacheRepository,
  ToolRepository,
} from './repositories.js';

/**
 * StorageDriver — the persistence STRATEGY.
 *
 * Pillars talk ONLY to this typed interface (and its repositories); raw SQL never leaks past a driver.
 * Backends are selected by config (`storage.driver`), never by code changes. If a backend can't match
 * a feature, the driver — not the caller — owns the difference.
 */
export interface StorageDriver {
  /** Backend id, e.g. 'postgres' | 'mysql'. */
  readonly name: string;

  /** Open pools / connections and validate connectivity. */
  init(): Promise<void>;
  /** Run this backend's versioned migrations (runs on startup). */
  migrate(): Promise<void>;
  /** Liveness probe — feeds the dashboard's "platform health" (DB) tile. */
  healthCheck(): Promise<boolean>;
  /** Run `fn` atomically; the driver owns isolation + row-level locking (constraint TOCTOU safety). */
  transaction<T>(fn: (tx: StorageDriver) => Promise<T>): Promise<T>;
  /** Drain pools and close. */
  close(): Promise<void>;

  // Aggregate repositories.
  readonly hosts: HostRepository;
  readonly agents: AgentRepository;
  readonly capabilityGrants: CapabilityGrantRepository;
  readonly connections: ConnectionRepository;
  readonly connectionGrants: ConnectionGrantRepository;
  readonly tools: ToolRepository;
  readonly auditLog: AuditLogRepository;
  readonly jtiCache: JtiCacheRepository;
}
