import type { Agent, AgentMode, AgentState, Host, HostState, Jwk } from '@conduit/core';

/** Raw `hosts` row shape (snake_case columns as Postgres returns them). */
export type HostRow = {
  id: string;
  public_key_jwk: Jwk | null;
  jwks_url: string | null;
  key_thumbprint: string | null;
  user_id: string | null;
  default_capabilities: string[];
  status: HostState;
  created_at: Date;
  updated_at: Date;
};

/** Raw `agents` row shape. */
export type AgentRow = {
  id: string;
  host_id: string;
  public_key_jwk: Jwk | null;
  jwks_url: string | null;
  name: string | null;
  description: string | null;
  status: AgentState;
  mode: AgentMode;
  activated_at: Date | null;
  session_expires_at: Date | null;
  max_lifetime_expires_at: Date | null;
  absolute_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Map a `hosts` row to the typed domain model. */
export function mapHostRow(r: HostRow): Host {
  return {
    id: r.id,
    publicKeyJwk: r.public_key_jwk,
    jwksUrl: r.jwks_url,
    userId: r.user_id,
    defaultCapabilities: r.default_capabilities,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Map an `agents` row to the typed domain model. */
export function mapAgentRow(r: AgentRow): Agent {
  return {
    id: r.id,
    hostId: r.host_id,
    publicKeyJwk: r.public_key_jwk,
    jwksUrl: r.jwks_url,
    name: r.name,
    description: r.description,
    status: r.status,
    mode: r.mode,
    activatedAt: r.activated_at,
    sessionExpiresAt: r.session_expires_at,
    maxLifetimeExpiresAt: r.max_lifetime_expires_at,
    absoluteExpiresAt: r.absolute_expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Opaque keyset cursor over (created_at, id). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { ts: string; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.indexOf('|');
  if (sep < 0) {
    throw new Error('malformed pagination cursor');
  }
  return { ts: raw.slice(0, sep), id: raw.slice(sep + 1) };
}

/** Clamp a requested page size into a safe range. */
export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}
