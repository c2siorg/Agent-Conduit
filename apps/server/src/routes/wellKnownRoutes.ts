import { Router } from 'express';
import { AAP_VERSION, type AgentConfiguration } from '@conduit/core';
import type { ConduitConfig } from '../config/configSchema.js';

export interface WellKnownDeps {
  config: ConduitConfig;
}

/**
 * Build the AAP discovery document (§5.1) from config. Endpoint values are paths relative to `issuer`.
 * `provider_name`, `algorithms` (Ed25519), and `modes` follow the spec exactly.
 */
export function buildAgentConfiguration(config: ConduitConfig): AgentConfiguration {
  const issuer = config.server.baseUrl.replace(/\/+$/, '');
  return {
    version: AAP_VERSION,
    provider_name: 'agent-conduit',
    description:
      'Agent Conduit — self-hosted unified gateway for AAP identity, governed connections, and tool routing.',
    issuer,
    default_location: `${issuer}/capability/execute`,
    algorithms: ['Ed25519'],
    modes: ['delegated', 'autonomous'],
    // device_authorization is the implemented baseline; ciba (SHOULD) is a planned addition.
    approval_methods: ['device_authorization'],
    endpoints: {
      register: '/agent/register',
      capabilities: '/capability/list',
      describe_capability: '/capability/describe',
      execute: '/capability/execute',
      request_capability: '/agent/request-capability',
      status: '/agent/status',
      reactivate: '/agent/reactivate',
      revoke: '/agent/revoke',
      revoke_host: '/host/revoke',
      rotate_key: '/agent/rotate-key',
      rotate_host_key: '/host/rotate-key',
      introspect: '/agent/introspect',
    },
    jwks_uri: `${issuer}/.well-known/jwks.json`,
  };
}

/**
 * Discovery routes (no auth):
 *   GET /.well-known/agent-configuration (§5.1) — full field set, Cache-Control ~1h.
 *   GET /.well-known/jwks.json — server signing keys (scaffolded: empty until keys are configured).
 */
export function wellKnownRoutes(deps: WellKnownDeps): Router {
  const router = Router();
  const configuration = buildAgentConfiguration(deps.config);

  router.get('/.well-known/agent-configuration', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(configuration);
  });

  router.get('/.well-known/jwks.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ keys: [] });
  });

  return router;
}
