import { ConduitError, ErrorCode } from '@conduit/core';
import type { JwtTyp } from '@conduit/core';
import type { RequestHandler } from 'express';
import type { AuthContext } from '../auth/authContext.js';
import type { JwtPipeline } from '../auth/jwtPipeline.js';

const BEARER = 'Bearer ';

/** Extract the bearer token from a request's Authorization header (used by routes that run the pipeline manually). */
export function bearerToken(req: { headers: { authorization?: string | undefined } }): string | undefined {
  const header = req.headers.authorization;
  return header && header.startsWith(BEARER) ? header.slice(BEARER.length) : undefined;
}

/**
 * Build middleware that runs the given JWT pipeline for the expected token type before the handler.
 * On success the verified `AuthContext` is stashed on `res.locals.auth`; on failure the `ConduitError`
 * is forwarded to the error handler.
 */
export function requireJwt(pipeline: JwtPipeline, expectedTyp: JwtTyp): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    const token = header && header.startsWith(BEARER) ? header.slice(BEARER.length) : undefined;
    if (!token) {
      next(new ConduitError(ErrorCode.authenticationRequired, 'missing bearer token', 401));
      return;
    }
    const ctx: AuthContext = { token, expectedTyp };
    pipeline
      .run(ctx)
      .then(() => {
        res.locals['auth'] = ctx;
        next();
      })
      .catch((err: unknown) => {
        next(err);
      });
  };
}

/** Read the AuthContext stashed by `requireJwt`. */
export function getAuth(res: { locals: Record<string, unknown> }): AuthContext {
  return res.locals['auth'] as AuthContext;
}
