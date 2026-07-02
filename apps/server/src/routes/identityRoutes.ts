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

  router.post('/agent/reactivate', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
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
    deps.identityService
      .reactivateAgent(host.id, body.agent_id)
      .then((agent) => {
        res.json({ agent_id: agent.id, status: agent.status, session_expires_at: agent.sessionExpiresAt });
      })
      .catch(next);
  });

  router.post('/agent/rotate-key', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as { agent_id?: string; agent_public_key?: Jwk };
    if (!body.agent_id || !body.agent_public_key) {
      next(new ConduitError(ErrorCode.invalidRequest, 'agent_id and agent_public_key are required', 400));
      return;
    }
    deps.identityService
      .rotateAgentKey(host.id, body.agent_id, body.agent_public_key)
      .then((agent) => {
        res.json({ agent_id: agent.id, rotated: true });
      })
      .catch(next);
  });

  router.post('/host/revoke', requireJwt(deps.hostPipeline, 'host+jwt'), (_req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    deps.identityService
      .revokeHost(host.id)
      .then(() => {
        res.json({ host_id: host.id, status: 'revoked' });
      })
      .catch(next);
  });

  router.post('/host/rotate-key', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const host = getAuth(res).host;
    if (!host) {
      next(new ConduitError(ErrorCode.unauthorized, 'host not resolved', 401));
      return;
    }
    const body = (req.body ?? {}) as { host_public_key?: Jwk };
    if (!body.host_public_key) {
      next(new ConduitError(ErrorCode.invalidRequest, 'host_public_key is required', 400));
      return;
    }
    deps.identityService
      .rotateHostKey(host.id, body.host_public_key)
      .then((updated) => {
        // The iss thumbprint changes; the client must sign subsequent host JWTs with the new key.
        res.json({ host_id: updated.id, rotated: true });
      })
      .catch(next);
  });

  // Token introspection (AAP §5.12 / RFC 7662). Host-authorized; returns {active:false} for any invalid
  // or inactive token rather than an error.
  router.post('/agent/introspect', requireJwt(deps.hostPipeline, 'host+jwt'), (req, res, next) => {
    const body = (req.body ?? {}) as { token?: string };
    if (!body.token) {
      next(new ConduitError(ErrorCode.invalidRequest, 'token is required', 400));
      return;
    }
    deps.identityService
      .introspect(body.token)
      .then((result) => {
        res.json(result);
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
