import { useEffect, useState } from 'react';
import { createDashboardApi, type PolicyRule, type SecuritySettings } from '../api/client';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import type { NavKey } from '../components/AppShell';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

const EFFECTS: PolicyRule['effect'][] = ['allow', 'deny', 'require_approval'];

function csv(v: string): string[] | undefined {
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

function ruleSummary(r: PolicyRule): string {
  const bits: string[] = [];
  if (r.agentModes) bits.push(`mode∈{${r.agentModes.join(',')}}`);
  if (r.capabilities) bits.push(`cap∈{${r.capabilities.join(',')}}`);
  if (r.platforms) bits.push(`platform∈{${r.platforms.join(',')}}`);
  if (r.operations) bits.push(`op∈{${r.operations.join(',')}}`);
  if (r.minRisk) bits.push(`risk≥${r.minRisk}`);
  return bits.length ? bits.join(' · ') : 'any request';
}

/**
 * Policy engine — a first-class, visible editor for the declarative execution policy. Ordered rules are
 * evaluated at execute time; first match wins, else the default effect. Applies to the running gateway
 * immediately (host-signed PATCH /admin/config).
 */
export function PolicyView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { key, loaded } = useOperatorKey();
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Add / edit rule form. `editingId` is null when adding, or the id of the rule being edited (replaced
  // in place, preserving its position).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nid, setNid] = useState('');
  const [ndesc, setNdesc] = useState('');
  const [neffect, setNeffect] = useState<PolicyRule['effect']>('deny');
  const [ncaps, setNcaps] = useState('');
  const [nplatforms, setNplatforms] = useState('');
  const [nops, setNops] = useState('');
  const [nmodes, setNmodes] = useState('');
  const [nrisk, setNrisk] = useState('');

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
        if (!cancelled) setSettings(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, key]);

  async function persist(policy: SecuritySettings['policy']): Promise<void> {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await api.updateSecuritySettings(await hostJwt(), { ...settings, policy });
      setSettings(updated);
      setStatus('Saved — policy updated on the running gateway.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function resetForm(): void {
    setEditingId(null);
    setNid('');
    setNdesc('');
    setNeffect('deny');
    setNcaps('');
    setNplatforms('');
    setNops('');
    setNmodes('');
    setNrisk('');
    setError(null);
  }

  function startEdit(r: PolicyRule): void {
    setEditingId(r.id);
    setNid(r.id);
    setNdesc(r.description ?? '');
    setNeffect(r.effect);
    setNcaps((r.capabilities ?? []).join(', '));
    setNplatforms((r.platforms ?? []).join(', '));
    setNops((r.operations ?? []).join(', '));
    setNmodes((r.agentModes ?? []).join(', '));
    setNrisk(r.minRisk ?? '');
    setError(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function saveRule(): void {
    if (!settings) return;
    if (!nid.trim()) {
      setError('Rule id is required.');
      return;
    }
    const id = nid.trim();
    const rules = settings.policy.rules;
    // Adding: reject a duplicate id. Editing: allow keeping the same id, reject collision with a *different* rule.
    const clash = rules.some((r) => r.id === id && r.id !== editingId);
    if (clash) {
      setError(`A rule with id "${id}" already exists.`);
      return;
    }
    const rule: PolicyRule = { id, effect: neffect };
    if (ndesc.trim()) rule.description = ndesc.trim();
    const caps = csv(ncaps);
    if (caps) rule.capabilities = caps;
    const plats = csv(nplatforms);
    if (plats) rule.platforms = plats;
    const ops = csv(nops);
    if (ops) rule.operations = ops;
    const modes = csv(nmodes);
    if (modes) rule.agentModes = modes;
    if (nrisk === 'low' || nrisk === 'med' || nrisk === 'high') rule.minRisk = nrisk;

    const next = editingId
      ? rules.map((r) => (r.id === editingId ? rule : r)) // replace in place (keeps position)
      : [...rules, rule];
    void persist({ ...settings.policy, rules: next }).then(() => resetForm());
  }

  function removeRule(id: string): void {
    if (!settings) return;
    if (editingId === id) resetForm();
    void persist({ ...settings.policy, rules: settings.policy.rules.filter((r) => r.id !== id) });
  }

  /** Reorder a rule (order matters — first match wins). */
  function moveRule(index: number, dir: -1 | 1): void {
    if (!settings) return;
    const rules = [...settings.policy.rules];
    const target = index + dir;
    if (target < 0 || target >= rules.length) return;
    [rules[index], rules[target]] = [rules[target]!, rules[index]!];
    void persist({ ...settings.policy, rules });
  }

  const p = settings?.policy;

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Execution Policy</h1>
          <p className="page-sub">Ordered allow / deny / require-approval rules evaluated on every capability execute.</p>
        </div>
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}

      {loaded && !p && <p className="muted">{error ?? 'Loading policy...'}</p>}

      {p && (
        <>
          <div className="card card-pad">
            <div className="toggleRow">
              <input type="checkbox" checked={p.enabled} onChange={(e) => void persist({ ...p, enabled: e.target.checked })} />
              <span>
                <strong>Policy engine {p.enabled ? 'enabled' : 'disabled'}</strong>
                <span className="muted"> — when disabled, all executes are allowed.</span>
              </span>
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Default effect (when no rule matches)</span>
              <select value={p.defaultEffect} onChange={(e) => void persist({ ...p, defaultEffect: e.target.value as 'allow' | 'deny' })}>
                <option value="allow">allow</option>
                <option value="deny">deny (deny-by-default)</option>
              </select>
            </label>
            {error && <div className="errorBox">{error}</div>}
            {status && <div className="resultBox">{status}</div>}
          </div>

          <div className="card card-pad">
            <h2 className="cardTitle">Rules (evaluated top to bottom, first match wins)</h2>
            <table className="registry">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Rule</th>
                  <th>Match</th>
                  <th>Effect</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {p.rules.map((r, i) => (
                  <tr key={r.id} className={editingId === r.id ? 'rowEditing' : undefined}>
                    <td className="mono">{i + 1}</td>
                    <td className="cellName">{r.id}</td>
                    <td className="cellDesc mono">{ruleSummary(r)}</td>
                    <td>
                      <span className={r.effect === 'allow' ? 'ctrlChip ctrl-met' : r.effect === 'deny' ? 'ctrlChip ctrl-gap' : 'ctrlChip ctrl-partial'}>
                        {r.effect}
                      </span>
                    </td>
                    <td>
                      <div className="rowActions">
                        <button type="button" className="linkBtn" disabled={busy || i === 0} title="Move up" onClick={() => moveRule(i, -1)}>
                          ↑
                        </button>
                        <button type="button" className="linkBtn" disabled={busy || i === p.rules.length - 1} title="Move down" onClick={() => moveRule(i, 1)}>
                          ↓
                        </button>
                        <button type="button" className="linkBtn" disabled={busy} onClick={() => startEdit(r)}>
                          Edit
                        </button>
                        <button type="button" className="linkBtn danger" disabled={busy} onClick={() => removeRule(r.id)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {p.rules.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No rules — every execute falls through to the default effect ({p.defaultEffect}).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card card-pad">
            <h2 className="cardTitle">{editingId ? `Edit rule "${editingId}"` : 'Add rule'}</h2>
            <p className="muted">Leave a match field blank to match anything. Comma-separate multiple values; use * for wildcard.</p>
            <div className="ruleForm">
              <label className="field">
                <span>Rule id{editingId && ' (fixed)'}</span>
                <input type="text" value={nid} disabled={Boolean(editingId)} onChange={(e) => setNid(e.target.value)} placeholder="gate-high-risk" />
              </label>
              <label className="field">
                <span>Effect</span>
                <select value={neffect} onChange={(e) => setNeffect(e.target.value as PolicyRule['effect'])}>
                  {EFFECTS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Min risk</span>
                <select value={nrisk} onChange={(e) => setNrisk(e.target.value)}>
                  <option value="">any</option>
                  <option value="low">low</option>
                  <option value="med">med</option>
                  <option value="high">high</option>
                </select>
              </label>
              <label className="field">
                <span>Description (optional)</span>
                <input type="text" value={ndesc} onChange={(e) => setNdesc(e.target.value)} placeholder="what this rule does" />
              </label>
              <label className="field">
                <span>Capabilities</span>
                <input type="text" value={ncaps} onChange={(e) => setNcaps(e.target.value)} placeholder="e.g. delete_repo, *" />
              </label>
              <label className="field">
                <span>Platforms</span>
                <input type="text" value={nplatforms} onChange={(e) => setNplatforms(e.target.value)} placeholder="e.g. github, slack" />
              </label>
              <label className="field">
                <span>Operations</span>
                <input type="text" value={nops} onChange={(e) => setNops(e.target.value)} placeholder="e.g. create_issue" />
              </label>
              <label className="field">
                <span>Agent modes</span>
                <input type="text" value={nmodes} onChange={(e) => setNmodes(e.target.value)} placeholder="e.g. autonomous" />
              </label>
            </div>
            <div className="rowActions">
              <button type="button" className="primaryBtn" disabled={busy} onClick={saveRule}>
                {busy ? 'Saving...' : editingId ? 'Save changes' : 'Add rule'}
              </button>
              {editingId && (
                <button type="button" className="linkBtn" disabled={busy} onClick={resetForm}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
