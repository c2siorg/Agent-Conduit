# conduit-client

The SDK for [Agent Conduit](https://github.com/c2siorg/Agent-Conduit) — the **AAP Client**. It holds a host
identity, generates and manages per-session agent keypairs, mints short-lived Ed25519 JWTs, and calls the
gateway. Private keys never leave the client.

Zero runtime dependencies (self-contained bundle). Node.js ≥ 20.

## Install

```bash
npm i conduit-client
```

## Usage

```ts
import { ConduitClient } from 'conduit-client';

const client = new ConduitClient({
  baseUrl: 'https://conduit.your-company.com',
  hostPrivateKeyJwk,             // your operator host key (Ed25519 private JWK)
});

// Register + activate a per-session agent (keypair generated locally, private key kept in the client).
const { agentId } = await client.connectAgent();

// See what it can do (identity-scoped) and fetch a tool schema on demand.
const caps = await client.listCapabilities(agentId);
const schema = await client.getToolSchema(agentId, 'github_create_issue');

// Execute a granted capability — Conduit injects the platform credential server-side and audits it.
const result = await client.executeCapability(agentId, 'github_create_issue', {
  owner: 'acme', repo: 'web', title: 'Login 500s on Safari',
});

// Ephemeral by design: revoke when done (zero standing access).
await client.disconnectAgent(agentId);
```

## API (AAP Client tools)

- `connectAgent(capabilities?)` — register + activate an agent under the host.
- `signJwt(agentId, { aud?, capabilities? })` — mint a fresh short-lived agent JWT.
- `requestCapability(agentId, capability, constraints?)` — request a capability (creates a pending grant).
- `executeCapability(agentId, capability, args)` — execute; returns the platform result data.
- `listCapabilities(agentId)` / `describeCapability(agentId, name)` — identity-scoped capability discovery.
- `getToolSchema(agentId, toolName)` — Token Router: fetch a tool's canonical schema on demand.
- `agentStatus(agentId)` — lifecycle state + grants (also polls approvals).
- `reactivateAgent(agentId)` / `disconnectAgent(agentId)` — lifecycle.

## Security model

Clients hold private keys and sign short-lived JWTs; the gateway stores only public keys and verifies them
through its 5-stage pipeline. Platform credentials live encrypted on the gateway and are injected server-side
at execution — they are never returned to the agent.
