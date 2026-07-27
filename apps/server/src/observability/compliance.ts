import type { ConduitConfig } from '../config/configSchema.js';
import type { RuntimeSettings } from '../server/runtimeSettings.js';

export type ControlStatus = 'met' | 'partial' | 'gap';

export interface Control {
  id: string;
  title: string;
  status: ControlStatus;
  detail: string;
}

export interface ControlDomain {
  domain: string;
  controls: Control[];
}

/**
 * Map Conduit's enforcement to a control catalog (inspired by Agentic Trust Controls / OWASP agentic /
 * ISO 42001). Some controls are computed live from runtime settings so the posture reflects the running
 * gateway, not a static claim.
 */
export function buildComplianceReport(settings: RuntimeSettings, _config: ConduitConfig): ControlDomain[] {
  // The gateway currently serves HTTP (TLS termination is expected at a proxy or is pending) — reported
  // honestly as a gap rather than assumed from config.
  const tlsServed = false;
  return [
    {
      domain: 'Identity & authority',
      controls: [
        { id: 'ID-1', title: 'Cryptographic per-agent identity', status: 'met', detail: 'Ed25519 agent/host JWTs (AAP); private keys never leave the client.' },
        { id: 'ID-2', title: 'Short-lived credentials', status: 'met', detail: 'Agent JWTs are short-lived; session/max/absolute lifetime clocks enforced.' },
        { id: 'ID-3', title: 'Key rotation', status: 'met', detail: 'Agent + host key rotation endpoints; old keys stop verifying.' },
        { id: 'ID-4', title: 'Replay protection', status: 'met', detail: 'jti cache in the JWT pipeline (stage 3).' },
        { id: 'ID-5', title: 'Proof-of-possession (DPoP/mTLS)', status: settings.dpop.enabled || settings.mtls.enabled ? 'partial' : 'gap', detail: 'Toggle present; binding enforcement not yet wired.' },
      ],
    },
    {
      domain: 'Authorization & least privilege',
      controls: [
        { id: 'AZ-1', title: 'Capability-gated access', status: 'met', detail: 'Grant required to pass pipeline stage 5; otherwise 403.' },
        { id: 'AZ-2', title: 'Constraint enforcement', status: 'met', detail: 'max/min/in/not_in checked per request; violations audited.' },
        { id: 'AZ-3', title: 'Zero standing access (tasks)', status: 'met', detail: 'Task-scoped grants auto-revoke on completion/TTL.' },
        { id: 'AZ-4', title: 'Connection operation allowlist', status: 'met', detail: 'Non-empty allowlist bounds what any grant may execute.' },
        { id: 'AZ-5', title: 'Declarative policy engine', status: settings.policy.enabled ? 'met' : 'partial', detail: settings.policy.enabled ? `Active with ${settings.policy.rules.length} rule(s), default "${settings.policy.defaultEffect}".` : 'Available (ordered allow/deny/require_approval rules); currently disabled.' },
        { id: 'AZ-6', title: 'Human approval workflow', status: 'partial', detail: 'Device-authorization approval; richer routing / CIBA pending.' },
      ],
    },
    {
      domain: 'Credential & connection control',
      controls: [
        { id: 'CR-1', title: 'Credentials encrypted at rest', status: 'met', detail: 'AES-256-GCM; DB stores ciphertext only.' },
        { id: 'CR-2', title: 'Server-side injection', status: 'met', detail: 'Raw credentials never returned to the agent or any listing.' },
        { id: 'CR-3', title: 'Credential health testing', status: 'met', detail: 'Live/structural credential test with persisted health.' },
        { id: 'CR-4', title: 'KMS-backed key management', status: 'gap', detail: 'Single env-derived master key; KMS/envelope encryption pending.' },
      ],
    },
    {
      domain: 'Action guardrails & content safety',
      controls: [
        { id: 'GR-1', title: 'Args never logged raw', status: 'met', detail: 'Audit stores an args hash only.' },
        { id: 'GR-2', title: 'DLP / redaction', status: 'gap', detail: 'Content inspection/redaction of args + responses not yet implemented.' },
        { id: 'GR-3', title: 'Prompt-injection detection', status: 'gap', detail: 'No input/output injection heuristics yet.' },
      ],
    },
    {
      domain: 'Runtime instrumentation & monitoring',
      controls: [
        { id: 'RT-1', title: 'Per-agent audit trail', status: 'met', detail: 'Every action attributed to agent (+ task); queryable.' },
        { id: 'RT-2', title: 'Security event stream', status: 'met', detail: 'Live SSE feed of replay/constraint/rate-limit/revocation events.' },
        { id: 'RT-3', title: 'Rate limiting', status: settings.rateLimit.enabled ? 'met' : 'gap', detail: settings.rateLimit.enabled ? 'Per-IP + registration caps active (429 + Retry-After).' : 'Rate limiting is currently disabled in runtime settings.' },
        { id: 'RT-4', title: 'IP allow/deny filter', status: settings.ipFilter.enabled ? 'met' : 'partial', detail: settings.ipFilter.enabled ? 'Client-IP filter active.' : 'Available but currently disabled.' },
        { id: 'RT-5', title: 'Anomaly detection', status: 'gap', detail: 'Behavioral baselining not yet implemented.' },
      ],
    },
    {
      domain: 'Transport & network',
      controls: [
        { id: 'NW-1', title: 'JWKS SSRF protection', status: 'met', detail: 'IP-filtered, pinned, https-only, redirect/size/time capped (§8.12).' },
        { id: 'NW-2', title: 'TLS in transit', status: tlsServed ? 'met' : 'gap', detail: tlsServed ? 'TLS enabled.' : 'Gateway serves HTTP; terminate TLS at a proxy (native TLS/ACME pending).' },
        { id: 'NW-3', title: 'Security headers', status: 'met', detail: 'Helmet applied to all responses.' },
      ],
    },
  ];
}

/** Roll up domain statuses into overall counts. */
export function complianceSummary(domains: ControlDomain[]): { met: number; partial: number; gap: number; total: number } {
  let met = 0;
  let partial = 0;
  let gap = 0;
  for (const d of domains) {
    for (const c of d.controls) {
      if (c.status === 'met') met += 1;
      else if (c.status === 'partial') partial += 1;
      else gap += 1;
    }
  }
  return { met, partial, gap, total: met + partial + gap };
}
