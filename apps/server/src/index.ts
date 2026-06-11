import { createServer } from 'node:http';
import { PostgresStorageDriver, type PostgresConfig } from '@conduit/storage';
import { loadConfig } from './config/configLoader.js';
import { createLogger } from './observability/logger.js';
import { createHealthApp } from './server/healthApp.js';

/**
 * Agent Conduit gateway entrypoint.
 *
 * Current boot (minimal, operational): loadConfig -> create Postgres driver -> init() + migrate()
 * (migrations run automatically on startup) -> serve the health/readiness app -> listen.
 * Fails fast on any startup error. The full pillar wiring (createApp + JWT pipelines) is still pending.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.observability.logLevel);
  logger.info('starting agent-conduit gateway', {
    port: config.server.port,
    driver: config.storage.driver,
  });

  if (config.storage.driver !== 'postgres' || !config.storage.postgres) {
    throw new Error(
      `unsupported storage driver "${config.storage.driver}" — only postgres is implemented so far`,
    );
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

  const app = createHealthApp({ config, storage, logger });
  const server = createServer(app);

  await new Promise<void>((ready) => {
    server.listen(config.server.port, config.server.host, ready);
  });
  logger.info('gateway listening', { url: `http://${config.server.host}:${config.server.port}` });

  // Graceful shutdown.
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
  // Fail fast with a clear message; do not leave the process half-started.
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
