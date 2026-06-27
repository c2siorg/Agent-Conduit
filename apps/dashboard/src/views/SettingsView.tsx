import { useEffect, useState } from 'react';
import { useConfiguration, useHealth } from '../api/queries';
import { OperatorKeyBar } from '../components/OperatorKeyBar';
import { jwkThumbprint, parseHostKey } from '../lib/agentCrypto';
import { setOperatorKey, useOperatorKey } from '../lib/useOperatorKey';

/** Parse the MAJOR version; this dashboard supports AAP major 1 (§5.1.1). */
function versionMajor(version: string): number | null {
  const match = /^(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * Settings. The operator host key (the one client-side credential) and a compact, read-only view of the
 * gateway it is talking to. Gateway behavior is configured server-side (conduit.config.yaml + env); the
 * dashboard is a thin client.
 */
export function SettingsView(): JSX.Element {
  const { key, loaded } = useOperatorKey();
  const config = useConfiguration();
  const health = useHealth();
  const [keyInfo, setKeyInfo] = useState<{ issuer?: string; error?: string }>({});

  useEffect(() => {
    if (!loaded) {
      setKeyInfo({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const jwk = parseHostKey(key);
        const issuer = await jwkThumbprint({ kty: jwk.kty, crv: jwk.crv, x: jwk.x });
        if (!cancelled) {
          setKeyInfo({ issuer });
        }
      } catch (e) {
        if (!cancelled) {
          setKeyInfo({ error: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, loaded]);

  const cfg = config.data;
  const versionOk = cfg ? versionMajor(cfg.version) === 1 : true;

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Operator credentials and gateway status.</p>
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="cardTitle">Operator host key</h2>
        <p className="muted">Signs host JWTs in your browser. Never sent to the server; cleared when the tab closes.</p>
        <OperatorKeyBar value={key} onChange={setOperatorKey} />
        {keyInfo.issuer && (
          <p className="muted">
            Host <span className="mono">{keyInfo.issuer}</span> — confirm this matches your bootstrapped host.
          </p>
        )}
        {keyInfo.error && <div className="errorBox">{keyInfo.error}</div>}
      </div>

      <div className="card card-pad">
        <h2 className="cardTitle">Gateway</h2>
        <p className="muted">Configured server-side (conduit.config.yaml + env). Read-only here.</p>

        {config.isLoading && <p className="muted">Loading...</p>}
        {config.error && <p className="muted">Gateway unreachable.</p>}

        {cfg && (
          <dl className="configGrid">
            <dt>Provider</dt>
            <dd>{cfg.provider_name}</dd>

            <dt>AAP version</dt>
            <dd>
              {cfg.version} <span className={versionOk ? 'tag tag-ok' : 'tag tag-bad'}>{versionOk ? 'supported' : 'unsupported'}</span>
            </dd>

            <dt>Issuer</dt>
            <dd className="mono">{cfg.issuer}</dd>

            <dt>JWKS</dt>
            <dd>
              <a className="link" href="/api/.well-known/jwks.json" target="_blank" rel="noreferrer">
                .well-known/jwks.json
              </a>
            </dd>

            <dt>Status</dt>
            <dd>
              <span className={health.data?.ready ? 'tag tag-ok' : 'tag tag-bad'}>
                {health.data?.ready ? 'Operational' : 'Degraded'}
              </span>
            </dd>
          </dl>
        )}
      </div>
    </section>
  );
}
