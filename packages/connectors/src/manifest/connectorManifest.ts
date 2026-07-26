import type { ConnectorField, CredentialAuthMethod } from '../platformDriver.js';

/**
 * A declarative connector definition. Most platforms are "HTTPS API + a token", so instead of a bespoke
 * driver class each is described as data and executed by {@link ManifestDriver}.
 *
 * Templating: `baseUrl`, `headers`, and `query` values may contain `{field}` placeholders filled from the
 * decrypted credential `secret` (e.g. `{token}`, `{subdomain}`). This covers per-tenant base URLs
 * (Zendesk/Atlassian), multi-key auth (Datadog), and non-standard schemes (Linear's tokenless header).
 * Static values (no placeholder) — e.g. Notion's API version — pass through unchanged.
 */
export interface ConnectorManifest {
  platform: string;
  /** Human label + short description for the registry/dashboard. */
  label: string;
  /** Default base URL; templated against the credential secret (secret.baseUrl also overrides it). */
  baseUrl: string;
  authMethods: CredentialAuthMethod[];
  /** Header templates applied to every request (auth + constants). */
  headers?: Record<string, string>;
  /** Query-param templates applied to every request (e.g. api-key-in-query platforms). */
  query?: Record<string, string>;
  /** REST (default) or GraphQL. GraphQL posts `{ query, variables }` to `baseUrl`. */
  style?: 'rest' | 'graphql';
  operations: Record<string, ManifestOperation>;
  /** Optional safe, no-arg read used only to test a credential live (e.g. an auth/whoami call). */
  test?: ManifestOperation;
  /** Where the operator creates the credential (shown as a help link in the form). */
  docsUrl?: string;
  /** Explicit credential fields; when omitted, fields are derived from the `{field}` templates. */
  fields?: ConnectorField[];
}

const SECRET_HINTS = ['token', 'key', 'secret', 'password', 'pass', 'basic', 'appkey', 'apikey', 'webhookurl'];

/** Title-case a field key for a default label, e.g. `phone_number_id` -> `Phone number id`. */
function labelize(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Derive the credential fields a manifest needs from its `{field}` templates (base URL, headers, query).
 * `basic` expands to username/password (Basic auth). Field keys that look like tokens/keys are marked
 * secret. An explicit `manifest.fields` always wins.
 */
export function deriveCredentialFields(manifest: ConnectorManifest): ConnectorField[] {
  if (manifest.fields) {
    return manifest.fields;
  }
  const templates = [manifest.baseUrl, ...Object.values(manifest.headers ?? {}), ...Object.values(manifest.query ?? {})];
  const keys = new Set<string>();
  for (const t of templates) {
    for (const m of t.matchAll(/\{(\w+)\}/g)) {
      if (m[1]) {
        keys.add(m[1]);
      }
    }
  }
  const fields: ConnectorField[] = [];
  for (const key of keys) {
    if (key === 'basic') {
      fields.push({ key: 'username', label: 'Username / email', secret: false, required: true });
      fields.push({ key: 'password', label: 'Password / API token', secret: true, required: true });
      continue;
    }
    const secret = SECRET_HINTS.some((h) => key.toLowerCase().includes(h));
    fields.push({ key, label: labelize(key), secret, required: true });
  }
  return fields;
}

export interface ManifestOperation {
  description: string;
  /** HTTP method (REST). A bare path defaults to POST. Ignored for GraphQL operations. */
  method?: string;
  /** Path with `{param}` slots filled from args; unused args become the body (or query for GET). */
  path?: string;
  /** GraphQL query/mutation string; args become `variables`. */
  graphql?: string;
}
