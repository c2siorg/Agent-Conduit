import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import type { ConduitConfig, LogLevel } from './configSchema.js';

export interface LoadConfigOptions {
  /** Path to `conduit.config.yaml` (defaults to `<cwd>/conduit.config.yaml`). */
  configPath?: string;
  /** Environment source (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
}

/** Built-in defaults (layer 1). Mirrors `conduit.config.yaml`. */
function defaults(): ConduitConfig {
  return {
    server: {
      host: '0.0.0.0',
      port: 8443,
      baseUrl: 'https://localhost:8443',
      requestLimits: { jsonBodyBytes: 1_048_576, maxHeaderBytes: 16_384 },
    },
    storage: {
      driver: 'postgres',
      postgres: { host: 'localhost', port: 5432, database: 'conduit', user: 'conduit', poolSize: 10 },
    },
    crypto: {
      masterKey: { source: 'env', envVar: 'CONDUIT_MASTER_KEY' },
      signingKey: { source: 'env', envVar: 'CONDUIT_SIGNING_KEY' },
    },
    security: {
      jwt: { agentTtlSeconds: 60, hostTtlSeconds: 300, clockSkewSeconds: 30, jtiCacheWindowSeconds: 90 },
      rateLimits: {
        perAgentPerMinute: 120,
        perHostPerMinute: 300,
        perUserPerMinute: 300,
        perIpPerMinute: 600,
        unknownHostRegistrationPerHourPerIp: 5,
      },
      lifetimes: {
        sessionTtlSeconds: 3600, // 1h
        maxLifetimeSeconds: 2_592_000, // 30d
        absoluteLifetimeSeconds: 7_776_000, // 90d
      },
      dpop: { enabled: false },
      mtls: { enabled: false },
    },
    tls: {
      source: 'file',
      file: { certPath: './secrets/tls/cert.pem', keyPath: './secrets/tls/key.pem' },
      acme: { directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory', email: '', domains: [] },
      expiryAlertDays: 21,
    },
    connectors: {
      enabled: ['slack', 'discord', 'github', 'gitlab', 'jira', 'google', 'notion', 'rest', 'graphql'],
      defaults: {},
    },
    observability: { logLevel: 'info', format: 'ndjson', exporters: [], audit: { hashArgs: true } },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merge plain objects (arrays and scalars from `override` win). */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = base[key];
    out[key] = isRecord(value) && isRecord(current) ? deepMerge(current, value) : value;
  }
  return out;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * loadConfig — layered resolution, last-wins: defaults -> YAML file -> environment variables.
 * Validates the result and fails fast with a clear error. Secrets come from env, never YAML.
 */
export function loadConfig(options?: LoadConfigOptions): ConduitConfig {
  const env = options?.env ?? process.env;

  // Layer 1 + 2: defaults overlaid with the YAML file if present.
  let config = defaults();
  const path = options?.configPath ?? resolve(process.cwd(), 'conduit.config.yaml');
  if (existsSync(path)) {
    const parsed = loadYaml(readFileSync(path, 'utf8'));
    if (isRecord(parsed)) {
      config = deepMerge(config as unknown as Record<string, unknown>, parsed) as unknown as ConduitConfig;
    }
  }

  // Layer 3: environment overrides (canonical for containers and secrets).
  const pg = config.storage.postgres ?? {
    host: 'localhost',
    port: 5432,
    database: 'conduit',
    user: 'conduit',
  };
  config.storage.postgres = {
    ...pg,
    host: env['PGHOST'] ?? pg.host,
    port: env['PGPORT'] ? Number(env['PGPORT']) : pg.port,
    database: env['PGDATABASE'] ?? pg.database,
    user: env['PGUSER'] ?? pg.user,
  };
  if (env['CONDUIT_PORT']) {
    config.server.port = Number(env['CONDUIT_PORT']);
  }
  if (env['CONDUIT_BASE_URL']) {
    config.server.baseUrl = env['CONDUIT_BASE_URL'];
  }
  const lvl = env['LOG_LEVEL'];
  if (lvl && (LOG_LEVELS as readonly string[]).includes(lvl)) {
    config.observability.logLevel = lvl as LogLevel;
  }

  validate(config);
  return config;
}

function validate(config: ConduitConfig): void {
  if (config.storage.driver === 'postgres' && !config.storage.postgres) {
    throw new Error('config: storage.driver is "postgres" but storage.postgres settings are missing');
  }
  if (!Number.isFinite(config.server.port) || config.server.port <= 0) {
    throw new Error(`config: invalid server.port "${config.server.port}"`);
  }
}
