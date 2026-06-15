import type { AgentMode } from './identity.js';

/**
 * The server endpoint paths in the discovery document (AAP §5.1).
 * All values are paths RELATIVE to `issuer`.
 */
export interface AgentConfigurationEndpoints {
  register: string;
  capabilities: string;
  describe_capability: string;
  execute: string;
  request_capability: string;
  status: string;
  reactivate: string;
  revoke: string;
  revoke_host: string;
  rotate_key: string;
  rotate_host_key: string;
  introspect: string;
}

/**
 * AAP provider discovery document (§5.1), served at `GET /.well-known/agent-configuration`.
 * Field names are wire constants from the spec (snake_case), not camelCase.
 */
export interface AgentConfiguration {
  /** Protocol version, format MAJOR.MINOR[-draft] (e.g. "1.0-draft"). */
  version: string;
  /** Unique provider identifier. */
  provider_name: string;
  description: string;
  /** Base URL of the authorization server. */
  issuer: string;
  /** Default capability execution URL; if absent, derive as `{issuer}{endpoints.execute}`. */
  default_location?: string;
  /** Supported key types for registration; currently only "Ed25519". */
  algorithms: string[];
  modes: AgentMode[];
  /** e.g. "device_authorization" (RFC 8628), "ciba". */
  approval_methods: string[];
  endpoints: AgentConfigurationEndpoints;
  /** URL to the server's JWKS for verifying server-signed responses. */
  jwks_uri?: string;
}

/** The protocol version this provider implements (§5.1). */
export const AAP_VERSION = '1.0-draft';

/** The major AAP version this implementation supports; clients stop on a mismatch (§5.1.1). */
export const AAP_SUPPORTED_MAJOR = 1;

/** Parse the MAJOR component of an AAP version string; returns null if malformed. */
export function parseMajorVersion(version: string): number | null {
  const match = /^(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * §5.1.1 — a client may proceed only when the provider's MAJOR version matches its own supported major.
 * Returns false for an unsupported major or a malformed version string.
 */
export function isSupportedVersion(version: string, supportedMajor: number = AAP_SUPPORTED_MAJOR): boolean {
  return parseMajorVersion(version) === supportedMajor;
}
