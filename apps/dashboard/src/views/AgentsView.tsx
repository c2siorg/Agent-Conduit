import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDashboardApi, type AgentSummary } from '../api/client';
import { useAgents } from '../api/queries';
import type { NavKey } from '../components/AppShell';
import { EditAgentForm } from '../components/EditAgentForm';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import { RegisterAgentForm } from '../components/RegisterAgentForm';
import { StatusPill } from '../components/StatusPill';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="stat">
      <div className="statValue mono">{value}</div>
      <div className="statLabel">{label}</div>
    </div>
  );
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

/**
 * Agent Management. The operator host key is persisted in sessionStorage so it survives view switches
 * and refreshes (cleared on Clear or when the tab closes); it never leaves the browser. Includes a
 * client-side search + status filter.
 */
export function AgentsView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { data, isLoading, error } = useAgents();
  const queryClient = useQueryClient();
  const { key: hostKey, loaded } = useOperatorKey();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AgentSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const agents = data ?? [];

  const count = (status: string) => agents.filter((a) => a.status === status).length;

  const q = search.trim().toLowerCase();
  const filtered = agents.filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) {
      return false;
    }
    if (!q) {
      return true;
    }
    return (
      a.id.toLowerCase().includes(q) ||
      (a.name ?? '').toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q)
    );
  });

  async function revoke(agentId: string): Promise<void> {
    setActionError(null);
    if (!hostKey.trim()) {
      setActionError('Set the operator host key first.');
      return;
    }
    if (!window.confirm(`Revoke agent ${agentId}? This is permanent.`)) {
      return;
    }
    setBusyId(agentId);
    try {
      const hostJwk = parseHostKey(hostKey);
      const issuer = await api.getIssuer();
      const hostJwt = await signHostJwt(hostJwk, issuer);
      await api.revokeAgent(hostJwt, agentId);
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Active Agent Identities</h1>
          <p className="page-sub">
            The cryptographic registry. Register, edit, or revoke agents (requires your operator host key from Settings).
          </p>
        </div>
        <button type="button" className="primaryBtn" onClick={() => setShowForm((s) => !s)}>
          Register Agent
        </button>
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}

      {showForm && <RegisterAgentForm hostKey={hostKey} onClose={() => setShowForm(false)} />}
      {editing && <EditAgentForm agent={editing} hostKey={hostKey} onClose={() => setEditing(null)} />}
      {actionError && <div className="errorBox">{actionError}</div>}

      <div className="statRow">
        <Stat label="Registered Agents" value={String(agents.length)} />
        <Stat label="Active" value={String(count('active'))} />
        <Stat label="Revoked" value={String(count('revoked'))} />
      </div>

      {isLoading && <p className="muted">Loading registry...</p>}
      {error && <p className="muted">Failed to load agents (is the gateway running?).</p>}

      {!isLoading && !error && (
        <>
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search by name, id, or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
              <option value="rejected">Rejected</option>
              <option value="claimed">Claimed</option>
            </select>
            <span className="toolbarCount">
              {filtered.length} of {agents.length}
            </span>
          </div>

          <table className="registry">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Description</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="cellName">{a.name || 'Unnamed agent'}</div>
                    <div className="cellId">{a.id}</div>
                  </td>
                  <td className="cellDesc">{a.description || '-'}</td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                  <td className="mono">{a.mode}</td>
                  <td className="mono">{fmt(a.created_at)}</td>
                  <td>
                    <div className="rowActions">
                      <button type="button" className="linkBtn" disabled={busyId === a.id} onClick={() => setEditing(a)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="linkBtn danger"
                        disabled={busyId === a.id || a.status === 'revoked'}
                        onClick={() => void revoke(a.id)}
                      >
                        {busyId === a.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {agents.length === 0 ? 'No agents registered yet.' : 'No agents match your filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
