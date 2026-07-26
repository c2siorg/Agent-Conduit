import { ConduitError, ErrorCode } from '@conduit/core';
import type {
  CredentialAuthMethod,
  CredentialTest,
  ExecutionContext,
  ExecutionResult,
  OperationDescriptor,
  PlatformCredential,
  PlatformDriver,
} from '../platformDriver.js';
import type { ConnectorField } from '../platformDriver.js';
import { deriveCredentialFields, type ConnectorManifest, type ManifestOperation } from './connectorManifest.js';

/** Fill `{field}` placeholders from `secret`. Returns whether any referenced field was missing. */
function fillTemplate(template: string, secret: Record<string, string>): { text: string; missing: boolean } {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = secret[key];
    if (value === undefined || value === '') {
      missing = true;
      return '';
    }
    return value;
  });
  return { text, missing };
}

/** Split a `"METHOD /path"` (or bare `/path`) into method + path; bare path defaults to POST. */
function resolveTarget(op: { method?: string; path?: string }): { method: string; path: string } {
  const path = op.path ?? '';
  const method = (op.method ?? (path ? 'POST' : 'GET')).toUpperCase();
  return { method, path };
}

/**
 * ManifestDriver — one generic {@link PlatformDriver} that executes a declarative {@link ConnectorManifest}.
 *
 * Path params (`{name}`) are filled from args and removed; remaining args become the JSON body (or query
 * string for GET/HEAD). GraphQL operations post `{ query, variables: args }`. The credential is injected
 * server-side via the manifest's header/query templates and is never returned to the agent.
 */
export class ManifestDriver implements PlatformDriver {
  readonly platform: string;
  readonly label: string;
  readonly credentialFields: ConnectorField[];
  readonly docsUrl: string | undefined;
  readonly supportedOperations: OperationDescriptor[];
  readonly supportedAuthMethods: CredentialAuthMethod[];

  constructor(private readonly manifest: ConnectorManifest) {
    this.platform = manifest.platform;
    this.label = manifest.label;
    this.credentialFields = deriveCredentialFields(manifest);
    this.docsUrl = manifest.docsUrl;
    this.supportedAuthMethods = manifest.authMethods;
    this.supportedOperations = Object.entries(manifest.operations).map(([name, op]) => ({
      name,
      description: op.description,
    }));
  }

  /** Derive `basic` (base64 user:pass) from username/password so Basic-auth templates can stay `{basic}`. */
  private normalizeSecret(secret: Record<string, string>): Record<string, string> {
    if (secret['basic'] || !secret['username']) {
      return secret;
    }
    const basic = Buffer.from(`${secret['username']}:${secret['password'] ?? ''}`).toString('base64');
    return { ...secret, basic };
  }

  validateCredential(credential: PlatformCredential): Promise<boolean> {
    // Usable if every templated field the manifest needs (base URL + auth) is present in the secret.
    const secret = this.normalizeSecret(credential.secret ?? {});
    const templates = [this.manifest.baseUrl, ...Object.values(this.manifest.headers ?? {}), ...Object.values(this.manifest.query ?? {})];
    const ok = templates.every((t) => !fillTemplate(t, secret).missing);
    return Promise.resolve(ok);
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const op = this.manifest.operations[ctx.operation];
    if (!op) {
      throw new ConduitError(ErrorCode.invalidRequest, `unsupported ${this.platform} operation: ${ctx.operation}`, 400);
    }
    return this.runOperation(op, ctx.args, ctx.credential);
  }

  /**
   * Test the credential: structural check first (are the required fields present), then a live probe if
   * the manifest defines a safe `test` operation. Never returns secret material.
   */
  async testCredential(credential: PlatformCredential): Promise<CredentialTest> {
    if (!(await this.validateCredential(credential))) {
      return { ok: false, checked: 'structure', detail: 'missing required credential fields' };
    }
    if (!this.manifest.test) {
      return { ok: true, checked: 'structure', detail: 'credential fields present (no live probe configured)' };
    }
    try {
      const result = await this.runOperation(this.manifest.test, {}, credential);
      return {
        ok: result.status === 'ok',
        checked: 'live',
        detail: result.status === 'ok' ? 'live probe succeeded' : 'live probe returned an error',
      };
    } catch (err) {
      return { ok: false, checked: 'live', detail: err instanceof Error ? err.message : 'live probe failed' };
    }
  }

  private runOperation(op: ManifestOperation, opArgs: Record<string, unknown>, credential: PlatformCredential): Promise<ExecutionResult> {
    const secret = this.normalizeSecret(credential.secret ?? {});
    // secret.baseUrl overrides the manifest default (self-hosted GitLab/Sentry, Salesforce instance, ...).
    const baseTemplate = secret['baseUrl'] ?? this.manifest.baseUrl;
    const base = fillTemplate(baseTemplate, secret);
    if (base.missing || !base.text) {
      throw new ConduitError(ErrorCode.invalidRequest, `${this.platform}: base URL is missing required credential fields`, 400);
    }
    const baseUrl = base.text.replace(/\/+$/, '');

    const headers: Record<string, string> = { accept: 'application/json' };
    for (const [name, template] of Object.entries(this.manifest.headers ?? {})) {
      const filled = fillTemplate(template, secret);
      if (!filled.missing) {
        headers[name] = filled.text;
      }
    }

    if (this.manifest.style === 'graphql' || op.graphql) {
      const url = new URL(baseUrl);
      headers['content-type'] = 'application/json';
      const body = JSON.stringify({ query: op.graphql ?? '', variables: opArgs });
      for (const [k, v] of Object.entries(this.manifest.query ?? {})) {
        url.searchParams.set(k, fillTemplate(v, secret).text);
      }
      return this.send(url, 'POST', headers, body);
    }

    const { method, path } = resolveTarget(op);
    const args = { ...opArgs };
    const resolvedPath = path.replace(/\{(\w+)\}/g, (_m, key: string) => {
      const value = args[key];
      delete args[key];
      return encodeURIComponent(String(value ?? ''));
    });
    const url = new URL(resolvedPath.startsWith('/') ? baseUrl + resolvedPath : `${baseUrl}/${resolvedPath}`);
    for (const [k, v] of Object.entries(this.manifest.query ?? {})) {
      url.searchParams.set(k, fillTemplate(v, secret).text);
    }
    let body: string | undefined;
    const bodyless = method === 'GET' || method === 'HEAD';
    if (bodyless) {
      for (const [k, v] of Object.entries(args)) {
        url.searchParams.set(k, String(v));
      }
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(args);
    }
    return this.send(url, method, headers, body);
  }

  private async send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<ExecutionResult> {
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = body;
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
    // GraphQL returns 200 with an `errors` array on failure.
    const graphqlError = data !== null && typeof data === 'object' && Array.isArray((data as { errors?: unknown }).errors);
    return { status: response.ok && !graphqlError ? 'ok' : 'error', data };
  }

  mapError(error: unknown): ConduitError {
    if (error instanceof ConduitError) {
      return error;
    }
    return new ConduitError(
      ErrorCode.internalError,
      `${this.platform} request failed: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
}
