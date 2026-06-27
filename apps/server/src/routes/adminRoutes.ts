import { ConduitError, ErrorCode } from '@conduit/core';
import type { AuditOutcome } from '@conduit/core';
import type { AuditQuery, PageQuery, StorageDriver } from '@conduit/storage';
import { Router } from 'express';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConnectionRegistryService } from '../connections/connectionRegistry.js';
import { requireJwt } from '../server/authMiddleware.js';

export interface AdminRoutesDeps {
  storage: StorageDriver;
  connectionRegistry: ConnectionRegistryService;
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

  return router;
}
