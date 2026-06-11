import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 1 typ check — reject if the JWT `typ` header ≠ the endpoint's expected type
 * (`agent+jwt` vs `host+jwt`). Prevents token confusion. No DB lookup yet.
 * @remarks Stub.
 */
export class TypCheckStage implements JwtPipelineStage {
  readonly name = 'typCheck';

  execute(_ctx: AuthContext): Promise<void> {
    throw new Error('TypCheckStage.execute not implemented');
  }
}
