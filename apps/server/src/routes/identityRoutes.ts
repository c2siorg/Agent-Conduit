import { ConduitError, ErrorCode } from '@conduit/core';
import type { AgentMode, Jwk } from '@conduit/core';
import { Router } from 'express';
import type { JwtPipeline } from '../auth/jwtPipeline.js';
import type { IdentityService, RegisterAgentInput } from '../identity/identityService.js';
import { getAuth, requireJwt } from '../server/authMiddleware.js';
import { serializeGrant } from './grantView.js';

export interface IdentityRoutesDeps {
  identityService: IdentityService;
  agentPipeline: JwtPipeline;
  hostPipeline: JwtPipeline;
}

/**
 * Identity lifecycle routes (Sprint 1 subset):
 *   POST /agent/register (host JWT) — register + activate an agent under the authenticated host.
 *   GET  /agent/status   (agent JWT) — the agent reads its own lifecycle state.
 */
export function identityRoutes(deps: IdentityRoutesDeps): Router {
  const router = Router();

  router.post('/agent/register', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as {
      agent_public_key?: Jwk;
      mode?: AgentMode;
      capabilities?: string[];
      name?: string;
      description?: string;
    };
    if (!body.agent_public_key) {
      next(new ConduitError(ErrorCode.invalidRequest, 'agent_public_key is required', 400));
      return;
    }
    const mode: AgentMode = body.mode === 'autonomous' ? 'autonomous' : 'delegated';
    const input: RegisterAgentInput = {
      publicKeyJwk: body.agent_public_key,
      mode,
      requestedCapabilities: body.capabilities ?? [],
    };
    if (typeof body.name === 'string' && body.name.trim()) {
      input.name = body.name.trim();
    }
    if (typeof body.description === 'string' && body.description.trim()) {
      input.description = body.description.trim();
    }
    deps.identityService
      .registerAgent(host.id, input)
      .then((agent) => {
        res.status(201).json({ agent_id: agent.id, status: agent.status, mode: agent.mode, name: agent.name });
      })
      .catch(next);
  });

  router.post('/agent/revoke', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as { agent_id?: string };
    if (!body.agent_id) {
      next(new ConduitError(ErrorCode.invalidRequest, 'agent_id is required', 400));
      return;
    }
    const agentId = body.agent_id;
    deps.identityService
      .revokeAgent(host.id, agentId)
      .then(() => {
        res.json({ agent_id: agentId, status: 'revoked' });
      })
      .catch(next);
  });

  router.post('/agent/update', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as { agent_id?: string; name?: string; description?: string };
    if (!body.agent_id) {
      next(new ConduitError(ErrorCode.invalidRequest, 'agent_id is required', 400));
      return;
    }
    const agentId = body.agent_id;
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
    const description =
      typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
    deps.identityService
      .updateAgentMetadata(host.id, agentId, name, description)
      .then(() => {
        res.json({ agent_id: agentId, name, description });
      })
      .catch(next);
  });

  router.get('/agent/status', requireJwt(deps.agentPipeline, 'agent+jwt'), (_req, res, next) => {
    const agent = getAuth(res).agent;
    if (!agent) {
      next(new ConduitError(ErrorCode.agentNotFound, 'agent not resolved', 401));
      return;
    }
    deps.identityService
      .listGrants(agent.id)
      .then((grants) => {
        res.json({
          agent_id: agent.id,
          host_id: agent.hostId,
          name: agent.name,
          status: agent.status,
          mode: agent.mode,
          agent_capability_grants: grants.map(serializeGrant),
          created_at: agent.createdAt,
          last_used_at: null,
          expires_at: agent.sessionExpiresAt,
          absolute_expires_at: agent.absoluteExpiresAt,
        });
      })
      .catch(next);
  });

  return router;
}
