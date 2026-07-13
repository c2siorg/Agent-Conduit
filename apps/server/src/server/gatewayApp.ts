import type { StorageDriver } from '@conduit/storage';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConduitConfig } from '../config/configSchema.js';
import type { ConnectionProxy } from '../connections/connectionProxy.js';
import type { ConnectionRegistryService } from '../connections/connectionRegistry.js';
import type { IdentityService } from '../identity/identityService.js';
import type { Logger } from '../observability/logger.js';
import type { Metrics } from '../observability/metrics.js';
import type { SecurityEventStream } from '../observability/securityEventStream.js';
import type { SchemaCache } from '../router/schemaCache.js';
import type { TokenRouter } from '../router/tokenRouter.js';
import { adminRoutes } from '../routes/adminRoutes.js';
import { capabilityRoutes } from '../routes/capabilityRoutes.js';
import { identityRoutes } from '../routes/identityRoutes.js';
import { observabilityRoutes } from '../routes/observabilityRoutes.js';
import { toolRoutes } from '../routes/toolRoutes.js';
import { wellKnownRoutes } from '../routes/wellKnownRoutes.js';
import { errorHandler } from './errorHandler.js';
import { ipFilter } from './ipFilter.js';
import { clientIp, createRateLimiter, rateLimit } from './rateLimiter.js';
import { createRuntimeSettings, type RuntimeSettingsStore } from './runtimeSettings.js';

const HEALTH_PATHS = new Set(['/healthz', '/readyz']);

/** Permissive default so a minimally-configured app (e.g. tests) constructs with enforcement off. */
function defaultSettings(): RuntimeSettingsStore {
  return createRuntimeSettings({
    rateLimit: { enabled: false, perIpPerMinute: 6000, registerPerHourPerIp: 600 },
    ipFilter: { enabled: false, mode: 'deny', entries: [] },
    jwks: { allowPrivateHosts: false },
    dpop: { enabled: false },
    mtls: { enabled: false },
  });
}

export interface GatewayAppDeps {
  config: ConduitConfig;
  storage: StorageDriver;
  logger: Logger;
  identityService: IdentityService;
  connectionRegistry: ConnectionRegistryService;
  connectionProxy: ConnectionProxy;
  /** Operator-toggleable runtime security settings; a permissive default is used if omitted. */
  settings?: RuntimeSettingsStore;
  tokenRouter: TokenRouter;
  schemaCache: SchemaCache;
  events: SecurityEventStream;
  metrics: Metrics;
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

  // Runtime-toggleable enforcement (operator-controlled via /admin/config): client-IP allow/deny filter,
  // then a per-IP rate cap plus an aggressive per-IP cap on agent registration. Health + SSE are exempt.
  const settings = deps.settings ?? defaultSettings();
  // Health, SSE, and the admin-config recovery endpoint are exempt — so a bad IP/rate rule can always be
  // undone by the (host-authenticated) operator and never causes a permanent self-lockout.
  const skipInfra = (req: Request): boolean =>
    HEALTH_PATHS.has(req.path) || req.path === '/events' || req.path === '/admin/config';
  const ipFilterMw = ipFilter(() => settings.get().ipFilter, clientIp);
  app.use((req, res, next) => (skipInfra(req) ? next() : ipFilterMw(req, res, next)));

  const ipLimiter = createRateLimiter(60_000, () => settings.get().rateLimit.perIpPerMinute);
  const registerLimiter = createRateLimiter(3_600_000, () => settings.get().rateLimit.registerPerHourPerIp);
  app.use(rateLimit(ipLimiter, clientIp, { skip: (req) => skipInfra(req) || !settings.get().rateLimit.enabled }));
  app.use('/agent/register', rateLimit(registerLimiter, clientIp, { skip: () => !settings.get().rateLimit.enabled }));

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
      settings,
      hostPipeline: deps.hostPipeline,
    }),
  );
  app.use(
    toolRoutes({
      tokenRouter: deps.tokenRouter,
      storage: deps.storage,
      cache: deps.schemaCache,
      agentPipeline: deps.agentPipeline,
      hostPipeline: deps.hostPipeline,
    }),
  );
  app.use(observabilityRoutes({ events: deps.events, metrics: deps.metrics }));

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

  app.use(errorHandler(deps.events));
  return app;
}
