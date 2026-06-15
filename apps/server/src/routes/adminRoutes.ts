import type { Router } from 'express';
import type { AppDependencies } from '../server/dependencies.js';

/**
 * Admin + observability routes (admin-authenticated; consumed by the dashboard):
 *   GET  /audit                 — queryable/filterable audit log (export)
 *   GET  /connections           — connection vault status (NEVER returns credential values)
 *   POST /connections           — register a credential (admin only)
 *   POST /connections/:id/rotate — re-authenticate / rotate a credential
 *   GET  /agents                — cryptographic registry (status, last activity)
 *   GET  /events                — security event stream (SSE)
 * @remarks Stub.
 */
export function adminRoutes(_deps: AppDependencies): Router {
  throw new Error('adminRoutes not implemented');
}
