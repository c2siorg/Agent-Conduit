import type { PlatformDriver } from './platformDriver.js';

/**
 * ConnectorRegistry — REGISTRY pattern.
 * Bundled and custom drivers register here; Conduit resolves a driver by platform id.
 * Deployers add connectors by registering a PlatformDriver — no forking, no pillar edits.
 */
export interface ConnectorRegistry {
  register(driver: PlatformDriver): void;
  get(platform: string): PlatformDriver | undefined;
  list(): PlatformDriver[];
}

/**
 * Build a registry pre-loaded with the bundled drivers named in `enabled`
 * (from `connectors.enabled` in config).
 * @remarks Stub.
 */
export function createConnectorRegistry(enabled: string[]): ConnectorRegistry {
  throw new Error('createConnectorRegistry not implemented');
}
