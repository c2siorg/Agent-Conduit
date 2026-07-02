import { ConduitError, ErrorCode } from '@conduit/core';
import type { AdapterType } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import { Router } from 'express';
import type { AuthContext } from '../auth/authContext.js';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { SchemaCache } from '../router/schemaCache.js';
import type { TokenRouter } from '../router/tokenRouter.js';
import { bearerToken, requireJwt } from '../server/authMiddleware.js';

export interface ToolRoutesDeps {
  tokenRouter: TokenRouter;
  storage: StorageDriver;
  cache: SchemaCache;
  agentPipeline: JwtPipeline;
  hostPipeline: JwtPipeline;
}

const ADAPTER_TYPES: readonly AdapterType[] = ['mcp', 'openapi', 'cli'];

/**
 * Token Router + tool registry routes:
 *   POST /tools        (host JWT) - register/update a tool bound to an adapter.
 *   GET  /tools        - list registered tools (names + adapter type only; NEVER schemas).
 *   POST /tools/flush  (host JWT) - flush the per-tool schema cache.
 *   GET  /tools/:name  (agent JWT) - serve the tool schema on demand, identity-scoped (403 if ungranted).
 */
export function toolRoutes(deps: ToolRoutesDeps): Router {
  const router = Router();

  router.post('/tools', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const body = (req.body ?? {}) as {
      name?: string;
      adapter_type?: string;
      adapter_config?: Record<string, unknown>;
    };
    if (!body.name || !body.adapter_type) {
      next(new ConduitError(ErrorCode.invalidRequest, 'name and adapter_type are required', 400));
      return;
    }
    if (!ADAPTER_TYPES.includes(body.adapter_type as AdapterType)) {
      next(new ConduitError(ErrorCode.invalidRequest, `adapter_type must be one of ${ADAPTER_TYPES.join(', ')}`, 400));
      return;
    }
    deps.storage.tools
      .upsert({
        name: body.name,
        adapterType: body.adapter_type as AdapterType,
        adapterConfig: body.adapter_config ?? {},
      })
      .then((tool) => {
        deps.cache.invalidate(tool.name); // registration changes invalidate the cached schema
        res.status(201).json({ name: tool.name, adapter_type: tool.adapterType });
      })
      .catch(next);
  });

  router.get('/tools', (_req, res, next) => {
    deps.storage.tools
      .list({})
      .then((page) => {
        res.json({
          tools: page.items.map((t) => ({
            name: t.name,
            adapter_type: t.adapterType,
            schema_cached_at: t.schemaCachedAt,
          })),
          has_more: page.hasMore,
        });
      })
      .catch(next);
  });

  router.post('/tools/flush', requireJwt(deps.hostPipeline, 'host+jwt'), (_req, res) => {
    deps.cache.flush();
    res.json({ flushed: true });
  });

  router.get('/tools/:name', (req, res, next) => {
    const token = bearerToken(req);
    if (!token) {
      next(new ConduitError(ErrorCode.authenticationRequired, 'missing bearer token', 401));
      return;
    }
    const name = req.params['name'];
    if (!name) {
      next(new ConduitError(ErrorCode.invalidRequest, 'tool name is required', 400));
      return;
    }
    const ctx: AuthContext = { token, expectedTyp: 'agent+jwt' };
    deps.agentPipeline
      .run(ctx)
      .then(async () => {
        if (!ctx.agent) {
          throw new ConduitError(ErrorCode.internalError, 'agent not resolved', 500);
        }
        const result = await deps.tokenRouter.getToolSchema(ctx.agent.id, name);
        res.json({ ...result.schema, token_estimate: result.tokenEstimate, cached: result.cached });
      })
      .catch(next);
  });

  return router;
}
