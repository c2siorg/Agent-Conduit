import { ConduitError, ErrorCode } from '@conduit/core';
import type {
  CredentialAuthMethod,
  ExecutionContext,
  ExecutionResult,
  OperationDescriptor,
  PlatformCredential,
  PlatformDriver,
} from '../../platformDriver.js';

/**
 * RestDriver — the generic HTTP connector. It covers any REST API without a dedicated driver.
 *
 * Operation grammar: the granted `operation` is `"<METHOD> <path>"` (e.g. `"POST /messages"`); a bare
 * `"/path"` defaults to POST. The agent's args become the JSON body (or the query string for GET/HEAD).
 * Connection config (base URL + auth secret) lives in the encrypted credential and is injected
 * server-side only — it is never returned to the agent.
 */
export class RestDriver implements PlatformDriver {
  readonly platform = 'rest';

  readonly supportedOperations: OperationDescriptor[] = [
    {
      name: '<METHOD> <path>',
      description:
        'Perform a configured HTTP request. The operation is "METHOD /path"; args become the JSON body (or query for GET).',
    },
  ];

  readonly supportedAuthMethods: CredentialAuthMethod[] = ['apiKey', 'bearer', 'basic', 'customHeader'];

  validateCredential(credential: PlatformCredential): Promise<boolean> {
    const baseUrl = credential.secret['baseUrl'] ?? credential.secret['base_url'];
    return Promise.resolve(Boolean(baseUrl));
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const secret = ctx.credential.secret;
    const rawBase = secret['baseUrl'] ?? secret['base_url'] ?? '';
    const baseUrl = rawBase.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ConduitError(ErrorCode.invalidRequest, 'REST connection is missing a baseUrl', 400);
    }

    const { method, path } = parseOperation(ctx.operation);
    const isBodyless = method === 'GET' || method === 'HEAD';
    const url = new URL(path.startsWith('/') ? baseUrl + path : `${baseUrl}/${path}`);
    if (isBodyless) {
      for (const [key, value] of Object.entries(ctx.args)) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    applyAuth(headers, ctx.credential);

    const init: RequestInit = { method, headers };
    if (!isBodyless) {
      init.body = JSON.stringify(ctx.args);
    }
    const response = await fetch(url, init);

    const text = await response.text();
    let data: unknown = text || null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }
    return { status: response.ok ? 'ok' : 'error', data };
  }

  mapError(error: unknown): ConduitError {
    if (error instanceof ConduitError) {
      return error;
    }
    return new ConduitError(
      ErrorCode.internalError,
      `REST request failed: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
}

function parseOperation(operation: string): { method: string; path: string } {
  const trimmed = operation.trim();
  const parts = trimmed.split(/\s+/);
  const verb = parts[0];
  if (parts.length >= 2 && verb && /^[a-zA-Z]+$/.test(verb)) {
    return { method: verb.toUpperCase(), path: parts.slice(1).join(' ') };
  }
  return { method: 'POST', path: trimmed };
}

function applyAuth(headers: Record<string, string>, credential: PlatformCredential): void {
  const s = credential.secret;
  switch (credential.authMethod) {
    case 'bearer': {
      const token = s['token'] ?? s['accessToken'];
      if (token) {
        headers['authorization'] = `Bearer ${token}`;
      }
      break;
    }
    case 'apiKey': {
      const headerName = s['header'] ?? 'x-api-key';
      const value = s['value'] ?? s['apiKey'];
      if (value) {
        headers[headerName] = value;
      }
      break;
    }
    case 'basic': {
      const username = s['username'];
      if (username !== undefined) {
        const encoded = Buffer.from(`${username}:${s['password'] ?? ''}`).toString('base64');
        headers['authorization'] = `Basic ${encoded}`;
      }
      break;
    }
    case 'customHeader': {
      const headerName = s['header'];
      const value = s['value'];
      if (headerName && value) {
        headers[headerName] = value;
      }
      break;
    }
    default:
      break;
  }
}
