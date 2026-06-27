// Superseded by gatewayApp.ts (which mounts discovery + identity + admin + health + error handler).
// Re-exported here for compatibility.
export { createGatewayApp, type GatewayAppDeps } from './gatewayApp.js';
