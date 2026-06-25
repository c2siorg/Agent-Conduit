import { createHash } from 'node:crypto';
import type { ConnectorRegistry, ExecutionResult, PlatformCredential } from '@conduit/connectors';
import { ConduitError, ErrorCode } from '@conduit/core';
import type { Agent, CapabilityGrant } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { CredentialCipher } from './credentialCipher.js';

/**
 * ConnectionProxy - the `POST /capability/execute` flow (identity + authorization already verified by the
 * pipeline). Loads the stored credential, DECRYPTS it in the app layer, resolves the PlatformDriver,
 * executes, returns the result, and writes an audit entry (args HASH, never raw args). The raw credential
 * is injected server-side only and never returned to the agent.
 */
export interface ConnectionProxy {
  execute(agent: Agent, grant: CapabilityGrant, args: Record<string, unknown>): Promise<ExecutionResult>;
}

export interface ConnectionProxyDeps {
  storage: StorageDriver;
  cipher: CredentialCipher;
  connectors: ConnectorRegistry;
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export function createConnectionProxy(deps: ConnectionProxyDeps): ConnectionProxy {
  const { storage, cipher, connectors } = deps;
  return {
    async execute(agent, grant, args) {
      const start = Date.now();
      const { connectionId, operation } = grant;
      if (!connectionId || !operation) {
        throw new ConduitError(ErrorCode.invalidRequest, 'capability has no connection/operation mapping', 400);
      }
      const connection = await storage.connections.findById(connectionId);
      if (!connection) {
        throw new ConduitError(ErrorCode.invalidRequest, 'connection not found', 404);
      }
      const driver = connectors.get(connection.platform);
      if (!driver) {
        throw new ConduitError(ErrorCode.invalidRequest, `no driver for platform "${connection.platform}"`, 400);
      }
      const encrypted = await storage.connections.getEncryptedCredential(connectionId);
      if (!encrypted) {
        throw new ConduitError(ErrorCode.internalError, 'connection credential missing', 500);
      }
      const credential = JSON.parse(cipher.decrypt(encrypted)) as PlatformCredential;

      let outcome: 'success' | 'denied' | 'error' = 'success';
      try {
        const result = await driver.execute({ operation, args, credential, options: {} });
        if (result.status !== 'ok') {
          outcome = 'error';
        }
        return result;
      } catch (err) {
        outcome = 'error';
        throw driver.mapError(err);
      } finally {
        await storage.auditLog.append({
          agentId: agent.id,
          hostId: agent.hostId,
          eventType: 'capability.execute',
          capability: grant.capability,
          connectionId,
          operation,
          outcome,
          argsHash: hashArgs(args),
          durationMs: Date.now() - start,
        });
      }
    },
  };
}
