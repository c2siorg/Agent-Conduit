#!/usr/bin/env node
/**
 * Conduit admin CLI.
 *
 * A thin HTTP client over the gateway's documented admin endpoints — never raw DB access. Host-authorized
 * commands sign a `host+jwt` locally with the operator host key (via `@conduit/crypto`); the private key
 * never leaves this process.
 *
 * Usage:
 *   conduit agent list
 *   conduit agent register   --host-key <file> [--name --description --mode] [--out <file>]
 *   conduit agent revoke     --host-key <file> <agentId>
 *   conduit agent rotate-key --host-key <file> <agentId> [--out <file>]
 *   conduit grant            --host-key <file> --agent <id> --capability <c> [--connection <id> --operation <op>]
 *   conduit connection register --host-key <file> --name <n> --platform <p> [--auth-method <m> --secret <json> --operations a,b]
 *   conduit connection list
 *   conduit tool register    --host-key <file> --name <n> --adapter <mcp|openapi|cli> --config <json>
 *   conduit tool list
 *   conduit audit            [--agent <id>] [--outcome <success|denied|error>]
 *   conduit metrics
 *
 * Global: --url <baseUrl> (env CONDUIT_URL, default http://localhost:8443).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createJwtSigner, generateEd25519KeyPair, jwkThumbprint } from '@conduit/crypto';
import type { Jwk } from '@conduit/core';

const signer = createJwtSigner();

interface Ctx {
  url: string;
  opts: Record<string, string | boolean | undefined>;
  positionals: string[];
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function opt(ctx: Ctx, name: string): string | undefined {
  const v = ctx.opts[name];
  return typeof v === 'string' ? v : undefined;
}

function requireOpt(ctx: Ctx, name: string): string {
  const v = opt(ctx, name);
  if (!v) {
    fail(`--${name} is required`);
  }
  return v;
}

function loadHostKey(ctx: Ctx): Jwk & { d: string } {
  const source = opt(ctx, 'host-key') ?? process.env['CONDUIT_HOST_KEY'];
  if (!source) {
    fail('--host-key <file> (or CONDUIT_HOST_KEY) is required for this command');
  }
  let raw: string;
  try {
    raw = readFileSync(source, 'utf8');
  } catch {
    // Allow the value itself to be the JWK JSON, not only a file path.
    raw = source;
  }
  const parsed = JSON.parse(raw) as { hostPrivateKeyJwk?: unknown } & Record<string, unknown>;
  const key = (parsed.hostPrivateKeyJwk ?? parsed) as Jwk & { d?: string };
  if (key.kty !== 'OKP' || !key.x || !key.d) {
    fail('host key must be an Ed25519 PRIVATE JWK (with "d")');
  }
  return key as Jwk & { d: string };
}

async function discoverIssuer(url: string): Promise<string> {
  const res = await fetch(`${url}/.well-known/agent-configuration`);
  if (!res.ok) {
    fail(`discovery failed at ${url}: ${res.status}`);
  }
  return ((await res.json()) as { issuer: string }).issuer;
}

async function hostJwt(ctx: Ctx): Promise<string> {
  const key = loadHostKey(ctx);
  const now = Math.floor(Date.now() / 1000);
  return signer.sign(
    'host+jwt',
    {
      iss: jwkThumbprint({ kty: key.kty, crv: key.crv, x: key.x } as Jwk),
      aud: await discoverIssuer(ctx.url),
      iat: now,
      exp: now + 60,
      jti: randomUUID(),
    } as never,
    key as never,
  );
}

async function api<T = unknown>(ctx: Ctx, method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ctx.url}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    fail((parsed as { message?: string } | undefined)?.message ?? `${method} ${path} -> ${res.status}`);
  }
  return parsed as T;
}

function parseJsonOpt(ctx: Ctx, name: string): Record<string, unknown> {
  const raw = opt(ctx, name);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail(`--${name} must be valid JSON`);
  }
}

const COMMANDS: Record<string, (ctx: Ctx) => Promise<void>> = {
  async 'agent:list'(ctx) {
    out(await api(ctx, 'GET', '/agents'));
  },
  async 'agent:register'(ctx) {
    const agent = generateEd25519KeyPair();
    const body: Record<string, unknown> = {
      agent_public_key: agent.publicKeyJwk,
      mode: opt(ctx, 'mode') ?? 'delegated',
    };
    if (opt(ctx, 'name')) {
      body['name'] = opt(ctx, 'name');
    }
    if (opt(ctx, 'description')) {
      body['description'] = opt(ctx, 'description');
    }
    const res = await api<Record<string, unknown>>(ctx, 'POST', '/agent/register', await hostJwt(ctx), body);
    const outFile = opt(ctx, 'out');
    if (outFile) {
      writeFileSync(outFile, JSON.stringify(agent.privateKeyJwk, null, 2));
    }
    out({ ...res, agent_private_key: outFile ? `written to ${outFile}` : agent.privateKeyJwk });
  },
  async 'agent:revoke'(ctx) {
    const agentId = ctx.positionals[2] ?? fail('usage: conduit agent revoke <agentId>');
    out(await api(ctx, 'POST', '/agent/revoke', await hostJwt(ctx), { agent_id: agentId }));
  },
  async 'agent:rotate-key'(ctx) {
    const agentId = ctx.positionals[2] ?? fail('usage: conduit agent rotate-key <agentId>');
    const agent = generateEd25519KeyPair();
    const res = await api<Record<string, unknown>>(ctx, 'POST', '/agent/rotate-key', await hostJwt(ctx), {
      agent_id: agentId,
      agent_public_key: agent.publicKeyJwk,
    });
    const outFile = opt(ctx, 'out');
    if (outFile) {
      writeFileSync(outFile, JSON.stringify(agent.privateKeyJwk, null, 2));
    }
    out({ ...res, agent_private_key: outFile ? `written to ${outFile}` : agent.privateKeyJwk });
  },
  async 'grant:'(ctx) {
    out(
      await api(ctx, 'POST', '/agent/grant', await hostJwt(ctx), {
        agent_id: requireOpt(ctx, 'agent'),
        capability: requireOpt(ctx, 'capability'),
        connection_id: opt(ctx, 'connection') ?? null,
        operation: opt(ctx, 'operation') ?? null,
        constraints: parseJsonOpt(ctx, 'constraints'),
      }),
    );
  },
  async 'connection:register'(ctx) {
    const operations = opt(ctx, 'operations');
    out(
      await api(ctx, 'POST', '/connections', await hostJwt(ctx), {
        name: requireOpt(ctx, 'name'),
        platform: requireOpt(ctx, 'platform'),
        auth_method: opt(ctx, 'auth-method') ?? 'bearer',
        secret: parseJsonOpt(ctx, 'secret'),
        allowed_operations: operations ? operations.split(',').map((s) => s.trim()).filter(Boolean) : [],
      }),
    );
  },
  async 'connection:list'(ctx) {
    out(await api(ctx, 'GET', '/connections'));
  },
  async 'tool:register'(ctx) {
    out(
      await api(ctx, 'POST', '/tools', await hostJwt(ctx), {
        name: requireOpt(ctx, 'name'),
        adapter_type: requireOpt(ctx, 'adapter'),
        adapter_config: parseJsonOpt(ctx, 'config'),
      }),
    );
  },
  async 'tool:list'(ctx) {
    out(await api(ctx, 'GET', '/tools'));
  },
  async 'audit:'(ctx) {
    const params = new URLSearchParams();
    const agent = opt(ctx, 'agent');
    const outcome = opt(ctx, 'outcome');
    if (agent) {
      params.set('agent_id', agent);
    }
    if (outcome) {
      params.set('outcome', outcome);
    }
    const qs = params.toString();
    out(await api(ctx, 'GET', `/audit${qs ? `?${qs}` : ''}`));
  },
  async 'metrics:'(ctx) {
    out(await api(ctx, 'GET', '/metrics'));
  },
};

const HELP = `conduit - Agent Conduit admin CLI

Commands:
  agent list | register | revoke <id> | rotate-key <id>
  grant --agent <id> --capability <c> [--connection <id> --operation <op>]
  connection register | list
  tool register | list
  audit [--agent <id>] [--outcome <o>]
  metrics

Global options: --url <baseUrl> (env CONDUIT_URL), --host-key <file> (env CONDUIT_HOST_KEY)`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      url: { type: 'string' },
      'host-key': { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      mode: { type: 'string' },
      agent: { type: 'string' },
      capability: { type: 'string' },
      connection: { type: 'string' },
      operation: { type: 'string' },
      constraints: { type: 'string' },
      platform: { type: 'string' },
      'auth-method': { type: 'string' },
      secret: { type: 'string' },
      operations: { type: 'string' },
      adapter: { type: 'string' },
      config: { type: 'string' },
      outcome: { type: 'string' },
      out: { type: 'string' },
    },
  });

  const group = positionals[0];
  const sub = positionals[1] ?? '';
  if (!group || group === 'help') {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const ctx: Ctx = {
    url: (typeof values['url'] === 'string' ? values['url'] : process.env['CONDUIT_URL'] ?? 'http://localhost:8443').replace(
      /\/+$/,
      '',
    ),
    opts: values as Record<string, string | boolean | undefined>,
    positionals,
  };

  const handler = COMMANDS[`${group}:${sub}`];
  if (!handler) {
    fail(`unknown command "${group} ${sub}".\n\n${HELP}`);
  }
  await handler(ctx);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
