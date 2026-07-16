import { useEffect, useState } from 'react';
import { createDashboardApi, type SecuritySettings } from '../api/client';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="toggleRow">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="muted"> — {hint}</span>}
      </span>
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );
}

/**
 * Operator-toggleable security enforcement, backed by host-authorized `GET`/`PATCH /admin/config`. Changes
 * apply to the running gateway immediately; static config (conduit.config.yaml / env) re-seeds on restart.
 */
export function SecuritySettingsPanel(): JSX.Element {
  const { key, loaded } = useOperatorKey();
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function hostJwt(): Promise<string> {
    return signHostJwt(parseHostKey(key), await api.getIssuer());
  }

  useEffect(() => {
    if (!loaded) {
      setSettings(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.getSecuritySettings(await hostJwt());
        if (!cancelled) {
          setSettings(s);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key]);

  async function save(): Promise<void> {
    if (!settings) {
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await api.updateSecuritySettings(await hostJwt(), settings);
      setSettings(updated);
      setStatus('Saved — enforcement updated on the running gateway.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="card card-pad">
        <h2 className="cardTitle">Security enforcement</h2>
        <p className="muted">Set your operator host key above to view and change enforcement.</p>
      </div>
    );
  }

  const s = settings;
  return (
    <div className="card card-pad">
      <h2 className="cardTitle">Security enforcement</h2>
      <p className="muted">Applies immediately (signed with your operator key). Static config re-seeds these on gateway restart.</p>

      {!s && <p className="muted">{error ?? 'Loading...'}</p>}

      {s && (
        <>
          <Toggle label="Rate limiting" checked={s.rateLimit.enabled} onChange={(v) => setSettings({ ...s, rateLimit: { ...s.rateLimit, enabled: v } })} />
          {s.rateLimit.enabled && (
            <div className="indent">
              <NumberField label="Requests / IP / minute" value={s.rateLimit.perIpPerMinute} onChange={(v) => setSettings({ ...s, rateLimit: { ...s.rateLimit, perIpPerMinute: v } })} />
              <NumberField label="Registrations / IP / hour" value={s.rateLimit.registerPerHourPerIp} onChange={(v) => setSettings({ ...s, rateLimit: { ...s.rateLimit, registerPerHourPerIp: v } })} />
            </div>
          )}

          <Toggle label="Client IP filter" checked={s.ipFilter.enabled} onChange={(v) => setSettings({ ...s, ipFilter: { ...s.ipFilter, enabled: v } })} />
          {s.ipFilter.enabled && (
            <div className="indent">
              <label className="field">
                <span>Mode</span>
                <select value={s.ipFilter.mode} onChange={(e) => setSettings({ ...s, ipFilter: { ...s.ipFilter, mode: e.target.value as 'allow' | 'deny' } })}>
                  <option value="deny">deny listed</option>
                  <option value="allow">allow only listed</option>
                </select>
              </label>
              <label className="field">
                <span>IPs / CIDRs (one per line)</span>
                <textarea
                  rows={3}
                  className="mono"
                  value={s.ipFilter.entries.join('\n')}
                  onChange={(e) => setSettings({ ...s, ipFilter: { ...s.ipFilter, entries: e.target.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) } })}
                />
              </label>
            </div>
          )}

          <Toggle label="Allow JWKS fetch to private hosts" hint="SSRF: keep off in production" checked={s.jwks.allowPrivateHosts} onChange={(v) => setSettings({ ...s, jwks: { allowPrivateHosts: v } })} />
          <Toggle label="Require DPoP" hint="RFC 9449, enforcement pending" checked={s.dpop.enabled} onChange={(v) => setSettings({ ...s, dpop: { enabled: v } })} />
          <Toggle label="Require mTLS" hint="RFC 8705, applies on restart" checked={s.mtls.enabled} onChange={(v) => setSettings({ ...s, mtls: { enabled: v } })} />

          {error && <div className="errorBox">{error}</div>}
          {status && <div className="resultBox">{status}</div>}
          <button type="button" className="primaryBtn" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving...' : 'Save enforcement'}
          </button>
        </>
      )}
    </div>
  );
}
