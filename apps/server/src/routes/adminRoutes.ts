import { ConduitError, ErrorCode } from '@conduit/core';
import type { AuditOutcome } from '@conduit/core';
import type { ConnectorRegistry } from '@conduit/connectors';
import type { AuditQuery, PageQuery, StorageDriver } from '@conduit/storage';
import { Router } from 'express';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConnectionRegistryService } from '../connections/connectionRegistry.js';
import type { ConduitConfig } from '../config/configSchema.js';
import { buildComplianceReport, complianceSummary } from '../observability/compliance.js';
import { riskLevel, riskRank } from '../policy/risk.js';
import { getAuth, requireJwt } from '../server/authMiddleware.js';
import type { RuntimeSettingsPatch, RuntimeSettingsStore } from '../server/runtimeSettings.js';

export interface AdminRoutesDeps {
  storage: StorageDriver;
  connectionRegistry: ConnectionRegistryService;
  connectors: ConnectorRegistry;
  settings: RuntimeSettingsStore;
  config: ConduitConfig;
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
            task_id: e.taskId,
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

  // Per-agent blast radius (summed risk of active grants). Drives the risk column on the agents list.
  router.get('/agents/risk', (_req, res, next) => {
    deps.storage.agents
      .list({ limit: 500 })
      .then(async (page) => {
        const rows = await Promise.all(
          page.items.map(async (a) => {
            const grants = await deps.storage.capabilityGrants.findForAgent(a.id);
            const active = grants.filter((g) => g.status === 'active');
            const total = active.reduce((s, g) => s + riskRank(riskLevel(g.operation, g.capability)), 0);
            const level = total >= 8 ? 'high' : total >= 3 ? 'med' : 'low';
            return { agent_id: a.id, active_grants: active.length, blast_radius: total, level };
          }),
        );
        res.json({ agents: rows });
      })
      .catch(next);
  });

  // Agent ↔ connector authorizations (the "wiring" the dashboard drag-and-drop manages). No secrets.
  router.get('/agents/:id/connections', (req, res, next) => {
    deps.connectionRegistry
      .listAgentConnections(req.params['id'] ?? '')
      .then((items) => {
        res.json({
          connections: items.map((g) => ({
            connection_id: g.connectionId,
            name: g.name,
            platform: g.platform,
            allowed_operations: g.allowedOperations,
            rate_limit: g.rateLimit,
          })),
        });
      })
      .catch(next);
  });

  router.post('/agents/:id/connections', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as { connection_id?: string; allowed_operations?: string[]; rate_limit?: number | null };
    if (!body.connection_id) {
      next(new ConduitError(ErrorCode.invalidRequest, 'connection_id is required', 400));
      return;
    }
    deps.connectionRegistry
      .attachConnection(
        host.id,
        req.params['id'] ?? '',
        body.connection_id,
        Array.isArray(body.allowed_operations) ? body.allowed_operations : [],
        typeof body.rate_limit === 'number' ? body.rate_limit : null,
      )
      .then((g) => {
        res.status(201).json({ connection_id: g.connectionId, allowed_operations: g.allowedOperations, rate_limit: g.rateLimit });
      })
      .catch(next);
  });

  router.delete('/agents/:id/connections/:connectionId', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    deps.connectionRegistry
      .detachConnection(host.id, req.params['id'] ?? '', req.params['connectionId'] ?? '')
      .then(() => {
        res.json({ detached: true });
      })
      .catch(next);
  });

  // Grants for one agent (drives the topology / blast-radius view). No secrets. Each grant is flagged as
  // `blocked` (a "broken wire") when the agent has connector authorizations but this grant's connection
  // isn't authorized (or its operation isn't permitted) — i.e. the two grant layers disagree and the
  // capability would 403 at execute.
  router.get('/agents/:id/grants', (req, res, next) => {
    const agentId = req.params['id'] ?? '';
    Promise.all([
      deps.storage.capabilityGrants.findForAgent(agentId),
      deps.storage.connectionGrants.listByAgent(agentId),
    ])
      .then(([grants, connGrants]) => {
        const hasConnAuthz = connGrants.length > 0;
        res.json({
          grants: grants.map((g) => {
            let blocked = false;
            if (hasConnAuthz && g.connectionId) {
              const authz = connGrants.find((c) => c.connectionId === g.connectionId);
              blocked =
                !authz ||
                (authz.allowedOperations.length > 0 && g.operation != null && !authz.allowedOperations.includes(g.operation));
            }
            return {
              capability: g.capability,
              connection_id: g.connectionId,
              operation: g.operation,
              task_id: g.taskId,
              status: g.status,
              risk: riskLevel(g.operation, g.capability),
              blocked,
            };
          }),
        });
      })
      .catch(next);
  });

  // Compliance posture: control catalog mapped to Conduit's live enforcement.
  router.get('/compliance', (_req, res) => {
    const domains = buildComplianceReport(deps.settings.get(), deps.config);
    res.json({ summary: complianceSummary(domains), domains });
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
        taskId: null,
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
