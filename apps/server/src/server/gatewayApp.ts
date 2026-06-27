import type { StorageDriver } from '@conduit/storage';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConduitConfig } from '../config/configSchema.js';
import type { ConnectionProxy } from '../connections/connectionProxy.js';
import type { ConnectionRegistryService } from '../connections/connectionRegistry.js';
import type { IdentityService } from '../identity/identityService.js';
import type { Logger } from '../observability/logger.js';
import { adminRoutes } from '../routes/adminRoutes.js';
import { capabilityRoutes } from '../routes/capabilityRoutes.js';
import { identityRoutes } from '../routes/identityRoutes.js';
import { wellKnownRoutes } from '../routes/wellKnownRoutes.js';
import { errorHandler } from './errorHandler.js';

export interface GatewayAppDeps {
  config: ConduitConfig;
  storage: StorageDriver;
  logger: Logger;
  identityService: IdentityService;
  connectionRegistry: ConnectionRegistryService;
  connectionProxy: ConnectionProxy;
  agentPipeline: JwtPipeline;
  hostPipeline: JwtPipeline;
}

/**
 * createGatewayApp - the HTTP composition root.
 * Mounts discovery + JWKS, identity (register/status/revoke/update), capabilities (grant/execute), the
 * admin registry + connection vault + audit, health/readiness, and finally the AAP error envelope handler.
 */
export function createGatewayApp(deps: GatewayAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: deps.config.server.requestLimits.jsonBodyBytes }));

  app.use(wellKnownRoutes({ config: deps.config }));
  app.use(
    identityRoutes({
      identityService: deps.identityService,
      agentPipeline: deps.agentPipeline,
      hostPipeline: deps.hostPipeline,
    }),
  );
  app.use(
    capabilityRoutes({
      identityService: deps.identityService,
      connectionProxy: deps.connectionProxy,
      agentPipeline: deps.agentPipeline,
      hostPipeline: deps.hostPipeline,
      baseUrl: deps.config.server.baseUrl,
    }),
  );
  app.use(
    adminRoutes({
      storage: deps.storage,
      connectionRegistry: deps.connectionRegistry,
      hostPipeline: deps.hostPipeline,
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
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
  app.get('/', (_req, res) => {
    res.json({ service: 'agent-conduit', status: 'running' });
  });

  app.use(errorHandler());
  return app;
}
