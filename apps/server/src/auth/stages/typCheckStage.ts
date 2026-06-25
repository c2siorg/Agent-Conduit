import { ConduitError, ErrorCode } from '@conduit/core';
import { decodeJwt } from '@conduit/crypto';
import type { AuthContext } from '../authContext.js';
import type { JwtPipelineStage } from '../jwtPipeline.js';

/**
 * 1. typ check — reject if the JWT `typ` header does not match the endpoint's expected type
 * (`agent+jwt` vs `host+jwt`). Prevents token confusion. No DB lookup, no signature check yet.
 */
export class TypCheckStage implements JwtPipelineStage {
  readonly name = 'typCheck';

  execute(ctx: AuthContext): Promise<void> {
    let typ: string | undefined;
    try {
      typ = decodeJwt(ctx.token).header.typ;
    } catch {
      throw new ConduitError(ErrorCode.invalidJwt, 'malformed JWT', 401);
    }
    if (typ !== ctx.expectedTyp) {
      throw new ConduitError(ErrorCode.invalidJwt, `unexpected token type: ${typ ?? 'none'}`, 401);
    }
    ctx.decodedTyp = ctx.expectedTyp;
    return Promise.resolve();
  }
}
