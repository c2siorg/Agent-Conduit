import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createDashboardApi,
  type ConnectionSummary,
  type ConnectorInfo,
  type CredentialTestResult,
} from '../api/client';
import { useConnections, useConnectors, useProjects } from '../api/queries';
import type { NavKey } from '../components/AppShell';
import { ConnectorAvatar, ConnectorPicker } from '../components/ConnectorPicker';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { ProjectChip } from '../components/ProjectChip';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { useOperatorKey } from '../lib/useOperatorKey';
import { pushToast } from '../lib/toast';

const api = createDashboardApi();

const ALL_AUTH_METHODS = ['bearer', 'apiKey', 'basic', 'customHeader'];

// Per-platform secret shape hints (the JSON fields the connector's templates expect).
const SECRET_HINT: Record<string, string> = {
  rest: '{ "baseUrl": "https://api.example.com", "token": "..." }',
  slack: '{ "token": "xoxb-..." }',
  github: '{ "token": "ghp_..." }',
  notion: '{ "token": "secret_..." }',
  linear: '{ "token": "lin_api_..." }',
  jira: '{ "site": "your-site", "basic": "<base64 email:token>" }',
  zendesk: '{ "subdomain": "acme", "basic": "<base64 email/token:apiToken>" }',
  salesforce: '{ "instance": "yourorg", "token": "<oauth access token>" }',
  trello: '{ "key": "...", "token": "..." }',
  datadog: '{ "apiKey": "...", "appKey": "..." }',
  gmail: '{ "token": "<oauth access token>" }',
  openai: '{ "token": "sk-..." }',
  claude: '{ "token": "sk-ant-..." }',
  zapier: '{ "webhookUrl": "https://hooks.zapier.com/hooks/catch/..." }',
  ifttt: '{ "key": "...", "event": "..." }',
  ollama: '{ "baseUrl": "http://localhost:11434" }',
  mock: '{ "token": "any" }',
};

function hintFor(platform: string): string {
  return SECRET_HINT[platform] ?? '{ "token": "..." }';
}

