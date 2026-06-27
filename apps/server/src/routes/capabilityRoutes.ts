import { ConduitError, ErrorCode } from '@conduit/core';
import type { Constraint } from '@conduit/core';
import { Router } from 'express';
import type { AuthContext } from '../auth/authContext.js';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { ConnectionProxy } from '../connections/connectionProxy.js';
import type { CapabilityRequest, IdentityService } from '../identity/identityService.js';
import { bearerToken, getAuth, requireJwt } from '../server/authMiddleware.js';
import { makeUserCode, serializeGrant } from './grantView.js';

export interface CapabilityRoutesDeps {
  identityService: IdentityService;
  connectionProxy: ConnectionProxy;
  agentPipeline: JwtPipeline;
  hostPipeline: JwtPipeline;
  /** Public base URL, used to build the approval `verification_uri` (AAP §7). */
  baseUrl: string;
}

/**
 * Capability routes:
 *   POST /agent/grant       (host JWT) - grant a capability (mapped to connection+operation) to an agent.
 *   POST /capability/execute (agent JWT) - run the full pipeline (stages 1-5) then execute via the proxy.
 */
export function capabilityRoutes(deps: CapabilityRoutesDeps): Router {
  const router = Router();

  router.post('/agent/grant', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as {
      agent_id?: string;
      capability?: string;
      connection_id?: string;
      operation?: string;
      constraints?: Record<string, Constraint>;
    };
    if (!body.agent_id || !body.capability) {
      next(new ConduitError(ErrorCode.invalidRequest, 'agent_id and capability are required', 400));
      return;
    }
    deps.identityService
      .grantCapability(host.id, {
        agentId: body.agent_id,
        capability: body.capability,
        connectionId: body.connection_id ?? null,
        operation: body.operation ?? null,
        constraints: body.constraints ?? {},
      })
      .then((grant) => {
        res.status(201).json({ grant_id: grant.id, capability: grant.capability, status: grant.status });
      })
      .catch(next);
  });

  router.post('/agent/request-capability', (req, res, next) => {
    const token = bearerToken(req);
    if (!token) {
      next(new ConduitError(ErrorCode.authenticationRequired, 'missing bearer token', 401));
      return;
    }
    const body = (req.body ?? {}) as {
      capabilities?: Array<{ name?: string; constraints?: Record<string, Constraint> }>;
      binding_message?: string;
    };
    const requests: CapabilityRequest[] = (body.capabilities ?? [])
      .filter((c): c is { name: string; constraints?: Record<string, Constraint> } => typeof c?.name === 'string')
      .map((c) => ({ name: c.name, constraints: c.constraints ?? {} }));
    if (requests.length === 0) {
      next(new ConduitError(ErrorCode.invalidRequest, 'capabilities[] is required', 400));
      return;
    }

    const ctx: AuthContext = { token, expectedTyp: 'agent+jwt' };
    deps.agentPipeline
      .run(ctx)
      .then(async () => {
        if (!ctx.agent) {
          throw new ConduitError(ErrorCode.internalError, 'agent not resolved', 500);
        }
        const grants = await deps.identityService.requestCapability(ctx.agent.id, requests);
        const pendingApproval = grants.some((g) => g.status !== 'active');
        const responseBody: Record<string, unknown> = {
          agent_id: ctx.agent.id,
          agent_capability_grants: grants.map(serializeGrant),
        };
        if (pendingApproval) {
          // Conduit's approver is the operator; the device-authorization code points them at the
          // dashboard approvals screen, where they map each pending capability to a connection.
          const userCode = makeUserCode();
          responseBody['approval'] = {
            method: 'device_authorization',
            verification_uri: `${deps.baseUrl}/approvals`,
            verification_uri_complete: `${deps.baseUrl}/approvals?user_code=${userCode}`,
            user_code: userCode,
            expires_in: 300,
            interval: 5,
            ...(body.binding_message ? { binding_message: body.binding_message } : {}),
          };
        }
        res.status(pendingApproval ? 202 : 200).json(responseBody);
      })
      .catch(next);
  });

  router.get('/capability/list', (req, res, next) => {
    const token = bearerToken(req);
    if (!token) {
      next(new ConduitError(ErrorCode.authenticationRequired, 'missing bearer token', 401));
      return;
    }
    const ctx: AuthContext = { token, expectedTyp: 'agent+jwt' };
    deps.agentPipeline
      .run(ctx)
      .then(async () => {
        if (!ctx.agent) {
          throw new ConduitError(ErrorCode.internalError, 'agent not resolved', 500);
        }
        const grants = await deps.identityService.listGrants(ctx.agent.id);
        res.json({
          capabilities: grants.map((g) => ({
            name: g.capability,
            description: g.operation ? `Executes "${g.operation}"` : 'Awaiting operator mapping',
            grant_status: g.status === 'active' ? 'granted' : 'not_granted',
          })),
          next_cursor: null,
          has_more: false,
        });
      })
      .catch(next);
  });

  router.post('/capability/execute', (req, res, next) => {
    const token = bearerToken(req);
    if (!token) {
      next(new ConduitError(ErrorCode.authenticationRequired, 'missing bearer token', 401));
      return;
    }
    const body = (req.body ?? {}) as { capability?: string; args?: Record<string, unknown> };
    if (!body.capability) {
      next(new ConduitError(ErrorCode.invalidRequest, 'capability is required', 400));
      return;
    }
    const ctx: AuthContext = {
      token,
      expectedTyp: 'agent+jwt',
      capability: body.capability,
      args: body.args ?? {},
    };
    deps.agentPipeline
      .run(ctx)
      .then(async () => {
        if (!ctx.agent || !ctx.grant) {
          throw new ConduitError(ErrorCode.internalError, 'authorization incomplete', 500);
        }
        const result = await deps.connectionProxy.execute(ctx.agent, ctx.grant, ctx.args ?? {});
        res.json({ data: result.data });
      })
      .catch(next);
  });

  return router;
}
