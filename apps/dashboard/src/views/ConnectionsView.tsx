import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDashboardApi } from '../api/client';
import { useConnections } from '../api/queries';
import type { NavKey } from '../components/AppShell';
import { Icon } from '../components/Icon';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

const PLATFORMS = ['rest', 'slack', 'github', 'mock'];
const AUTH_METHODS = ['bearer', 'apiKey', 'basic', 'customHeader'];
const SECRET_HINT: Record<string, string> = {
  rest: '{ "baseUrl": "https://api.example.com", "token": "..." }',
  slack: '{ "token": "xoxb-..." }',
  github: '{ "token": "ghp_..." }',
  mock: '{ "token": "any" }',
};

function fmt(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

/**
 * Connection Vault. Lists governed platform credentials (NO secret values are ever returned) and lets the
 * operator register a new one. Registration signs a host JWT in the browser with the operator host key;
 * the secret is sent once to the gateway, encrypted at rest (AES-256-GCM), and never exposed again.
 */
export function ConnectionsView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { data, isLoading, error } = useConnections();
  const queryClient = useQueryClient();
  const conns = data ?? [];

  const { key: hostKey, loaded } = useOperatorKey();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('rest');
  const [authMethod, setAuthMethod] = useState('bearer');
  const [secret, setSecret] = useState('');
  const [ops, setOps] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setFormError(null);
    setFormOk(null);
    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!hostKey.trim()) {
      setFormError('Set the operator host key first.');
      return;
    }
    let parsedSecret: Record<string, string>;
    try {
      parsedSecret = JSON.parse(secret || '{}') as Record<string, string>;
    } catch {
      setFormError('Secret must be valid JSON.');
      return;
    }
    setBusy(true);
    try {
      const hostJwk = parseHostKey(hostKey);
      const issuer = await api.getIssuer();
      const hostJwt = await signHostJwt(hostJwk, issuer);
      const res = await api.registerConnection(hostJwt, {
        name: name.trim(),
        platform,
        authMethod,
        secret: parsedSecret,
        allowedOperations: ops
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setFormOk(`Connection registered (${res.connection_id}). The secret is encrypted at rest.`);
      setName('');
      setSecret('');
      setOps('');
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Connection Vault</h1>
          <p className="page-sub">
            Encrypted, governed platform credentials (AES-256-GCM) - injected server-side, never exposed to agents.
          </p>
        </div>
        <button type="button" className="primaryBtn" onClick={() => setShowForm((s) => !s)}>
          Register Connection
        </button>
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}

      {showForm && (
        <div className="panel">
          <div className="panelHead">
            <h2>Register Connection</h2>
            <button type="button" className="linkBtn" onClick={() => setShowForm(false)}>
              Close
            </button>
          </div>
          <p className="muted">
            The secret is signed for with your operator host key in the browser, sent once, and encrypted
            at rest. It is never returned by the API.
          </p>
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. team-slack" />
          </label>
          <label className="field">
            <span>Platform</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Auth method</span>
            <select value={authMethod} onChange={(e) => setAuthMethod(e.target.value)}>
              {AUTH_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Secret (JSON)</span>
            <textarea
              rows={3}
              className="mono"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={SECRET_HINT[platform] ?? '{ "token": "..." }'}
            />
          </label>
          <label className="field">
            <span>Allowed operations (comma-separated)</span>
            <input
              type="text"
              value={ops}
              onChange={(e) => setOps(e.target.value)}
              placeholder={platform === 'slack' ? 'post_message, list_channels' : 'POST /widgets, GET /status'}
            />
          </label>
          {formError && <div className="errorBox">{formError}</div>}
          {formOk && <div className="resultBox">{formOk}</div>}
          <button type="button" className="primaryBtn" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Registering...' : 'Register Connection'}
          </button>
        </div>
      )}

      {isLoading && <p className="muted">Loading vault...</p>}
      {error && <p className="muted">Failed to load connections (is the gateway running?).</p>}

      {!isLoading && !error && (
        <table className="registry">
          <thead>
            <tr>
              <th>Connection</th>
              <th>Platform</th>
              <th>Allowed operations</th>
              <th>Vault</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {conns.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="cellName">{c.name}</div>
                  <div className="cellId">{c.id}</div>
                </td>
                <td className="mono">{c.platform}</td>
                <td className="cellDesc">
                  {c.allowed_operations.length ? c.allowed_operations.join(', ') : '-'}
                </td>
                <td>
                  <span className="vaultBadge">
                    <Icon name="key" /> Encrypted
                  </span>
                </td>
                <td className="mono">{fmt(c.created_at)}</td>
              </tr>
            ))}
            {conns.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No connections registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
