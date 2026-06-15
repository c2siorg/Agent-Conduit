import type { ExecutionResult } from '@conduit/connectors';

/** A validated execution request (identity already verified by the JWT pipeline, stages 1–5). */
export interface ProxyExecuteInput {
  agentId: string;
  connectionId: string;
  operation: string;
  args: Record<string, unknown>;
}

/**
 * ConnectionProxy — the `POST /capability/execute` connection flow.
 *
 * After the pipeline validates identity + constraints: load the stored credential, DECRYPT it in the
 * app layer, resolve the PlatformDriver, execute the operation, return the result, then write an audit
 * entry (`agent_id`, `connection_id`, `operation`, args HASH — never raw args, duration, status).
 * The raw credential is injected server-side only; the agent never sees it.
 * @remarks Stub.
 */
export interface ConnectionProxy {
  execute(input: ProxyExecuteInput): Promise<ExecutionResult>;
}
