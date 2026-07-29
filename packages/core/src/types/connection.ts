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
  /** Result of the last credential test (null if never tested). */
  lastTestOk: boolean | null;
  lastTestAt: Date | null;
  lastTestDetail: string | null;
}

/** Authorizes an agent to use a connection, with a scoped operation set and an optional rate limit. */
export interface ConnectionGrant {
  id: string;
  agentId: string;
  connectionId: string;
  /** Operations this agent may run on the connection; empty = all the connection permits. */
  allowedOperations: string[];
  /** Max requests per minute for this (agent, connection); null = unlimited. */
  rateLimit: number | null;
}
