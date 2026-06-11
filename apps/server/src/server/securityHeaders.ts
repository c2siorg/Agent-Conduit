import type { RequestHandler } from 'express';

/**
 * securityHeaders — Helmet-based headers on ALL responses:
 * HSTS, CSP, X-Frame-Options, X-Content-Type-Options (and friends).
 * @remarks Stub.
 */
export function securityHeaders(): RequestHandler {
  throw new Error('securityHeaders not implemented');
}
