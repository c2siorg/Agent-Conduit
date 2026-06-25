import { ConduitError, ErrorCode } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';
import type { PipelineConfig } from './pipelineConfig.js';

/**
 * 3. claim validation — `aud` binding, `exp`, `iat`, and `jti` replay (against `jti_cache`).
 *
 * Clock skew <= configured tolerance; `iat` may not be further in the future than the skew. The replay
 * cache retains each jti for the full effective window (lifetime + skew). `aud` MUST equal the issuer.
 */
export class ClaimValidationStage implements JwtPipelineStage {
  readonly name = 'claimValidation';

  constructor(
    private readonly storage: StorageDriver,
    private readonly config: PipelineConfig,
  ) {}

  async execute(ctx: AuthContext): Promise<void> {
    const claims = ctx.claims;
    if (!claims) {
      throw new ConduitError(ErrorCode.invalidJwt, 'claims were not decoded', 401);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const skew = this.config.clockSkewSeconds;

    if (claims.aud !== this.config.issuer) {
      throw new ConduitError(ErrorCode.invalidJwt, 'aud does not match issuer', 401);
    }
    if (typeof claims.exp !== 'number' || nowSec > claims.exp + skew) {
      throw new ConduitError(ErrorCode.invalidJwt, 'token expired', 401);
    }
    if (typeof claims.iat !== 'number' || claims.iat > nowSec + skew) {
      throw new ConduitError(ErrorCode.invalidJwt, 'iat is too far in the future', 401);
    }
    if (!claims.jti) {
      throw new ConduitError(ErrorCode.invalidJwt, 'missing jti', 401);
    }

    // Replay: record the jti for lifetime + skew; a second use within the window is rejected.
    const expiresAt = new Date((claims.exp + skew) * 1000);
    const fresh = await this.storage.jtiCache.put(claims.jti, expiresAt);
    if (!fresh) {
      throw new ConduitError(ErrorCode.invalidJwt, 'jti replay detected', 401);
    }
  }
}
