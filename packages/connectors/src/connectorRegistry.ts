import { GitHubDriver } from './drivers/github/githubDriver.js';
import { MockDriver } from './drivers/mock/mockDriver.js';
import { RestDriver } from './drivers/rest/restDriver.js';
import { SlackDriver } from './drivers/slack/slackDriver.js';
import type { PlatformDriver } from './platformDriver.js';

/**
 * ConnectorRegistry — REGISTRY pattern.
 * Bundled and custom drivers register here; Conduit resolves a driver by platform id.
 * Deployers add connectors by registering a PlatformDriver - no forking, no pillar edits.
 */
export interface ConnectorRegistry {
  register(driver: PlatformDriver): void;
  get(platform: string): PlatformDriver | undefined;
  list(): PlatformDriver[];
}

const BUNDLED: Record<string, () => PlatformDriver> = {
  mock: () => new MockDriver(),
  rest: () => new RestDriver(),
  slack: () => new SlackDriver(),
  github: () => new GitHubDriver(),
};

/**
 * Build a registry pre-loaded with the bundled drivers named in `enabled` (from config). The built-in
 * `mock` connector is always available so the execution path can be exercised without an external platform.
 */
export function createConnectorRegistry(enabled: string[]): ConnectorRegistry {
  const drivers = new Map<string, PlatformDriver>();
  for (const name of new Set([...enabled, 'mock'])) {
    const factory = BUNDLED[name];
    if (factory) {
      drivers.set(name, factory());
    }
  }
  return {
    register(driver) {
      drivers.set(driver.platform, driver);
    },
    get(platform) {
      return drivers.get(platform);
    },
    list() {
      return [...drivers.values()];
    },
  };
}
