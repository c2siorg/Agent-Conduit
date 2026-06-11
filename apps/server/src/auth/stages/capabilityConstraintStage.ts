import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';
import type { ConstraintEngine } from '../../identity/constraintEngine.js';

/**
 * 5 capability + constraint check — for execution only.
 *
 * Verifies the grant exists and is `active`, INTERSECTS the JWT `capabilities` claim with granted
 * capabilities (verification step 11), then validates supplied args against all constraints.
 * Violations → `403 constraint_violated` with a `violations` array.
 * @remarks Stub.
 */
export class CapabilityConstraintStage implements JwtPipelineStage {
  readonly name = 'capabilityConstraint';

  constructor(
    private readonly constraintEngine: ConstraintEngine,
    private readonly storage: StorageDriver,
  ) {}

  execute(_ctx: AuthContext): Promise<void> {
    throw new Error('CapabilityConstraintStage.execute not implemented');
  }
}
