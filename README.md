# Agent Conduit

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-informational)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-informational)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Required-informational)](https://www.postgresql.org/)
[![Status](https://img.shields.io/badge/Status-In%20Development-yellow)](https://github.com/c2siorg/Agent-Conduit)

**Agent Conduit** is a lightweight, self-hosted unified gateway for secure AI agent deployments.

It gives every agent a cryptographic identity, centralizes platform credentials, serves tool schemas on demand, and records every action in an agent-attributed audit trail.

Repository: [c2siorg/Agent-Conduit](https://github.com/c2siorg/Agent-Conduit)

---

## Why Agent Conduit?

Production AI agents increasingly need to call APIs, post messages, create issues, query databases, and interact with third-party platforms. In many deployments, this creates a fragile security model:

- Agents share API keys or OAuth tokens.
- Credentials are scattered across `.env` files, CI secrets, prompts, and local scripts.
- Tool schemas are loaded upfront even when most tools are never used.
- Logs show what happened, but not which agent did it.
- Revoking one compromised agent often requires rotating credentials for everything.

Agent Conduit solves this by acting as a single gateway between agents and the external systems they use.

---

## Core Idea

Agent Conduit is built around four integrated pillars:

| Pillar | Purpose |
| --- | --- |
| Identity Server | Gives each host and agent its own cryptographic identity and short-lived JWTs |
| Platform Connection Registry | Stores and governs platform credentials without exposing raw tokens to agents |
| Token Router | Serves only the tool schemas an agent is allowed to use, when it needs them |
| Observability and Audit | Attributes every action to a verified agent identity |

The result is a self-hosted control plane for agent identity, authorization, credential governance, tool routing, and auditability.

---

## Features

### AAP-Compliant Identity Server

Agent Conduit implements an Agent Auth Protocol inspired identity model with two levels:

* **Host**: a persistent client environment such as an app instance, CI runner, server, or device.
* **Agent**: a per-session runtime actor registered under a host.

Each agent receives its own keypair and short-lived JWT. This enables:

* Per-agent identity
* Per-agent revocation
* Capability-scoped authorization
* Agent lifecycle management
* JWT verification through JWKS
* Replay protection with `jti`
* Capability grants with constraints
