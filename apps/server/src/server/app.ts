import type { Express } from 'express';
import type { AppDependencies } from './dependencies.js';

/**
 * createApp — the FACADE / composition root for the HTTP surface.
 *
 * Builds the Express app, mounts the global middleware chain, then the route groups
 * (discovery, identity, capabilities, token router, admin), and finally the error handler.
 * Dependencies are injected — no service is constructed in here.
 * @remarks Stub.
 */
export function createApp(_deps: AppDependencies): Express {
  throw new Error('createApp not implemented');
}
