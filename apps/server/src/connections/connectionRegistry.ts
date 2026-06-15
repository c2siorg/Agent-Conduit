import type { Connection } from '@conduit/core';

/** Admin input to register a platform credential. The raw secret is encrypted before it touches storage. */
export interface RegisterConnectionInput {
  name: string;
  platform: string;
  /** Raw credential — encrypted immediately by the CredentialCipher; never persisted in plaintext. */
  secret: Record<string, string>;
  allowedOperations: string[];
}

/**
 * ConnectionRegistryService — admin-only credential governance.
 *
 * Agents NEVER register credentials. The service validates the credential via the platform driver,
 * encrypts it (AES-256-GCM), and stores ciphertext only. Raw tokens are never returned to any caller.
 * @remarks Scaffold — methods stubbed.
 */
export interface ConnectionRegistryService {
  registerConnection(input: RegisterConnectionInput): Promise<Connection>;
  listConnections(): Promise<Connection[]>;
  grantToAgent(agentId: string, connectionId: string, allowedOperations: string[]): Promise<void>;
  /** Re-authenticate / rotate the stored credential for a connection. */
  rotateCredential(connectionId: string, secret: Record<string, string>): Promise<void>;
}
