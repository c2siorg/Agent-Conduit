import type { ConnectorRegistry, CredentialTest } from '@conduit/connectors';
import { ConduitError, ErrorCode, type Connection, type ConnectionGrant } from '@conduit/core';
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

/** Fields an admin may change on a connection. Providing `secret` rotates the encrypted credential. */
export interface UpdateConnectionInput {
  name?: string;
  allowedOperations?: string[];
  authMethod?: string;
  secret?: Record<string, string>;
}

/**
 * ConnectionRegistryService - admin-only credential governance. Agents NEVER register credentials.
 * The service encrypts the credential and stores ciphertext only; raw tokens are never returned.
 */
export interface ConnectionRegistryService {
  registerConnection(input: RegisterConnectionInput): Promise<Connection>;
  listConnections(): Promise<Connection[]>;
  updateConnection(id: string, input: UpdateConnectionInput): Promise<Connection>;
  deleteConnection(id: string): Promise<void>;
  /** Validate the stored credential (structural, plus a live probe where the driver supports one). */
  testConnection(id: string): Promise<CredentialTest>;
  /** Authorize (attach) a connector for an agent, with a scoped operation set + optional rate limit. */
  attachConnection(
    hostId: string,
    agentId: string,
    connectionId: string,
    allowedOperations: string[],
    rateLimit: number | null,
  ): Promise<ConnectionGrant>;
  /** Detach a connector from an agent. */
  detachConnection(hostId: string, agentId: string, connectionId: string): Promise<void>;
  /** The connectors an agent is authorized to use (with connection name/platform for the UI). */
  listAgentConnections(agentId: string): Promise<Array<ConnectionGrant & { name: string; platform: string }>>;
}

export function createConnectionRegistryService(
  storage: StorageDriver,
  cipher: CredentialCipher,
  connectors?: ConnectorRegistry,
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

    async updateConnection(id, input) {
      const existing = await storage.connections.findById(id);
      if (!existing) {
        throw new ConduitError(ErrorCode.invalidRequest, 'connection not found', 404);
      }
      const patch: { name?: string; allowedOperations?: string[]; credentialEncrypted?: Uint8Array } = {};
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.allowedOperations !== undefined) {
        patch.allowedOperations = input.allowedOperations;
      }
      if (input.secret !== undefined) {
        // Re-encrypt the whole credential (auth method + secret). Plaintext never persists.
        patch.credentialEncrypted = cipher.encrypt(
          JSON.stringify({ authMethod: input.authMethod ?? 'bearer', secret: input.secret }),
        );
      }
      const updated = await storage.connections.update(id, patch);
      if (!updated) {
        throw new ConduitError(ErrorCode.internalError, 'connection update failed', 500);
      }
      return updated;
    },

    async deleteConnection(id) {
      const existing = await storage.connections.findById(id);
      if (!existing) {
        throw new ConduitError(ErrorCode.invalidRequest, 'connection not found', 404);
      }
      await storage.connections.delete(id);
    },

    async testConnection(id) {
      const connection = await storage.connections.findById(id);
      if (!connection) {
        throw new ConduitError(ErrorCode.invalidRequest, 'connection not found', 404);
      }
      const driver = connectors?.get(connection.platform);
      if (!driver) {
        throw new ConduitError(ErrorCode.invalidRequest, `no driver for platform "${connection.platform}"`, 400);
      }
      const encrypted = await storage.connections.getEncryptedCredential(id);
      if (!encrypted) {
        throw new ConduitError(ErrorCode.internalError, 'connection credential missing', 500);
      }
      const parsed = JSON.parse(cipher.decrypt(encrypted)) as { authMethod: string; secret: Record<string, string> };
      const credential = { authMethod: parsed.authMethod as never, secret: parsed.secret };
      const result: CredentialTest = driver.testCredential
        ? await driver.testCredential(credential)
        : await driver.validateCredential(credential).then((ok) => ({
            ok,
            checked: 'structure' as const,
            detail: ok ? 'credential fields present' : 'missing required credential fields',
          }));
      // Persist for at-a-glance health in the vault.
      await storage.connections.recordTest(id, result.ok, result.detail, new Date());
      return result;
    },

    async attachConnection(hostId, agentId, connectionId, allowedOperations, rateLimit) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      const connection = await storage.connections.findById(connectionId);
      if (!connection) {
        throw new ConduitError(ErrorCode.invalidRequest, 'connection not found', 404);
      }
      // Validate the scoped operations against what the connection actually permits: its registration-time
      // allowlist if set, otherwise the driver's concrete operations (placeholder names like the generic
      // REST "<METHOD> <path>" are skipped — those are free-form and can't be validated).
      if (allowedOperations.length > 0) {
        const driver = connectors?.get(connection.platform);
        const universe =
          connection.allowedOperations.length > 0
            ? connection.allowedOperations
            : (driver?.supportedOperations ?? []).map((o) => o.name).filter((n) => !n.includes('<'));
        if (universe.length > 0) {
          const invalid = allowedOperations.filter((op) => !universe.includes(op));
          if (invalid.length > 0) {
            throw new ConduitError(
              ErrorCode.invalidRequest,
              `unknown operation(s) for "${connection.platform}": ${invalid.join(', ')}`,
              400,
            );
          }
        }
      }
      const grant = await storage.connectionGrants.upsert({ agentId, connectionId, allowedOperations, rateLimit });
      await storage.auditLog.append({
        agentId,
        hostId,
        eventType: 'connection.attach',
        capability: null,
        connectionId,
        operation: null,
        taskId: null,
        outcome: 'success',
        argsHash: null,
        durationMs: null,
      });
      return grant;
    },

    async detachConnection(hostId, agentId, connectionId) {
      const agent = await storage.agents.findById(agentId);
      if (!agent) {
        throw new ConduitError(ErrorCode.agentNotFound, 'agent not found', 404);
      }
      if (agent.hostId !== hostId) {
        throw new ConduitError(ErrorCode.unauthorized, 'agent does not belong to this host', 403);
      }
      await storage.connectionGrants.delete(agentId, connectionId);
      await storage.auditLog.append({
        agentId,
        hostId,
        eventType: 'connection.detach',
        capability: null,
        connectionId,
        operation: null,
        taskId: null,
        outcome: 'success',
        argsHash: null,
        durationMs: null,
      });
    },

    async listAgentConnections(agentId) {
      const grants = await storage.connectionGrants.listByAgent(agentId);
      const out: Array<ConnectionGrant & { name: string; platform: string }> = [];
      for (const g of grants) {
        const connection = await storage.connections.findById(g.connectionId);
        out.push({ ...g, name: connection?.name ?? 'unknown', platform: connection?.platform ?? 'rest' });
      }
      return out;
    },
  };
}
