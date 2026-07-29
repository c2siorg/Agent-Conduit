import type { PolicyConfig, PolicyEffect, PolicyRule } from '@conduit/core';

/**
 * Runtime security settings — operator-toggleable overrides that the enforcement middleware reads LIVE
 * on every request (so a change in the dashboard takes effect immediately). Held in memory: static config
 * (conduit.config.yaml / env) seeds the initial values and remains authoritative on restart. Every write
 * goes through the host-authorized `PATCH /admin/config` endpoint.
 */
export interface RuntimeSettings {
  rateLimit: { enabled: boolean; perIpPerMinute: number; registerPerHourPerIp: number };
  /** Client-IP allow/deny list. `allow` = only listed IPs/CIDRs pass; `deny` = listed ones are blocked. */
  ipFilter: { enabled: boolean; mode: 'allow' | 'deny'; entries: string[] };
  /** Allow JWKS fetches to private/loopback hosts (SSRF §8.12). Off in production. */
  jwks: { allowPrivateHosts: boolean };
  /** DPoP (RFC 9449) enforcement — stored intent; enforcement is a later deliverable. */
  dpop: { enabled: boolean };
  /** mTLS (RFC 8705) — stored intent; takes effect on the TLS listener (requires restart). */
  mtls: { enabled: boolean };
  /** Declarative execution policy (ordered rules + default effect). */
  policy: PolicyConfig;
}

export interface RuntimeSettingsStore {
  get(): RuntimeSettings;
  update(patch: RuntimeSettingsPatch): RuntimeSettings;
}

export interface RuntimeSettingsPatch {
  rateLimit?: Partial<RuntimeSettings['rateLimit']>;
  ipFilter?: Partial<RuntimeSettings['ipFilter']>;
  jwks?: Partial<RuntimeSettings['jwks']>;
  dpop?: Partial<RuntimeSettings['dpop']>;
  mtls?: Partial<RuntimeSettings['mtls']>;
  policy?: Partial<PolicyConfig>;
}

function clampInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const EFFECTS: PolicyEffect[] = ['allow', 'deny', 'require_approval'];
const RISKS = ['low', 'med', 'high'];

/** Validate + normalize an untrusted rule array, dropping malformed rules. */
function sanitizeRules(input: unknown): PolicyRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const strArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  const rules: PolicyRule[] = [];
  for (const raw of input) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.['id'] !== 'string' || !EFFECTS.includes(r['effect'] as PolicyEffect)) {
      continue;
    }
    const rule: PolicyRule = { id: r['id'], effect: r['effect'] as PolicyEffect };
    if (typeof r['description'] === 'string') rule.description = r['description'];
    const modes = strArray(r['agentModes']);
    if (modes) rule.agentModes = modes;
    const caps = strArray(r['capabilities']);
    if (caps) rule.capabilities = caps;
    const plats = strArray(r['platforms']);
    if (plats) rule.platforms = plats;
    const ops = strArray(r['operations']);
    if (ops) rule.operations = ops;
    if (typeof r['minRisk'] === 'string' && RISKS.includes(r['minRisk'])) {
      rule.minRisk = r['minRisk'] as 'low' | 'med' | 'high';
    }
    rules.push(rule);
  }
  return rules;
}

export function createRuntimeSettings(initial: RuntimeSettings): RuntimeSettingsStore {
  let current: RuntimeSettings = structuredClone(initial);

  return {
    get() {
      return structuredClone(current);
    },
    update(patch) {
      // Merge section by section with validation; unknown/invalid values fall back to the current value.
      const next: RuntimeSettings = structuredClone(current);
      if (patch.rateLimit) {
        next.rateLimit = {
          enabled: bool(patch.rateLimit.enabled, next.rateLimit.enabled),
          perIpPerMinute: clampInt(patch.rateLimit.perIpPerMinute, next.rateLimit.perIpPerMinute),
          registerPerHourPerIp: clampInt(patch.rateLimit.registerPerHourPerIp, next.rateLimit.registerPerHourPerIp),
        };
      }
      if (patch.ipFilter) {
        next.ipFilter = {
          enabled: bool(patch.ipFilter.enabled, next.ipFilter.enabled),
          mode: patch.ipFilter.mode === 'allow' || patch.ipFilter.mode === 'deny' ? patch.ipFilter.mode : next.ipFilter.mode,
          entries: Array.isArray(patch.ipFilter.entries)
            ? patch.ipFilter.entries.filter((e): e is string => typeof e === 'string' && e.trim().length > 0).map((e) => e.trim())
            : next.ipFilter.entries,
        };
      }
      if (patch.jwks) {
        next.jwks = { allowPrivateHosts: bool(patch.jwks.allowPrivateHosts, next.jwks.allowPrivateHosts) };
      }
      if (patch.dpop) {
        next.dpop = { enabled: bool(patch.dpop.enabled, next.dpop.enabled) };
      }
      if (patch.mtls) {
        next.mtls = { enabled: bool(patch.mtls.enabled, next.mtls.enabled) };
      }
      if (patch.policy) {
        next.policy = {
          enabled: bool(patch.policy.enabled, next.policy.enabled),
          defaultEffect: patch.policy.defaultEffect === 'deny' ? 'deny' : patch.policy.defaultEffect === 'allow' ? 'allow' : next.policy.defaultEffect,
          rules: patch.policy.rules !== undefined ? sanitizeRules(patch.policy.rules) : next.policy.rules,
        };
      }
      current = next;
      return structuredClone(current);
    },
  };
}
