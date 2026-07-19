import type { ConduitError } from '@conduit/core';

/** Credential auth methods a connector may support. */
export type CredentialAuthMethod = 'apiKey' | 'bearer' | 'basic' | 'oauth2' | 'customHeader';

/** One field of a connector's credential form (drives structured input in the dashboard). */
export interface ConnectorField {
  /** Secret key name, e.g. 'token', 'subdomain', 'apiKey', 'baseUrl'. */
  key: string;
  label: string;
  /** Mask the input and treat as sensitive. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** Short guidance, e.g. where to create the token. */
  help?: string;
}

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

/** Result of testing a stored credential. `structure` = required fields present; `live` = a real probe. */
export interface CredentialTest {
  ok: boolean;
  checked: 'structure' | 'live';
  detail: string;
}

/**
 * PlatformDriver — the connector STRATEGY. One interface behind every platform.
 * Invariant: credentials are injected server-side and NEVER returned to the agent.
 */
export interface PlatformDriver {
  readonly platform: string;
  /** Human-friendly name for the registry/dashboard (defaults to `platform` when omitted). */
  readonly label?: string;
  /** Structured credential fields for the dashboard form (falls back to raw JSON when omitted). */
  readonly credentialFields?: ConnectorField[] | undefined;
  /** Link to where the operator creates the credential (shown in the form). */
  readonly docsUrl?: string | undefined;
  readonly supportedOperations: OperationDescriptor[];
  readonly supportedAuthMethods: CredentialAuthMethod[];

  /** Validate a credential at admin-registration time (before storing ciphertext). */
  validateCredential(credential: PlatformCredential): Promise<boolean>;
  /**
   * Optional: test a stored credential, ideally via a lightweight live probe (e.g. an auth/whoami call).
   * Falls back to a structural check (`validateCredential`) when a live probe isn't available.
   */
  testCredential?(credential: PlatformCredential): Promise<CredentialTest>;
  /** Execute one operation against the platform API. */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  /** Map a native/platform error into a canonical ConduitError. */
  mapError(error: unknown): ConduitError;
}
