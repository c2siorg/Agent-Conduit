import type { StorageDriver } from './storageDriver.js';

/**
 * Resolved `storage` config section handed to the factory.
 * Keyed by driver name so each backend reads its own block (e.g. `postgres`, `mysql`).
 */
export interface StorageConfig {
  driver: string;
  [backend: string]: unknown;
}

/**
 * createStorageDriver — FACTORY that maps `config.driver` → a concrete StorageDriver.
 * Adding a backend registers here; it never requires editing the pillars.
 * @remarks Stub.
 */
export function createStorageDriver(config: StorageConfig): StorageDriver {
  throw new Error(`createStorageDriver('${config.driver}') not implemented`);
}
