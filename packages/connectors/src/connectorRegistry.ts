import { MockDriver } from './drivers/mock/mockDriver.js';
import { RestDriver } from './drivers/rest/restDriver.js';
import { SlackDriver } from './drivers/slack/slackDriver.js';
import { ManifestDriver } from './manifest/manifestDriver.js';
import { BUNDLED_MANIFESTS } from './manifest/manifests.js';
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

/** Core hand-written drivers (mock for testing, generic REST/GraphQL, the reference Slack driver). */
function coreDrivers(): PlatformDriver[] {
  return [new MockDriver(), new RestDriver(), new SlackDriver()];
}

/**
 * Build a registry pre-loaded with every bundled connector: the core drivers plus one ManifestDriver per
 * bundled manifest (~45 platforms). Availability of a driver does NOT grant access — an admin still has to
 * register a connection with credentials and grant it to an agent — so all bundled connectors are loaded.
 *
 * `enabled` may name additional/custom platforms to keep, but is not required; it is retained for config
 * compatibility. Custom drivers are added at runtime via `register`.
 */
export function createConnectorRegistry(_enabled: string[] = []): ConnectorRegistry {
  const drivers = new Map<string, PlatformDriver>();
  const add = (driver: PlatformDriver): void => {
    drivers.set(driver.platform, driver);
  };
  for (const driver of coreDrivers()) {
    add(driver);
  }
  for (const manifest of BUNDLED_MANIFESTS) {
    add(new ManifestDriver(manifest));
  }
  return {
    register: add,
    get(platform) {
      return drivers.get(platform);
    },
    list() {
      return [...drivers.values()];
    },
  };
}
