# Connectors

Conduit ships ~45 platform connectors. Most are **declarative manifests** executed by one generic
`ManifestDriver`; a few are hand-written drivers. Adding a platform is usually adding a manifest — no new
code. Whatever the driver, the invariant holds: **credentials are injected server-side and never returned
to the agent.**

> Heads-up: bundled manifests encode each platform's correct base URL, auth scheme, and a **starter set of
> common operations**. They are not exhaustively validated against every live API — verify the operations
> and paths against the provider's current docs, and extend the manifest, before relying on them in
> production.

## How a manifest works

A `ConnectorManifest` (see `packages/connectors/src/manifest/manifests.ts`) is data:

```ts
{
  platform: 'github',
  label: 'GitHub',
  baseUrl: 'https://api.github.com',
  authMethods: ['bearer'],
  headers: { Authorization: 'Bearer {token}', 'X-GitHub-Api-Version': '2022-11-28' },
  operations: {
    create_issue: { method: 'POST', path: '/repos/{owner}/{repo}/issues', description: '...' },
  },
}
```

- **Templating** — `{field}` in `baseUrl`, `headers`, and `query` is filled from the connection's
  decrypted `secret` (e.g. `{token}`, `{subdomain}`). Static values pass through.
- **Path params** — `{name}` in a path is filled from the agent's args and removed; remaining args become
  the JSON body (or the query string for `GET`).
- **GraphQL** — `style: 'graphql'` (or an op with `graphql`) posts `{ query, variables: args }`.
- **Per-tenant / self-hosted** — set `secret.baseUrl` to override the default (GitLab, Sentry, Salesforce
  instance, Zendesk/Atlassian subdomain hosts are templated).

## Registering a connection

Store the credential once (encrypted at rest); it is never returned. Example (dashboard → Connection
Vault, or `POST /connections`):

```json
{ "name": "team-notion", "platform": "notion", "auth_method": "bearer", "secret": { "token": "secret_..." } }
```

Then grant a capability that maps to it and an operation:

```json
{ "agent_id": "...", "capability": "save_note", "connection_id": "...", "operation": "create_page" }
```

See `docs/connecting-platforms.md` for the full connection → grant → execute flow.

## Secret shapes by platform

| Auth style | Platforms | `secret` |
|---|---|---|
| Bearer token | github, gitlab, slack, discord (`Bot`), notion, asana, todoist, airtable, miro, hubspot, intercom, gmail + all Google, zoom, webex, vercel, sentry, openai, linkedin, teams, whatsapp | `{ "token": "..." }` |
| Token header (no `Bearer`) | linear, monday, clickup | `{ "token": "..." }` |
| API key header | figma (`X-Figma-Token`) | `{ "token": "..." }` |
| Two-key header | datadog | `{ "apiKey": "...", "appKey": "..." }` |
| Key in query | trello, pipedrive, gemini | trello `{ "key","token" }`, pipedrive `{ "token" }`, gemini `{ "token" }` |
| Basic | jira, confluence, zendesk | `{ "basic": "<base64>", "site"/"subdomain": "..." }` |
| Per-tenant host | salesforce (`instance`), zendesk (`subdomain`), jira/confluence (`site`), pipedrive (`company`) | plus the token/basic field |
| Webhook URL | zapier, make, n8n, ifttt | `{ "webhookUrl": "https://..." }` (ifttt: `{ "key","event" }`) |
| Local, no auth | ollama | `{ "baseUrl": "http://localhost:11434" }` |
| Vendor header | claude (`x-api-key`), pagerduty (`Token token=`) | `{ "token": "..." }` |

## Known limitations

- **Stripe** — writes require `x-www-form-urlencoded` bodies; the generic JSON driver supports **reads**
  only. Use a bespoke connector for create/update.
- **Google Meet** — no "create meeting" REST call (meetings are created via Calendar `conferenceData`);
  the manifest exposes the read-only Meet API.
- **Automation hubs** (Zapier / Make / n8n / IFTTT) — inbound-webhook only; the single `trigger` op POSTs
  your payload to the configured hook URL.
- **No hosted API — not executable** (`UNSUPPORTED_PLATFORMS`): `apple_intelligence` (on-device),
  `obsidian` (local vault), `loom` (no stable public write API). Registered names only; a bespoke
  integration is required.

## Adding your own

- **Declarative:** add a `ConnectorManifest` to `manifests.ts` (or register one at runtime). Covers any
  REST/GraphQL API with header/query/basic auth.
- **Bespoke:** for non-HTTP behavior or special encodings (e.g. Stripe form bodies), implement
  `PlatformDriver` directly — see `slackDriver.ts` / `restDriver.ts` as the reference pattern — and
  `register()` it in the connector registry.
