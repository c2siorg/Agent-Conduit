import { ConduitError, ErrorCode } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { ConstraintEngine } from '../../identity/constraintEngine.js';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 5. capability + constraint check - execution only.
 *
 * Non-execute requests carry no capability and skip this stage. For execute:
 *   - intersect the JWT `capabilities` claim with the request (verification step 11),
 *   - look up an active, unexpired grant for (agent, capability) -> 403 capability_not_granted,
 *   - validate args against the grant's constraints -> 403 constraint_violated (with violations),
 *   - attach the grant to ctx for the connection proxy.
 */
export class CapabilityConstraintStage implements JwtPipelineStage {
  readonly name = 'capabilityConstraint';

  constructor(
    private readonly constraintEngine: ConstraintEngine,
    private readonly storage: StorageDriver,
  ) {}

  async execute(ctx: AuthContext): Promise<void> {
    if (!ctx.capability) {
      return;
    }
    const agent = ctx.agent;
    if (!agent) {
      throw new ConduitError(ErrorCode.unauthorized, 'agent not resolved', 401);
    }

    // JWT-level capability restriction (step 11): if the token narrows capabilities, enforce it.
    const jwtCaps = (ctx.claims as { capabilities?: string[] } | undefined)?.capabilities;
    if (jwtCaps && !jwtCaps.includes(ctx.capability)) {
      throw new ConduitError(ErrorCode.capabilityNotGranted, 'capability not permitted by this JWT', 403);
    }

    const grant = await this.storage.capabilityGrants.findActive(agent.id, ctx.capability);
    if (!grant) {
      throw new ConduitError(ErrorCode.capabilityNotGranted, `capability not granted: ${ctx.capability}`, 403);
    }

    const violations = this.constraintEngine.validate(grant.constraints, ctx.args ?? {});
    if (violations.length > 0) {
      throw new ConduitError(ErrorCode.constraintViolated, 'constraint violated', 403, { violations });
    }

    ctx.grant = grant;
  }
}
