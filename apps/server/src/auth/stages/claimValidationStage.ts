import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 3 claim validation — `aud` binding, `exp`, `iat`, and `jti` replay check against `jti_cache`.
 *
 * Clock skew ≤ 30s; reject `iat` more than 30s in the future. The replay cache MUST cover the full
 * effective window (JWT lifetime + skew, default 90s). `aud` MUST equal this server's issuer (or the
 * resolved capability `location` for execute) — reject cross-server reuse (AAP §8.18).
 * @remarks Stub.
 */
export class ClaimValidationStage implements JwtPipelineStage {
  readonly name = 'claimValidation';

  constructor(private readonly storage: StorageDriver) {}

  execute(_ctx: AuthContext): Promise<void> {
    throw new Error('ClaimValidationStage.execute not implemented');
  }
}
