import type { Connection } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { CredentialCipher } from './credentialCipher.js';

/** Admin input to register a platform credential. The raw secret is encrypted before it touches storage. */
export interface RegisterConnectionInput {
  name: string;
  platform: string;
  authMethod?: string;
  /** Raw credential material - encrypted (AES-256-GCM) immediately; never persisted in plaintext. */
  secret: Record<string, string>;
  allowedOperations: string[];
}

/**
 * ConnectionRegistryService - admin-only credential governance. Agents NEVER register credentials.
 * The service encrypts the credential and stores ciphertext only; raw tokens are never returned.
 */
export interface ConnectionRegistryService {
  registerConnection(input: RegisterConnectionInput): Promise<Connection>;
  listConnections(): Promise<Connection[]>;
}

export function createConnectionRegistryService(
  storage: StorageDriver,
  cipher: CredentialCipher,
): ConnectionRegistryService {
  return {
    async registerConnection(input) {
      const payload = JSON.stringify({ authMethod: input.authMethod ?? 'bearer', secret: input.secret });
      const credentialEncrypted = cipher.encrypt(payload);
      return storage.connections.create({
        name: input.name,
        platform: input.platform,
        credentialEncrypted,
        allowedOperations: input.allowedOperations,
      });
    },
    async listConnections() {
      const page = await storage.connections.list({ limit: 200 });
      return page.items;
    },
  };
}
