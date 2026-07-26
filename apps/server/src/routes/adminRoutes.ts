import { ConduitError, ErrorCode } from '@conduit/core';
import type { AuditOutcome } from '@conduit/core';
import type { ConnectorRegistry } from '@conduit/connectors';
import type { AuditQuery, PageQuery, StorageDriver } from '@conduit/storage';
import { Router } from 'express';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConnectionRegistryService } from '../connections/connectionRegistry.js';
import { getAuth, requireJwt } from '../server/authMiddleware.js';
import type { RuntimeSettingsPatch, RuntimeSettingsStore } from '../server/runtimeSettings.js';

export interface AdminRoutesDeps {
  storage: StorageDriver;
  connectionRegistry: ConnectionRegistryService;
  connectors: ConnectorRegistry;
  settings: RuntimeSettingsStore;
  hostPipeline: JwtPipeline;
}

/**
 * Admin / observability routes consumed by the dashboard. Listings expose NO secrets.
 * NOTE: admin authentication is added in a later sprint; gate writes before exposing publicly.
 */
export function adminRoutes(deps: AdminRoutesDeps): Router {
  const router = Router();

  router.get('/agents', (req, res, next) => {
    const query: PageQuery = {};
    const limit = req.query['limit'];
    const cursor = req.query['cursor'];
    if (typeof limit === 'string') {
      query.limit = Number(limit);
    }
    if (typeof cursor === 'string') {
      query.cursor = cursor;
    }
    deps.storage.agents
      .list(query)
      .then((page) => {
        res.json({
          agents: page.items.map((a) => ({
            id: a.id,
            host_id: a.hostId,
            name: a.name,
            description: a.description,
            status: a.status,
            mode: a.mode,
            created_at: a.createdAt,
            activated_at: a.activatedAt,
            session_expires_at: a.sessionExpiresAt,
          })),
          next_cursor: page.nextCursor,
          has_more: page.hasMore,
        });
      })
      .catch(next);
  });

  // Register a governed credential (host-authorized for now). Encrypted at rest; never returned.
  router.post('/connections', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const body = (req.body ?? {}) as {
      name?: string;
      platform?: string;
      auth_method?: string;
      secret?: Record<string, string>;
      allowed_operations?: string[];
    };
    if (!body.name || !body.platform || !body.secret) {
      next(new ConduitError(ErrorCode.invalidRequest, 'name, platform, and secret are required', 400));
      return;
    }
    deps.connectionRegistry
      .registerConnection({
        name: body.name,
        platform: body.platform,
        ...(body.auth_method ? { authMethod: body.auth_method } : {}),
        secret: body.secret,
        allowedOperations: body.allowed_operations ?? [],
      })
      .then((c) => {
        res.status(201).json({ connection_id: c.id, name: c.name, platform: c.platform });
      })
      .catch(next);
  });

  // Update a connection (name / allowed operations / rotate secret). Host-authorized.
  router.patch('/connections/:id', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const id = req.params['id'] ?? '';
    const body = (req.body ?? {}) as {
      name?: string;
      allowed_operations?: string[];
      auth_method?: string;
      secret?: Record<string, string>;
    };
    deps.connectionRegistry
      .updateConnection(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.allowed_operations !== undefined ? { allowedOperations: body.allowed_operations } : {}),
        ...(body.auth_method !== undefined ? { authMethod: body.auth_method } : {}),
        ...(body.secret !== undefined ? { secret: body.secret } : {}),
      })
      .then((c) => {
        res.json({ connection_id: c.id, name: c.name, platform: c.platform, allowed_operations: c.allowedOperations });
      })
      .catch(next);
  });

  // Delete a connection. Host-authorized. Grants referencing it will fail at execute (connection not found).
  router.delete('/connections/:id', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    deps.connectionRegistry
      .deleteConnection(req.params['id'] ?? '')
      .then(() => {
        res.json({ deleted: true });
      })
      .catch(next);
  });

  // Test a connection's stored credential (structural + live probe where supported). Host-authorized.
  router.post('/connections/:id/test', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    deps.connectionRegistry
      .testConnection(req.params['id'] ?? '')
      .then((result) => {
        res.json(result);
      })
      .catch(next);
  });

  // Connection vault status - credential VALUES are never included.
  router.get('/connections', (_req, res, next) => {
    deps.connectionRegistry
      .listConnections()
      .then((conns) => {
        res.json({
          connections: conns.map((c) => ({
            id: c.id,
            name: c.name,
            platform: c.platform,
            allowed_operations: c.allowedOperations,
            created_at: c.createdAt,
            last_test_ok: c.lastTestOk,
            last_test_at: c.lastTestAt,
            last_test_detail: c.lastTestDetail,
          })),
        });
      })
      .catch(next);
  });

  // Queryable audit log (args HASH only, never raw args).
  router.get('/audit', (req, res, next) => {
    const query: AuditQuery = {};
    const agentId = req.query['agent_id'];
    const outcome = req.query['outcome'];
    const limit = req.query['limit'];
    const cursor = req.query['cursor'];
    if (typeof agentId === 'string') {
      query.agentId = agentId;
    }
    if (typeof outcome === 'string') {
      query.outcome = outcome as AuditOutcome;
    }
    if (typeof limit === 'string') {
      query.limit = Number(limit);
    }
    if (typeof cursor === 'string') {
      query.cursor = cursor;
    }
    deps.storage.auditLog
      .query(query)
      .then((page) => {
        res.json({
          entries: page.items.map((e) => ({
            id: e.id,
            agent_id: e.agentId,
            event_type: e.eventType,
            capability: e.capability,
            connection_id: e.connectionId,
            operation: e.operation,
            outcome: e.outcome,
            args_hash: e.argsHash,
            duration_ms: e.durationMs,
            created_at: e.createdAt,
          })),
          next_cursor: page.nextCursor,
          has_more: page.hasMore,
        });
      })
      .catch(next);
  });

  // Available connectors (platform ids + labels + operations). No secrets; drives the dashboard dropdown
  // so the UI always reflects exactly what the gateway supports.
  router.get('/connectors', (_req, res) => {
    res.json({
      connectors: deps.connectors
        .list()
        .map((d) => ({
          platform: d.platform,
          label: d.label ?? d.platform,
          auth_methods: d.supportedAuthMethods,
          docs_url: d.docsUrl ?? null,
          fields: d.credentialFields ?? [],
          operations: d.supportedOperations.map((o) => ({ name: o.name, description: o.description })),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    });
  });

  // Runtime security settings (operator-toggleable). Read is host-authorized; writes are audited.
  router.get('/admin/config', requireJwt(deps.hostPipeline, 'host+jwt'), (_req, res) => {
    res.json(deps.settings.get());
  });

  router.patch('/admin/config', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const updated = deps.settings.update((req.body ?? {}) as RuntimeSettingsPatch);
    deps.storage.auditLog
      .append({
        agentId: null,
        hostId: getAuth(res).host?.id ?? null,
        eventType: 'admin.config.update',
        capability: null,
        connectionId: null,
        operation: null,
        outcome: 'success',
        argsHash: null,
        durationMs: null,
      })
      .then(() => {
        res.json(updated);
      })
      .catch(next);
  });

  return router;
}
