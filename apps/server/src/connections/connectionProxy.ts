import { createHash } from 'node:crypto';
import type { ConnectorRegistry, ExecutionResult, PlatformCredential } from '@conduit/connectors';
import { ConduitError, ErrorCode } from '@conduit/core';
import type { Agent, CapabilityGrant } from '@conduit/core';
import type { StorageDriver } from '@conduit/storage';
import type { PolicyEngine } from '../policy/policyEngine.js';
import { riskLevel } from '../policy/risk.js';
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
  /** Optional declarative policy engine (evaluated before execution). */
  policy?: PolicyEngine;
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export function createConnectionProxy(deps: ConnectionProxyDeps): ConnectionProxy {
  const { storage, cipher, connectors, policy } = deps;
  // Per (agent, connection) fixed-window counters for connection-grant rate limits. NOTE: in-process, so
  // limits are per gateway instance — a multi-instance deployment needs a shared store for exact global
  // limits. Expired buckets are swept lazily so the map does not grow unbounded.
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();
  const sweep = (now: number): void => {
    if (now - lastSweep < 60_000) {
      return;
    }
    for (const [k, b] of rateBuckets) {
      if (b.resetAt <= now) {
        rateBuckets.delete(k);
      }
    }
    lastSweep = now;
  };
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
      // Per-project credential isolation: a project-scoped connection may only be used by an agent in the
      // SAME project. Unassigned (global) connections are usable by any agent. Agents can't reach across
      // projects to another project's credentials.
      if (connection.projectId && connection.projectId !== agent.projectId) {
        throw new ConduitError(
          ErrorCode.capabilityNotGranted,
          `connection "${connection.name}" belongs to a different project`,
          403,
        );
      }
      // Connection-level operation allowlist: a non-empty list bounds what ANY grant on this connection may
      // execute (defense in depth over the per-grant operation). Empty = all operations permitted.
      if (connection.allowedOperations.length > 0 && !connection.allowedOperations.includes(operation)) {
        throw new ConduitError(
          ErrorCode.capabilityNotGranted,
          `operation "${operation}" is not in the allowed set for connection "${connection.name}"`,
          403,
        );
      }
      // Agent ↔ connector authorization: if the agent has ANY connector authorizations, the target
      // connection must be among them and the operation permitted (empty allowed set = all ops). Agents
      // with no connector authorizations are unrestricted here (backward compatible). Also enforce the
      // per-(agent, connection) rate limit when set.
      const connectorGrants = await storage.connectionGrants.listByAgent(agent.id);
      if (connectorGrants.length > 0) {
        const authz = connectorGrants.find((g) => g.connectionId === connectionId);
        if (!authz) {
          throw new ConduitError(
            ErrorCode.capabilityNotGranted,
            `agent is not authorized to use connection "${connection.name}"`,
            403,
          );
        }
        if (authz.allowedOperations.length > 0 && !authz.allowedOperations.includes(operation)) {
          throw new ConduitError(
            ErrorCode.capabilityNotGranted,
            `operation "${operation}" is not permitted on connection "${connection.name}" for this agent`,
            403,
          );
        }
        if (authz.rateLimit !== null && authz.rateLimit > 0) {
          const key = `${agent.id}:${connectionId}`;
          const now = Date.now();
          sweep(now);
          let bucket = rateBuckets.get(key);
          if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + 60_000 };
            rateBuckets.set(key, bucket);
          }
          bucket.count += 1;
          if (bucket.count > authz.rateLimit) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            throw new ConduitError(ErrorCode.rateLimited, `connection rate limit exceeded`, 429, { retry_after: retryAfter });
          }
        }
      }

      // Declarative policy: evaluate the request (subject + resource + risk) before executing. A deny (or
      // require_approval, until an approval workflow lands) blocks the call; the decision is audited.
      if (policy) {
        const risk = riskLevel(operation, grant.capability);
        const decision = policy.evaluate({
          agentMode: agent.mode,
          capability: grant.capability,
          platform: connection.platform,
          operation,
          risk,
        });
        if (decision.effect !== 'allow') {
          // The denial is audited centrally by the execute route (as capability.denied).
          const code = decision.effect === 'require_approval' ? ErrorCode.approvalRequired : ErrorCode.policyDenied;
          const detail = decision.ruleId ? ` (rule ${decision.ruleId})` : ' (default effect)';
          throw new ConduitError(code, `blocked by policy${detail}`, 403, {
            ...(decision.ruleId ? { rule_id: decision.ruleId } : {}),
            risk,
          });
        }
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
          taskId: grant.taskId,
          outcome,
          argsHash: hashArgs(args),
          durationMs: Date.now() - start,
        });
      }
    },
  };
}
