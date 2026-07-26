import { createServer } from 'node:http';
import { createAdapterRegistry } from '@conduit/adapters';
import { createConnectorRegistry } from '@conduit/connectors';
import { createJwtVerifier } from '@conduit/crypto';
import { PostgresStorageDriver, type PostgresConfig } from '@conduit/storage';
import { createJwksResolver } from './auth/jwksResolver.js';
import { buildAgentPipeline, buildHostPipeline } from './auth/stages/index.js';
import { loadConfig } from './config/configLoader.js';
import { createConnectionProxy } from './connections/connectionProxy.js';
import { createConnectionRegistryService } from './connections/connectionRegistry.js';
import { createCredentialCipher, resolveMasterKey } from './connections/credentialCipher.js';
import { createConstraintEngine } from './identity/constraintEngine.js';
import { createIdentityService } from './identity/identityService.js';
import { createStateMachine } from './identity/stateMachine.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { createRuntimeSettings } from './server/runtimeSettings.js';
import { createSecurityEventStream } from './observability/securityEventStream.js';
import { createSchemaCache } from './router/schemaCache.js';
import { createTokenRouter } from './router/tokenRouter.js';
import { createGatewayApp } from './server/gatewayApp.js';

const SCHEMA_CACHE_TTL_SECONDS = 300;

/**
 * Agent Conduit gateway entrypoint.
 *
 * Boot: loadConfig -> Postgres init + migrate-on-startup -> crypto verifier, state machine, identity
 * service -> build the agent/host JWT pipelines -> mount the gateway app -> listen. Fails fast on any
 * startup error. Sprint 1 surface: discovery/JWKS, agent register + status, and the admin registry.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.observability.logLevel);
  logger.info('starting agent-conduit gateway', {
    port: config.server.port,
    driver: config.storage.driver,
  });

  if (config.storage.driver !== 'postgres' || !config.storage.postgres) {
    throw new Error(`unsupported storage driver "${config.storage.driver}" — only postgres is implemented`);
  }
  const pg = config.storage.postgres;
  const driverConfig: PostgresConfig = {
    host: pg.host,
    port: pg.port,
    database: pg.database,
    user: pg.user,
  };
  if (pg.poolSize !== undefined) {
    driverConfig.poolSize = pg.poolSize;
  }
  if (pg.ssl !== undefined) {
    driverConfig.ssl = pg.ssl;
  }

  const storage = new PostgresStorageDriver(driverConfig);
  await storage.init();
  logger.info('connected to storage', { driver: storage.name });
  await storage.migrate();
  logger.info('migrations applied');

  const verifier = createJwtVerifier();
  const constraintEngine = createConstraintEngine();
  const stateMachine = createStateMachine(storage);
  const identityService = createIdentityService({
    storage,
    stateMachine,
    lifetimes: config.security.lifetimes,
    verifier,
    issuer: config.server.baseUrl,
  });

  const cipher = createCredentialCipher(
    resolveMasterKey(config.crypto.masterKey.envVar ?? 'CONDUIT_MASTER_KEY'),
  );
  const connectors = createConnectorRegistry(config.connectors.enabled);
  const connectionProxy = createConnectionProxy({ storage, cipher, connectors });
  const connectionRegistry = createConnectionRegistryService(storage, cipher, connectors);

  const adapters = createAdapterRegistry();
  const schemaCache = createSchemaCache(SCHEMA_CACHE_TTL_SECONDS);
  const metrics = createMetrics();
  const events = createSecurityEventStream();
  const tokenRouter = createTokenRouter({ storage, adapters, cache: schemaCache, metrics });

  const pipelineConfig = {
    issuer: config.server.baseUrl,
    clockSkewSeconds: config.security.jwt.clockSkewSeconds,
    jtiCacheWindowSeconds: config.security.jwt.jtiCacheWindowSeconds,
  };
  // Operator-toggleable runtime security settings, seeded from static config (authoritative on restart).
  const settings = createRuntimeSettings({
    rateLimit: {
      enabled: true,
      perIpPerMinute: config.security.rateLimits.perIpPerMinute,
      registerPerHourPerIp: config.security.rateLimits.unknownHostRegistrationPerHourPerIp,
    },
    ipFilter: { enabled: false, mode: 'deny', entries: [] },
    jwks: { allowPrivateHosts: process.env['CONDUIT_JWKS_ALLOW_PRIVATE'] === 'true' },
    dpop: { enabled: config.security.dpop.enabled },
    mtls: { enabled: config.security.mtls.enabled },
  });

  // SSRF-hardened JWKS resolver (§8.12); the allow-private toggle is read live from runtime settings.
  const jwksResolver = createJwksResolver({
    allowPrivateHosts: () => settings.get().jwks.allowPrivateHosts,
  });
  const pipelineParts = { verifier, storage, constraintEngine, config: pipelineConfig, jwksResolver };
  const agentPipeline = buildAgentPipeline(pipelineParts);
  const hostPipeline = buildHostPipeline(pipelineParts);

  const app = createGatewayApp({
    config,
    storage,
    logger,
    identityService,
    connectionRegistry,
    connectionProxy,
    connectors,
    settings,
    tokenRouter,
    schemaCache,
    events,
    metrics,
    agentPipeline,
    hostPipeline,
  });
  const server = createServer(app);

  await new Promise<void>((ready) => {
    server.listen(config.server.port, config.server.host, ready);
  });
  logger.info('gateway listening', { url: `http://${config.server.host}:${config.server.port}` });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => {
      void storage.close().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
