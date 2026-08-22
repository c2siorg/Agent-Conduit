# @conduit/cli

The command-line interface for [Agent Conduit](https://github.com/c2siorg/Agent-Conduit) — a self-hosted
gateway that gives AI agents a cryptographic identity, governs the credentials they use, and audits every
action.

Its headline feature is **`conduit run`**: wrap any agent/tool in a transparent identity proxy so it can act
through Conduit **without an SDK and without ever holding a platform token**.

## Install

```bash
npm i -g @conduit/cli      # `conduit` on your PATH
# or run without installing:
npx @conduit/cli --help
```

Requires Node.js ≥ 20 and a running Conduit gateway (set `CONDUIT_URL`, default `http://localhost:8443`).

## `conduit run` — transparent identity proxy

```bash
conduit run [--project <id>] [--open] -- <agent-command> [args...]
```

It registers a fresh, short-lived agent (its own Ed25519 keypair, generated locally — the private key never
leaves your machine), starts a loopback proxy that mints a per-request agent JWT and forwards to the gateway,
then spawns your command with these env vars set:

| Env var | Meaning |
|---|---|
| `CONDUIT_URL` | The local proxy the wrapped agent should call (identity is injected here). |
| `CONDUIT_TOKEN` | Per-session secret the wrapped agent sends as `x-conduit-token` (unless `--open`). |
| `CONDUIT_GATEWAY_URL` | The real gateway URL. |
| `CONDUIT_AGENT_ID` | The registered agent id. |

On exit the agent is revoked (zero standing access). The short session TTL is the backstop.

> **What it governs:** `conduit run` injects identity for programs that call `CONDUIT_URL`. It is a base-URL
> proxy, not deep process interception — an off-the-shelf tool only becomes governed if it (or an MCP server
> it loads) actually calls the proxy.

Example (a real Conduit agent that reads `CONDUIT_URL`):

```bash
CONDUIT_URL=https://conduit.your-company.com \
CONDUIT_HOST_KEY_FILE=./host.json \
  conduit run -- node my-agent.js
```

Flags: `--open` drops the local proxy-token check (for agents that can't send a header); `--project <id>`
assigns the agent to a project.

## Admin commands

```bash
conduit agent   list | register | revoke <id> | rotate-key <id>   [--project <id>]
conduit grant   --agent <id> --capability <c> [--connection <id> --operation <op>]
conduit connection register [--project <id>] | list
conduit project list | create --name <n>
conduit tool    register | list
conduit audit   [--agent <id>] [--outcome <o>]
conduit metrics
```

Global options: `--url <baseUrl>` (env `CONDUIT_URL`), `--host-key <file>` (env `CONDUIT_HOST_KEY` /
`CONDUIT_HOST_KEY_FILE`). Admin actions are host-authorized: they sign a `host+jwt` with your operator host
key (from `npm run bootstrap:host` on the gateway). The host private key stays on your machine.

## How identity works (in one line)

Clients hold private keys and sign short-lived JWTs; the gateway stores only public keys and verifies them
through its 5-stage pipeline. `conduit run` automates that for any command.
