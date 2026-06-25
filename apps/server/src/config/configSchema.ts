/**
 * Typed configuration schema — the single shape `loadConfig` validates and the pillars consume.
 * Mirrors `conduit.config.yaml`. Everything swappable lives here; nothing operational is hardcoded.
 */

export interface ServerConfig {
  host: string;
  port: number;
  baseUrl: string;
  requestLimits: {
    jsonBodyBytes: number;
    maxHeaderBytes: number;
  };
}

export interface PostgresStorageConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  poolSize?: number;
  ssl?: boolean;
}

export interface MysqlStorageConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  poolSize?: number;
}

/** `driver` selects the backend; the matching block supplies its connection settings. */
export interface StorageSectionConfig {
  driver: 'postgres' | 'mysql' | (string & {});
  postgres?: PostgresStorageConfig;
  mysql?: MysqlStorageConfig;
}

export type KeySource = 'env' | 'file' | 'kms';

/** A reference to key material — never the material itself. */
export interface KeyRef {
  source: KeySource;
  envVar?: string;
  filePath?: string;
  kmsKeyId?: string;
}

export interface CryptoConfig {
  masterKey: KeyRef;
  signingKey: KeyRef;
}

export interface JwtSecurityConfig {
  agentTtlSeconds: number;
  hostTtlSeconds: number;
  clockSkewSeconds: number;
  jtiCacheWindowSeconds: number;
}

export interface RateLimitConfig {
  perAgentPerMinute: number;
  perHostPerMinute: number;
  perUserPerMinute: number;
  perIpPerMinute: number;
  unknownHostRegistrationPerHourPerIp: number;
}

/** The three agent lifetime clocks, in seconds, stamped on activation (AAP §2.4). */
export interface AgentLifetimesConfig {
  sessionTtlSeconds: number;
  maxLifetimeSeconds: number;
  absoluteLifetimeSeconds: number;
}

export interface SecurityConfig {
  jwt: JwtSecurityConfig;
  rateLimits: RateLimitConfig;
  lifetimes: AgentLifetimesConfig;
  /** RFC 9449 — off by default. */
  dpop: { enabled: boolean };
  /** RFC 8705 — off by default. */
  mtls: { enabled: boolean; caBundlePath?: string };
}

export type TlsSource = 'file' | 'acme';

export interface TlsConfig {
  source: TlsSource;
  file?: { certPath: string; keyPath: string };
  acme?: { directoryUrl: string; email: string; domains: string[] };
  expiryAlertDays: number;
}

export interface ConnectorsConfig {
  enabled: string[];
  defaults: Record<string, Record<string, unknown>>;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ObservabilityConfig {
  logLevel: LogLevel;
  format: 'ndjson';
  exporters: string[];
  audit: { hashArgs: boolean; retentionDays?: number };
}

/** The fully-resolved, validated configuration (after layering defaults → YAML → env). */
export interface ConduitConfig {
  server: ServerConfig;
  storage: StorageSectionConfig;
  crypto: CryptoConfig;
  security: SecurityConfig;
  tls: TlsConfig;
  connectors: ConnectorsConfig;
  observability: ObservabilityConfig;
}
