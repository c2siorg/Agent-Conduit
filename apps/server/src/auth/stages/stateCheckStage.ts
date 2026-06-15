import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 4 state check — verify the agent/host is `active` (not pending/expired/revoked/rejected/claimed).
 *
 * State is NEVER cached such that a revoked principal could still pass. Also evaluates the three
 * lifetime clocks (session / max / absolute); an elapsed absolute clock means permanent `revoked`.
 * @remarks Stub.
 */
export class StateCheckStage implements JwtPipelineStage {
  readonly name = 'stateCheck';

  constructor(private readonly storage: StorageDriver) {}

  execute(_ctx: AuthContext): Promise<void> {
    throw new Error('StateCheckStage.execute not implemented');
  }
}