function fmt(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

/** Compact relative time, e.g. "2h ago". */
function relTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Connection Vault. Lists governed platform credentials (NO secret values are ever returned) and lets the
 * operator register a new one. Registration is a two-step flow: pick a connector card, then fill a form
 * pre-configured from that connector (auth methods, secret shape, and operations). The secret is signed
 * for with the operator host key in the browser, sent once, encrypted at rest, and never returned.
 */
export function ConnectionsView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { data, isLoading, error } = useConnections();
  const queryClient = useQueryClient();
  const conns = data ?? [];

  const { key: hostKey, loaded } = useOperatorKey();
  const connectors = useConnectors();
  const projects = useProjects().data ?? [];
  const connectorList = connectors.data ?? [];
  const labelFor = (platform: string): string =>
    connectorList.find((c) => c.platform === platform)?.label ?? platform;

  // Registration flow: null = closed, 'pick' = choosing a connector, else the selected connector.
  const [step, setStep] = useState<'closed' | 'pick'>('closed');
  const [selected, setSelected] = useState<ConnectorInfo | null>(null);
  const [name, setName] = useState('');
  const [authMethod, setAuthMethod] = useState('bearer');
  const [secret, setSecret] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [rawMode, setRawMode] = useState(false);
  const [project, setProject] = useState('');
  const [ops, setOps] = useState<string[]>([]);
  const [opDraft, setOpDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  // Row-level state: per-connection busy action + last test result, and the connection being edited.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, CredentialTestResult>>({});
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editOps, setEditOps] = useState<string[]>([]);
  const [editSecret, setEditSecret] = useState('');
  const [editProject, setEditProject] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  async function hostJwt(): Promise<string> {
    return signHostJwt(parseHostKey(hostKey), await api.getIssuer());
  }

  function requireKey(): boolean {
    if (!hostKey.trim()) {
      setRowError('Set the operator host key first.');
      return false;
    }
    setRowError(null);
    return true;
  }

  async function testConnection(id: string): Promise<void> {
    if (!requireKey()) {
      return;
    }
    setRowBusy(id);
    try {
      const result = await api.testConnection(await hostJwt(), id);
      setTests((prev) => ({ ...prev, [id]: result }));
      pushToast(`${result.ok ? 'Test passed' : 'Test failed'} (${result.checked}): ${result.detail}`, result.ok ? 'success' : 'error');
    } catch (e) {
      setTests((prev) => ({ ...prev, [id]: { ok: false, checked: 'structure', detail: e instanceof Error ? e.message : String(e) } }));
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteConnection(c: ConnectionSummary): Promise<void> {
    if (!requireKey()) {
      return;
    }
    if (!window.confirm(`Delete connection "${c.name}"? This cannot be undone.`)) {
      return;
    }
    setRowBusy(c.id);
    try {
      await api.deleteConnection(await hostJwt(), c.id);
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
      pushToast(`Deleted connection "${c.name}"`, 'success');
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  function openEdit(c: ConnectionSummary): void {
    setEditing(c);
    setEditName(c.name);
    setEditOps(c.allowed_operations);
    setEditSecret('');
    setEditProject(c.project_id ?? '');
    setRowError(null);
  }

  async function saveEdit(): Promise<void> {
    if (!editing || !requireKey()) {
      return;
    }
    let secretPatch: Record<string, string> | undefined;
    if (editSecret.trim()) {
      try {
        secretPatch = JSON.parse(editSecret) as Record<string, string>;
      } catch {
        setRowError('New secret must be valid JSON.');
        return;
      }
    }
    setRowBusy(editing.id);
    try {
      await api.updateConnection(await hostJwt(), editing.id, {
        name: editName.trim(),
        allowedOperations: editOps,
        ...(secretPatch ? { secret: secretPatch } : {}),
        ...((editProject || null) !== (editing.project_id ?? null) ? { projectId: editProject || null } : {}),
      });
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setRowBusy(null);
    }
  }

  function openPicker(): void {
    setStep('pick');
    setSelected(null);
    setFormOk(null);
    setFormError(null);
  }

  function chooseConnector(c: ConnectorInfo): void {
    setSelected(c);
    setAuthMethod(c.auth_methods[0] ?? 'bearer');
    setName('');
    setSecret('');
    setFieldValues({});
    setRawMode(c.fields.length === 0); // no structured fields (e.g. generic REST) -> raw JSON
    setOps([]);
    setOpDraft('');
    setFormError(null);
    setFormOk(null);
  }

  function toggleOp(op: string): void {
    setOps((prev) => (prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]));
  }

  function addOpDraft(): void {
    const value = opDraft.trim();
    if (value && !ops.includes(value)) {
      setOps((prev) => [...prev, value]);
    }
    setOpDraft('');
  }

  async function submit(): Promise<void> {
    if (!selected) {
      return;
    }
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
    // Build the secret from structured fields, or parse raw JSON in advanced mode.
    let parsedSecret: Record<string, string>;
    if (rawMode) {
      try {
        parsedSecret = JSON.parse(secret || '{}') as Record<string, string>;
      } catch {
        setFormError('Secret must be valid JSON.');
        return;
      }
    } else {
      const missing = selected.fields.filter((f) => f.required && !(fieldValues[f.key] ?? '').trim());
      if (missing.length > 0) {
        setFormError(`Fill required field(s): ${missing.map((f) => f.label).join(', ')}`);
        return;
      }
      parsedSecret = {};
      for (const f of selected.fields) {
        const v = (fieldValues[f.key] ?? '').trim();
        if (v) {
          parsedSecret[f.key] = v;
        }
      }
    }
    setBusy(true);
    try {
      const hostJwt = await signHostJwt(parseHostKey(hostKey), await api.getIssuer());
      const res = await api.registerConnection(hostJwt, {
        name: name.trim(),
        platform: selected.platform,
        authMethod,
        secret: parsedSecret,
        allowedOperations: ops,
        projectId: project || null,
      });
      // Auto-test the freshly registered connection so the operator immediately knows if it works.
      let verdict = 'The secret is encrypted at rest.';
      try {
        const test = await api.testConnection(hostJwt, res.connection_id);
        verdict = test.ok
          ? `Verified (${test.checked}): ${test.detail}.`
          : `Registered, but the test failed (${test.checked}): ${test.detail}.`;
      } catch {
        /* leave the default verdict if the probe couldn't run */
      }
      setFormOk(`Connection "${name.trim()}" registered. ${verdict}`);
      setStep('closed');
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const authOptions = selected && selected.auth_methods.length > 0 ? selected.auth_methods : ALL_AUTH_METHODS;

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Connection Vault</h1>
          <p className="page-sub">
            Encrypted, governed platform credentials (AES-256-GCM) - injected server-side, never exposed to agents.
          </p>
        </div>
        {step === 'closed' ? (
          <button type="button" className="primaryBtn" onClick={openPicker}>
            Register Connection
          </button>
        ) : (
          <button type="button" className="linkBtn" onClick={() => setStep('closed')}>
            Close
          </button>
        )}
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}

      {step === 'pick' && !selected && (
        <div className="panel">
          <div className="panelHead">
            <h2>Choose a connector</h2>
          </div>
          {connectors.isLoading && <p className="muted">Loading connectors...</p>}
          <ConnectorPicker connectors={connectorList} onSelect={chooseConnector} />
        </div>
      )}

      {step === 'pick' && selected && (
        <div className="panel">
          <div className="panelHead">
            <div className="selectedConnector">
              <ConnectorAvatar platform={selected.platform} label={selected.label} size={30} />
              <div>
                <h2>{selected.label}</h2>
                <span className="muted mono">{selected.platform}</span>
              </div>
            </div>
            <div className="selectedConnectorActions">
              {selected.docs_url && (
                <a className="link" href={selected.docs_url} target="_blank" rel="noreferrer">
                  Where do I get credentials?
                </a>
              )}
              <button type="button" className="linkBtn" onClick={openPicker}>
                Change connector
              </button>
            </div>
          </div>

          <label className="field">
            <span>Connection name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. team-${selected.platform}`} />
          </label>

          <label className="field">
            <span>Auth method</span>
            <select value={authMethod} onChange={(e) => setAuthMethod(e.target.value)}>
              {authOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Project — a project-scoped credential is isolated to agents in that project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Unassigned (global)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {!rawMode && selected.fields.length > 0 ? (
            <div className="fieldSet">
              <div className="fieldSetHead">
                <span>Credentials — stored encrypted, never returned</span>
                <button type="button" className="linkBtn" onClick={() => setRawMode(true)}>
                  Advanced (raw JSON)
                </button>
              </div>
              {selected.fields.map((f) => (
                <label key={f.key} className="field">
                  <span>
                    {f.label}
                    {!f.required && <span className="muted"> (optional)</span>}
                  </span>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={fieldValues[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                  {f.help && <span className="fieldHelp muted">{f.help}</span>}
                </label>
              ))}
            </div>
          ) : (
            <label className="field">
              <span>
                Secret (JSON) — stored encrypted, never returned
                {selected.fields.length > 0 && (
                  <button type="button" className="linkBtn" onClick={() => setRawMode(false)} style={{ marginLeft: 8 }}>
                    Use guided fields
                  </button>
                )}
              </span>
              <textarea rows={3} className="mono" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={hintFor(selected.platform)} />
            </label>
          )}

          <div className="field">
            <div className="fieldSetHead">
              <span>
                Allowed operations
                <span className="muted"> — {ops.length === 0 ? 'empty allows ALL operations' : `${ops.length} selected (others blocked)`}</span>
              </span>
              {selected.operations.length > 0 && (
                <span>
                  <button type="button" className="linkBtn" onClick={() => setOps(selected.operations.map((o) => o.name))}>
                    Select all
                  </button>
                  <button type="button" className="linkBtn" onClick={() => setOps([])} style={{ marginLeft: 8 }}>
                    Clear
                  </button>
                </span>
              )}
            </div>
            {selected.operations.length > 0 && (
              <div className="opChips">
                {selected.operations.map((op) => (
                  <button
                    key={op.name}
                    type="button"
                    className={ops.includes(op.name) ? 'opChip on' : 'opChip'}
                    title={op.description}
                    onClick={() => toggleOp(op.name)}
                  >
                    {op.name}
                  </button>
                ))}
              </div>
            )}
            <div className="opAdd">
              <input
                type="text"
                value={opDraft}
                onChange={(e) => setOpDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addOpDraft();
                  }
                }}
                placeholder={selected.platform === 'rest' ? 'POST /widgets' : 'add a custom operation'}
              />
              <button type="button" className="linkBtn" onClick={addOpDraft}>
                Add
              </button>
            </div>
            {ops.length > 0 && (
              <div className="opChips">
                {ops.map((op) => (
                  <button key={op} type="button" className="opChip on" onClick={() => toggleOp(op)}>
                    {op} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          {formError && <div className="errorBox">{formError}</div>}
          <button type="button" className="primaryBtn" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Registering...' : `Register ${selected.label} connection`}
          </button>
        </div>
      )}

      {formOk && step === 'closed' && <div className="resultBox">{formOk}</div>}

      {editing && (
        <div className="panel">
          <div className="panelHead">
            <div className="selectedConnector">
              <ConnectorAvatar platform={editing.platform} label={labelFor(editing.platform)} size={30} />
              <div>
                <h2>Edit {editing.name}</h2>
                <span className="muted mono">{editing.id}</span>
              </div>
            </div>
            <button type="button" className="linkBtn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <label className="field">
            <span>Connection name</span>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </label>
          <label className="field">
            <span>Allowed operations (comma-separated)</span>
            <input
              type="text"
              value={editOps.join(', ')}
              onChange={(e) => setEditOps(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            />
          </label>
          <label className="field">
            <span>Project</span>
            <select value={editProject} onChange={(e) => setEditProject(e.target.value)}>
              <option value="">Global (no project)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Rotate secret (JSON) — leave blank to keep the current one</span>
            <textarea rows={2} className="mono" value={editSecret} onChange={(e) => setEditSecret(e.target.value)} placeholder={hintFor(editing.platform)} />
          </label>
          {rowError && <div className="errorBox">{rowError}</div>}
          <button type="button" className="primaryBtn" disabled={rowBusy === editing.id} onClick={() => void saveEdit()}>
            {rowBusy === editing.id ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      )}

      {rowError && !editing && <div className="errorBox">{rowError}</div>}

      {isLoading && <p className="muted">Loading vault...</p>}
      {error && <p className="muted">Failed to load connections (is the gateway running?).</p>}

      {!isLoading && !error && conns.length === 0 && step === 'closed' && (
        <EmptyState
          icon="connections"
          title="No connections yet"
          text="A connection is a governed platform credential (Slack, GitHub, a REST API, ...). It is encrypted at rest and injected server-side — agents never see the secret. Add one to start wiring access."
          action={{ label: 'Add your first connection', onClick: () => setStep('pick') }}
        />
      )}

      {!isLoading && !error && conns.length > 0 && (
        <table className="registry">
          <thead>
            <tr>
              <th>Connection</th>
              <th>Platform</th>
              <th>Project</th>
              <th>Allowed operations</th>
              <th>Test</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {conns.map((c) => {
              const t = tests[c.id];
              const isBusy = rowBusy === c.id;
              return (
                <tr key={c.id}>
                  <td>
                    <div className="cellName">{c.name}</div>
                    <div className="cellId">{c.id}</div>
                  </td>
                  <td>
                    <span className="platformCell">
                      <ConnectorAvatar platform={c.platform} label={labelFor(c.platform)} size={24} />
                      {labelFor(c.platform)}
                    </span>
                  </td>
                  <td>
                    <ProjectChip projectId={c.project_id} />
                  </td>
                  <td className="cellDesc">{c.allowed_operations.length ? c.allowed_operations.join(', ') : '-'}</td>
                  <td>
                    {(() => {
                      // Prefer this session's manual test; else the persisted health from the last test.
                      const ok = t ? t.ok : c.last_test_ok;
                      const detail = t ? t.detail : c.last_test_detail ?? '';
                      const checked = t?.checked;
                      if (ok === null || ok === undefined) {
                        return (
                          <span className="vaultBadge">
                            <Icon name="key" /> Untested
                          </span>
                        );
                      }
                      const label = checked ? (checked === 'live' ? (ok ? 'Live OK' : 'Live failed') : ok ? 'Fields set' : 'Missing fields') : ok ? 'Healthy' : 'Failing';
                      return (
                        <span className={ok ? 'testBadge ok' : 'testBadge bad'} title={detail}>
                          {label}
                          {!t && c.last_test_at && <span className="testAge"> · {relTime(c.last_test_at)}</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="mono">{fmt(c.created_at)}</td>
                  <td>
                    <div className="rowActions">
                      <button type="button" className="linkBtn" disabled={isBusy} onClick={() => void testConnection(c.id)}>
                        {isBusy ? 'Testing...' : 'Test'}
                      </button>
                      <button type="button" className="linkBtn" disabled={isBusy} onClick={() => openEdit(c)}>
                        Edit
                      </button>
                      <button type="button" className="linkBtn danger" disabled={isBusy} onClick={() => void deleteConnection(c)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
