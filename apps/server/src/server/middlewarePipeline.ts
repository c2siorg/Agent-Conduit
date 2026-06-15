import type { RequestHandler } from 'express';
import type { AppDependencies } from './dependencies.js';

/**
 * buildGlobalMiddleware — the global middleware chain, in fixed order (reads top-to-bottom):
 *   1. requestContext   — assign a request id + start timer
 *   2. securityHeaders  — Helmet (HSTS/CSP/…)
 *   3. bodyLimits       — JSON body + header size caps from config
 *   4. rateLimiting     — per agent/host/user/IP + unknown-host registration cap
 *   5. auditLogging     — structured access log (args hashed, never raw)
 *
 * Per-route JWT pipelines mount AFTER this chain; the error handler mounts LAST.
 * @remarks Stub.
 */
export function buildGlobalMiddleware(_deps: AppDependencies): RequestHandler[] {
  throw new Error('buildGlobalMiddleware not implemented');
}
