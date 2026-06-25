import { useMemo, useState } from 'react';
import type { AuditEntry } from '../api/client';
import { useAudit } from '../api/queries';
import { StatusPill } from '../components/StatusPill';

function fmt(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

/** Map an audit outcome to a status-pill tone (success/denied/error). */
function outcomePill(outcome: string): string {
  if (outcome === 'success') {
    return 'active';
  }
  if (outcome === 'denied') {
    return 'pending';
  }
  return 'revoked';
}

function toCsv(rows: AuditEntry[]): string {
  const header = ['created_at', 'agent_id', 'event_type', 'capability', 'operation', 'outcome', 'duration_ms', 'args_hash'];
  const lines = rows.map((r) =>
    [r.created_at, r.agent_id, r.event_type, r.capability, r.operation, r.outcome, r.duration_ms, r.args_hash]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/**
 * Audit Logs. A near-live, filterable view over `GET /audit`. Args are shown only as a hash (raw args are
 * never stored or returned). Supports filtering by agent id + outcome and CSV export of the current view.
 */
export function AuditView(): JSX.Element {
  const [agentId, setAgentId] = useState('');
  const [outcome, setOutcome] = useState('all');

  const filter = useMemo(
    () => ({
      ...(agentId.trim() ? { agentId: agentId.trim() } : {}),
      ...(outcome !== 'all' ? { outcome } : {}),
    }),
    [agentId, outcome],
  );
  const { data, isLoading, error } = useAudit(filter);
  const entries = data ?? [];

  function exportCsv(): void {
    const blob = new Blob([toCsv(entries)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conduit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Audit Logs</h1>
          <p className="page-sub">
            Per-agent, queryable audit trail. Arguments are recorded as a hash - raw args are never stored.
          </p>
        </div>
        <button type="button" className="primaryBtn" disabled={entries.length === 0} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by agent id"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        />
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="all">All outcomes</option>
          <option value="success">Success</option>
          <option value="denied">Denied</option>
          <option value="error">Error</option>
        </select>
        <span className="toolbarCount">{entries.length} events</span>
      </div>

      {isLoading && <p className="muted">Loading audit stream...</p>}
      {error && <p className="muted">Failed to load audit log (is the gateway running?).</p>}

      {!isLoading && !error && (
        <table className="registry">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Event</th>
              <th>Capability / Operation</th>
              <th>Outcome</th>
              <th>Duration</th>
              <th>Args hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{fmt(e.created_at)}</td>
                <td className="mono cellId">{e.agent_id ?? '-'}</td>
                <td className="mono">{e.event_type}</td>
                <td>
                  <div className="cellName">{e.capability ?? '-'}</div>
                  <div className="cellId mono">{e.operation ?? ''}</div>
                </td>
                <td>
                  <StatusPill status={outcomePill(e.outcome)} label={e.outcome} />
                </td>
                <td className="mono">{e.duration_ms != null ? `${e.duration_ms} ms` : '-'}</td>
                <td className="mono cellId">{e.args_hash ? `${e.args_hash.slice(0, 12)}...` : '-'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No audit events recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
