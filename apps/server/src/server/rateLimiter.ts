import { ConduitError, ErrorCode } from '@conduit/core';
import type { Request, RequestHandler } from 'express';

/**
 * Fixed-window in-memory rate limiter. `check` counts a hit against `key` and reports whether it is
 * within `max` for the current window, plus how long until the window resets. Expired buckets are swept
 * lazily so the map does not grow without bound.
 */
export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter(
  windowMs: number,
  max: number | (() => number),
  now: () => number = () => Date.now(),
): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = now();
  const maxOf = (): number => (typeof max === 'function' ? max() : max);

  return {
    check(key) {
      const t = now();
      const limit = maxOf();
      if (t - lastSweep > windowMs) {
        for (const [k, b] of buckets) {
          if (b.resetAt <= t) {
            buckets.delete(k);
          }
        }
        lastSweep = t;
      }
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= t) {
        bucket = { count: 0, resetAt: t + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Client IP, defaulting to the socket address (do NOT trust X-Forwarded-For unless behind a trusted proxy). */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Rate-limit middleware. On breach it sets `Retry-After` and raises `rate_limited` (429), which the error
 * handler also publishes to the security event stream.
 */
export function rateLimit(
  limiter: RateLimiter,
  keyFn: (req: Request) => string,
  opts: { skip?: (req: Request) => boolean } = {},
): RequestHandler {
  return (req, res, next) => {
    if (opts.skip?.(req)) {
      next();
      return;
    }
    const { allowed, retryAfterSeconds } = limiter.check(keyFn(req));
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(new ConduitError(ErrorCode.rateLimited, 'rate limit exceeded', 429, { retry_after: retryAfterSeconds }));
      return;
    }
    next();
  };
}
