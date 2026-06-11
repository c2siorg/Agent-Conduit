import type { ConduitError } from '@conduit/core';

/** Credential auth methods a connector may support. */
export type CredentialAuthMethod = 'apiKey' | 'bearer' | 'basic' | 'oauth2' | 'customHeader';

/** One operation a platform exposes (e.g. Slack `post_message`). Operation names are platform wire constants. */
export interface OperationDescriptor {
  name: string;
  description: string;
  input?: Record<string, unknown>;
}

/**
 * Decrypted credential handed to a driver at execution time.
 * Server-side only — it is NEVER returned to the agent or its runtime.
 */
export interface PlatformCredential {
  authMethod: CredentialAuthMethod;
  /** Opaque secret material, decrypted in the application layer immediately before use. */
  secret: Record<string, string>;
}

/** Everything a driver needs to execute one operation. */
export interface ExecutionContext {
  operation: string;
  args: Record<string, unknown>;
  credential: PlatformCredential;
  /** Per-connection defaults from `connectors.defaults[platform]`. */
  options: Record<string, unknown>;
}

export interface ExecutionResult {
  status: 'ok' | 'error';
  data?: unknown;
}

/**
 * PlatformDriver — the connector STRATEGY. One interface behind every platform.
 * Invariant: credentials are injected server-side and NEVER returned to the agent.
 */
export interface PlatformDriver {
  readonly platform: string;
  readonly supportedOperations: OperationDescriptor[];
  readonly supportedAuthMethods: CredentialAuthMethod[];

  /** Validate a credential at admin-registration time (before storing ciphertext). */
  validateCredential(credential: PlatformCredential): Promise<boolean>;
  /** Execute one operation against the platform API. */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  /** Map a native/platform error into a canonical ConduitError. */
  mapError(error: unknown): ConduitError;
}
