/**
 * @conduit/connectors — pluggable platform drivers behind one PlatformDriver interface.
 *
 * Core hand-written drivers: MockDriver (testing), RestDriver (generic HTTP), SlackDriver (reference).
 * Everything else is declarative: ~45 platforms are described as ConnectorManifests and executed by the
 * generic ManifestDriver (see manifest/manifests.ts). Add a platform by adding a manifest — no new class.
 */
export * from './platformDriver.js';
export * from './connectorRegistry.js';
export { SlackDriver } from './drivers/slack/slackDriver.js';
export { RestDriver } from './drivers/rest/restDriver.js';
export { MockDriver } from './drivers/mock/mockDriver.js';
export { ManifestDriver } from './manifest/manifestDriver.js';
export { BUNDLED_MANIFESTS, UNSUPPORTED_PLATFORMS } from './manifest/manifests.js';
export type { ConnectorManifest, ManifestOperation } from './manifest/connectorManifest.js';
