import type {
  AdapterType,
  Agent,
  AgentMode,
  AgentState,
  AuditEntry,
  AuditOutcome,
  CapabilityGrant,
  Connection,
  ConnectionGrant,
  Constraint,
  GrantStatus,
  Host,
  HostState,
  Jwk,
  SecurityEvent,
  Tool,
} from '@conduit/core';
import type { Page, PageQuery } from './pagination.js';

// ────────────────────────────────────────────────────────────────────────────
// Input DTOs — what callers hand to the repositories (ids/timestamps are driver-assigned).
// ────────────────────────────────────────────────────────────────────────────

export interface NewHost {
  publicKeyJwk: Jwk | null;
  jwksUrl: string | null;
  userId: string | null;
  defaultCapabilities: string[];
  status: HostState;
}

export interface NewAgent {
  hostId: string;
  publicKeyJwk: Jwk | null;
  jwksUrl: string | null;
  name: string | null;
  description: string | null;
  mode: AgentMode;
  status: AgentState;
}

export interface NewCapabilityGrant {
  agentId: string;
  capability: string;
  connectionId: string | null;
  operation: string | null;
  status: GrantStatus;
  constraints: Record<string, Constraint>;
  grantedBy: string | null;
  expiresAt: Date | null;
}

export interface NewConnection {
  name: string;
  platform: string;
  /** Already-encrypted (AES-256-GCM) ciphertext — the registry never hands plaintext to storage. */
  credentialEncrypted: Uint8Array;
  allowedOperations: string[];
}

export interface NewTool {
  name: string;
  adapterType: AdapterType;
  adapterConfig: Record<string, unknown>;
}

export interface NewAuditEntry {
  agentId: string | null;
  hostId: string | null;
  eventType: string;
  capability: string | null;
  connectionId: string | null;
  operation: string | null;
  outcome: AuditOutcome;
  argsHash: string | null;
  durationMs: number | null;
}

export interface AuditQuery extends PageQuery {
  agentId?: string;
  outcome?: AuditOutcome;
  from?: Date;
  to?: Date;
}

// ────────────────────────────────────────────────────────────────────────────
// Repositories — one focused interface per aggregate (Repository pattern).
//    Callers use these typed methods; raw SQL never leaks past the driver.
// ────────────────────────────────────────────────────────────────────────────

/** Hosts. */
export interface HostRepository {
  create(input: NewHost): Promise<Host>;
  findById(id: string): Promise<Host | null>;
  /** Resolve by `iss` (RFC 7638 thumbprint) during JWT verification. */
  findByThumbprint(iss: string): Promise<Host | null>;
  updateStatus(id: string, status: HostState): Promise<void>;
  /** Rotate the stored public key (AAP §5.10); the denormalized thumbprint is recomputed. */
  updatePublicKey(id: string, publicKeyJwk: Jwk): Promise<void>;
  /** Link/unlink/switch user (AAP §2.9). */
  setUserId(id: string, userId: string | null): Promise<void>;
  list(page: PageQuery): Promise<Page<Host>>;
}

/** Agents — incl. the slide-forward of the session clock on each request. */
export interface AgentRepository {
  create(input: NewAgent): Promise<Agent>;
  findById(id: string): Promise<Agent | null>;
  /** Fallback lookup by `sub` during the JWKS key-rotation race (AAP §8.7). */
  findBySubject(sub: string): Promise<Agent | null>;
  listByHost(hostId: string): Promise<Agent[]>;
  /** All agents, newest first (admin/dashboard registry view). */
  list(page: PageQuery): Promise<Page<Agent>>;
  updateStatus(id: string, status: AgentState): Promise<void>;
  /** Rotate the stored public key (AAP §5.9); the private key never leaves the client. */
  updatePublicKey(id: string, publicKeyJwk: Jwk): Promise<void>;
  /** Update operator-facing metadata (name/description). */
  updateMetadata(id: string, name: string | null, description: string | null): Promise<void>;
  /** Extend the session TTL (called once per authenticated request). */
  touchSession(id: string, sessionExpiresAt: Date): Promise<void>;
  /** Reactivation resets session + max clocks, never the absolute clock (AAP §2.5). */
  applyLifetimes(id: string, clocks: AgentLifetimes): Promise<void>;
}

export interface AgentLifetimes {
  activatedAt: Date | null;
  sessionExpiresAt: Date | null;
  maxLifetimeExpiresAt: Date | null;
  absoluteExpiresAt: Date | null;
}

/** Capability grants. */
export interface CapabilityGrantRepository {
  upsert(input: NewCapabilityGrant): Promise<CapabilityGrant>;
  findForAgent(agentId: string): Promise<CapabilityGrant[]>;
  findActive(agentId: string, capability: string): Promise<CapabilityGrant | null>;
  setStatus(id: string, status: GrantStatus, deniedBy: string | null, reason: string | null): Promise<void>;
  revokeAllForAgent(agentId: string): Promise<void>;
}

/** Connections (admin-registered credentials). */
export interface ConnectionRepository {
  create(input: NewConnection): Promise<Connection>;
  findById(id: string): Promise<Connection | null>;
  list(page: PageQuery): Promise<Page<Connection>>;
  /** Returns ciphertext only — decryption happens in the application layer. */
  getEncryptedCredential(id: string): Promise<Uint8Array | null>;
}

/** Connection grants. */
export interface ConnectionGrantRepository {
  upsert(grant: Omit<ConnectionGrant, 'id'>): Promise<ConnectionGrant>;
  findForAgent(agentId: string, connectionId: string): Promise<ConnectionGrant | null>;
}

/** Tools + per-tool schema cache. */
export interface ToolRepository {
  /** Register or update a tool by name (admin action); clears any persisted schema cache. */
  upsert(input: NewTool): Promise<Tool>;
  findByName(name: string): Promise<Tool | null>;
  list(page: PageQuery): Promise<Page<Tool>>;
  cacheSchema(name: string, schema: Tool['schemaCache'], cachedAt: Date): Promise<void>;
}

/** Audit log + security event stream sink. */
export interface AuditLogRepository {
  append(entry: NewAuditEntry): Promise<void>;
  query(filter: AuditQuery): Promise<Page<AuditEntry>>;
  recordSecurityEvent(event: Omit<SecurityEvent, 'id' | 'createdAt'>): Promise<void>;
}

/** jti replay cache — JWT pipeline stage 3. */
export interface JtiCacheRepository {
  /** True if `jti` was already seen within its window (replay). */
  has(jti: string): Promise<boolean>;
  /** Atomically record `jti`; returns false if already present (TOCTOU-safe — AAP §8.17). */
  put(jti: string, expiresAt: Date): Promise<boolean>;
  /** Purge expired rows (scheduled job). */
  purgeExpired(now: Date): Promise<number>;
}
