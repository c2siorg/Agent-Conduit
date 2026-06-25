import { ConduitError, ErrorCode } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 4. state check — the host must be active; for agent tokens the agent must be active and within all
 * three lifetime clocks. State is read fresh (never cached past revocation), so a revoked principal
 * fails here immediately.
 */
export class StateCheckStage implements JwtPipelineStage {
  readonly name = 'stateCheck';

  constructor(private readonly storage: StorageDriver) {}

  execute(ctx: AuthContext): Promise<void> {
    const host = ctx.host;
    if (!host) {
      throw new ConduitError(ErrorCode.hostNotFound, 'host not resolved', 401);
    }
    if (host.status !== 'active') {
      if (host.status === 'revoked') {
        throw new ConduitError(ErrorCode.hostRevoked, 'host revoked', 403);
      }
      if (host.status === 'pending') {
        throw new ConduitError(ErrorCode.hostPending, 'host pending approval', 403);
      }
      throw new ConduitError(ErrorCode.unauthorized, `host not active: ${host.status}`, 403);
    }

    if (ctx.expectedTyp === 'host+jwt') {
      return Promise.resolve(); // host pipeline ends at the state check
    }

    const agent = ctx.agent;
    if (!agent) {
      throw new ConduitError(ErrorCode.agentNotFound, 'agent not resolved', 401);
    }
    switch (agent.status) {
      case 'active':
        break;
      case 'pending':
        throw new ConduitError(ErrorCode.agentPending, 'agent pending approval', 403);
      case 'expired':
        throw new ConduitError(ErrorCode.agentExpired, 'agent expired', 403);
      case 'revoked':
        throw new ConduitError(ErrorCode.agentRevoked, 'agent revoked', 403);
      case 'rejected':
        throw new ConduitError(ErrorCode.agentRejected, 'agent rejected', 403);
      case 'claimed':
        throw new ConduitError(ErrorCode.agentClaimed, 'agent claimed', 403);
      default:
        throw new ConduitError(ErrorCode.unauthorized, 'agent not active', 403);
    }

    const now = Date.now();
    if (agent.absoluteExpiresAt && now > agent.absoluteExpiresAt.getTime()) {
      throw new ConduitError(ErrorCode.absoluteLifetimeExceeded, 'absolute lifetime exceeded', 403);
    }
    if (agent.maxLifetimeExpiresAt && now > agent.maxLifetimeExpiresAt.getTime()) {
      throw new ConduitError(ErrorCode.agentExpired, 'max lifetime exceeded', 403);
    }
    if (agent.sessionExpiresAt && now > agent.sessionExpiresAt.getTime()) {
      throw new ConduitError(ErrorCode.agentExpired, 'session expired', 403);
    }
    return Promise.resolve();
  }
}
