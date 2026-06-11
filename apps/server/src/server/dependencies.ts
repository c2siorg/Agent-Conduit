import type { AdapterRegistry } from '@conduit/adapters';
import type { ConnectorRegistry } from '@conduit/connectors';
import type { StorageDriver } from '@conduit/storage';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConduitConfig } from '../config/configSchema.js';
import type { ConnectionProxy } from '../connections/connectionProxy.js';
import type { ConnectionRegistryService } from '../connections/connectionRegistry.js';
import type { IdentityService } from '../identity/identityService.js';
import type { AuditLog } from '../observability/auditLog.js';
import type { Logger } from '../observability/logger.js';
import type { Metrics } from '../observability/metrics.js';
import type { SecurityEventStream } from '../observability/securityEventStream.js';
import type { TokenRouter } from '../router/tokenRouter.js';

/**
 * AppDependencies — the COMPOSITION ROOT.
 *
 * Every dependency is EXPLICITLY injected here; there is no magic/auto-wiring. The boot sequence
 * (`index.ts`) constructs these once and hands them to `createApp`, so each request path is traceable.
 */
export interface AppDependencies {
  config: ConduitConfig;
  logger: Logger;
  metrics: Metrics;
  storage: StorageDriver;
  connectors: ConnectorRegistry;
  adapters: AdapterRegistry;

  // Pre-built JWT pipelines (fixed stage order).
  agentPipeline: JwtPipeline;
  hostPipeline: JwtPipeline;

  // Pillar services.
  identityService: IdentityService;
  connectionRegistry: ConnectionRegistryService;
  connectionProxy: ConnectionProxy;
  tokenRouter: TokenRouter;
  auditLog: AuditLog;
  securityEvents: SecurityEventStream;
}
