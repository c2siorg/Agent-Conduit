/**
 * Public types re-declared locally so `conduit-client` publishes as a self-contained package with no
 * `@conduit/*` type dependency. These mirror the canonical definitions in `@conduit/core`; keep them in sync.
 */

/** Ed25519 JSON Web Key (public unless it carries `d`). */
export interface Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  /** base64url-encoded public key. */
  x: string;
  kid?: string;
  use?: 'sig';
  alg?: 'EdDSA';
  /** Present only on a PRIVATE key — never transmitted. */
  d?: string;
}

/** Capability grant lifecycle status. */
export type GrantStatus = 'active' | 'pending' | 'denied';

/** A minimal JSON Schema (tool input/output). */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  [keyword: string]: unknown;
}

/** Conduit's canonical tool schema (normalized from MCP / OpenAPI / CLI). */
export interface CanonicalSchema {
  name: string;
  description: string;
  input: JsonSchema;
  output?: JsonSchema;
}
