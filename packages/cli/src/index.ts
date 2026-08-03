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
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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

function flag(ctx: Ctx, name: string): boolean {
  return ctx.opts[name] === true;
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
    if (opt(ctx, 'project')) {
      body['project_id'] = opt(ctx, 'project');
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
        ...(opt(ctx, 'project') ? { project_id: opt(ctx, 'project') } : {}),
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
  async 'project:list'(ctx) {
    out(await api(ctx, 'GET', '/projects'));
  },
  async 'project:create'(ctx) {
    out(await api(ctx, 'POST', '/projects', await hostJwt(ctx), { name: requireOpt(ctx, 'name'), description: opt(ctx, 'description') }));
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

/**
 * `conduit run -- <agent-command> [args...]` — transparent, no-SDK onboarding.
 *
 * Registers a FRESH agent (its own Ed25519 keypair, generated locally), starts a local proxy that mints a
 * short-lived agent JWT PER REQUEST and forwards to the gateway, then spawns the agent command with
 * CONDUIT_URL pointed at the proxy. The wrapped agent makes plain HTTP calls to the local proxy with NO
 * token; Conduit injects identity. AAP is fully intact — real per-agent JWTs go through the 5-stage
 * pipeline. On exit the agent is revoked (zero standing access).
 */
async function runAgent(ctx: Ctx, command: string[]): Promise<void> {
  if (command.length === 0 || !command[0]) {
    fail('usage: conduit run [--project <id>] -- <agent-command> [args...]');
  }
  const key = loadHostKey(ctx);
  const issuer = await discoverIssuer(ctx.url);
  const hostThumb = jwkThumbprint({ kty: key.kty, crv: key.crv, x: key.x } as Jwk);

  const agent = generateEd25519KeyPair();
  const reg = await api<{ agent_id: string }>(ctx, 'POST', '/agent/register', await hostJwt(ctx), {
    agent_public_key: agent.publicKeyJwk,
    mode: opt(ctx, 'mode') ?? 'delegated',
    name: opt(ctx, 'name') ?? 'conduit-run',
    ...(opt(ctx, 'project') ? { project_id: opt(ctx, 'project') } : {}),
  });
  const agentId = reg.agent_id;
  const mintJwt = (): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return signer.sign(
      'agent+jwt',
      { iss: hostThumb, sub: agentId, aud: issuer, iat: now, exp: now + 60, jti: randomUUID() } as never,
      agent.privateKeyJwk as never,
    );
  };

  const upstream = new URL(ctx.url);
  const doRequest = upstream.protocol === 'https:' ? httpsRequest : httpRequest;

  // The proxy binds to loopback, but any OTHER local process could still reach it and act with the agent's
  // identity. Gate it with a per-session shared secret injected into the child's env (CONDUIT_TOKEN). The
  // wrapped agent (or the SDK) forwards it as `x-conduit-token`. `--open` drops the check for agents that
  // cannot send a header, trading that protection for pure transparency. AAP is unaffected either way — the
  // real per-request agent JWT still goes through the full 5-stage pipeline upstream.
  const openMode = flag(ctx, 'open');
  const proxyToken = openMode ? '' : randomUUID();

  const proxy = createServer((req, res) => {
    void (async () => {
      if (!openMode && req.headers['x-conduit-token'] !== proxyToken) {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"proxy_unauthorized"}');
        return;
      }
      const jwt = await mintJwt();
      // Strip the shared secret before forwarding; it is proxy-local and must never reach the gateway.
      const { 'x-conduit-token': _drop, ...rest } = req.headers;
      const headers = { ...rest, host: upstream.host, authorization: `Bearer ${jwt}` };
      const up = doRequest(
        {
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
          method: req.method,
          path: req.url,
          headers,
        },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on('error', () => res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"bad_gateway"}'));
      req.pipe(up);
    })().catch(() => res.writeHead(500).end());
  });

  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const addr = proxy.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  const proxyUrl = `http://127.0.0.1:${port}`;
  process.stderr.write(
    `conduit: agent ${agentId} — proxy ${proxyUrl} ` +
      (openMode
        ? '(open mode: no proxy token — any local process can use this identity)\n'
        : '(identity injected; wrapped agent authenticates to the proxy with CONDUIT_TOKEN)\n'),
  );

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try {
      // Explicit revoke = zero standing access the instant the session ends. The agent's short session TTL
      // (see security.jwtExpiry) is the backstop if this best-effort call can't reach the gateway (e.g. the
      // machine is killed): the identity expires on its own rather than lingering as a usable credential.
      await api(ctx, 'POST', '/agent/revoke', await hostJwt(ctx), { agent_id: agentId });
    } catch {
      /* best effort — session TTL is the backstop */
    }
    proxy.close();
  };

  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit',
    env: {
      ...process.env,
      CONDUIT_URL: proxyUrl,
      CONDUIT_GATEWAY_URL: ctx.url,
      CONDUIT_AGENT_ID: agentId,
      ...(openMode ? {} : { CONDUIT_TOKEN: proxyToken }),
    },
  });
  const forward = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  // Forward the common termination signals so the child (and thus cleanup) always runs; also revoke on an
  // unexpected crash of the wrapper itself so we never leave a live, unrevoked agent behind.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    process.on(sig, () => forward(sig));
  }
  process.on('uncaughtException', (e) => {
    void cleanup().then(() => fail(`conduit run crashed: ${e instanceof Error ? e.message : String(e)}`));
  });
  child.on('error', (e) => {
    void cleanup().then(() => fail(`failed to start "${command[0]}": ${e.message}`));
  });
  child.on('exit', (code) => {
    void cleanup().then(() => {
      process.stderr.write(`conduit: agent ${agentId} revoked.\n`);
      process.exit(code ?? 0);
    });
  });
}

const HELP = `conduit - Agent Conduit admin CLI

Commands:
  run [--project <id>] [--open] -- <agent-command> [args...]   run an agent under a transparent identity proxy
                                                              (--open drops the local proxy-token check)
  agent list | register | revoke <id> | rotate-key <id>   [--project <id>]
  grant --agent <id> --capability <c> [--connection <id> --operation <op>]
  connection register [--project <id>] | list
  project list | create --name <n>
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
      project: { type: 'string' },
      open: { type: 'boolean' },
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

  // `conduit run -- <agent-command>` runs an agent under a transparent identity-injecting proxy.
  if (group === 'run') {
    await runAgent(ctx, positionals.slice(1));
    return;
  }

  const handler = COMMANDS[`${group}:${sub}`];
  if (!handler) {
    fail(`unknown command "${group} ${sub}".\n\n${HELP}`);
  }
  await handler(ctx);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
