import express, { type Express } from 'express';
import helmet from 'helmet';
import type { StorageDriver } from '@conduit/storage';
import type { ConduitConfig } from '../config/configSchema.js';
import type { Logger } from '../observability/logger.js';
import { wellKnownRoutes } from '../routes/wellKnownRoutes.js';

export interface HealthAppDeps {
  config: ConduitConfig;
  storage: StorageDriver;
  logger: Logger;
}

/**
 * createHealthApp — the operational surface the gateway exposes today: AAP discovery + JWKS
 * (live) plus liveness/readiness. The full capability pillars (JWT pipeline, identity, token
 * router) are not wired here yet — that is `createApp` / the route groups, still stubbed.
 */
export function createHealthApp(deps: HealthAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: deps.config.server.requestLimits.jsonBodyBytes }));

  // AAP discovery + JWKS (live).
  app.use(wellKnownRoutes({ config: deps.config }));

  // Liveness: the process is up.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: dependencies (the database) are reachable.
  app.get('/readyz', (_req, res) => {
    void deps.storage
      .healthCheck()
      .then((dbOk) => {
        res
          .status(dbOk ? 200 : 503)
          .json({ status: dbOk ? 'ready' : 'degraded', checks: { database: dbOk ? 'ok' : 'down' } });
      })
      .catch(() => {
        res.status(503).json({ status: 'degraded', checks: { database: 'down' } });
      });
  });

  // Minimal service banner.
  app.get('/', (_req, res) => {
    res.json({
      service: 'agent-conduit',
      status: 'running',
      note: 'Discovery + JWKS + health are live; the AAP capability pillars are not wired yet.',
    });
  });

  return app;
}
