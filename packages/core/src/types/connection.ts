/**
 * A governed platform credential, registered by an ADMIN (never by an agent).
 * The raw token is injected server-side only and never returned to the agent runtime.
 */
export interface Connection {
  id: string;
  name: string;
  /** Connector id: 'slack' | 'github' | 'rest' | … */
  platform: string;
  /** AES-256-GCM ciphertext — Postgres stores ONLY this, never plaintext. */
  credentialEncrypted: Uint8Array;
  allowedOperations: string[];
  createdAt: Date;
}

/** Binds an agent to a connection with a scoped operation set, constraints, and rate limit. */
export interface ConnectionGrant {
  id: string;
  agentId: string;
  connectionId: string;
  allowedOperations: string[];
  constraints: Record<string, unknown>;
  rateLimit: number | null;
}
