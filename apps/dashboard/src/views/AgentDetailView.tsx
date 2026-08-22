import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createDashboardApi } from '../api/client';
import { useAgents, useAudit } from '../api/queries';
import { AgentGrantsPanel } from '../components/AgentGrantsPanel';
import type { NavKey } from '../components/AppShell';
import { EditAgentForm } from '../components/EditAgentForm';
import { EmptyState } from '../components/EmptyState';
import { ProjectChip } from '../components/ProjectChip';
import { StatusPill } from '../components/StatusPill';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { pushToast } from '../lib/toast';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

/** Map an audit outcome to a status-pill tone. */
function outcomePill(outcome: string): string {
  if (outcome === 'success') return 'active';
  if (outcome === 'denied') return 'pending';
  return 'revoked';
}

/**
 * Per-agent detail page (reached by clicking an agent in the registry). Consolidates everything about one
 * agent: identity + lifecycle actions, its access/blast-radius (grants), and its recent activity — replacing
 * the standalone Topology page.
 */
export function AgentDetailView({
  agentId,
  onNavigate,
}: {
  agentId: string;
  onNavigate: (key: NavKey) => void;
}): JSX.Element {
  const agents = useAgents().data ?? [];
  const agent = agents.find((a) => a.id === agentId);
  const { key: hostKey, loaded } = useOperatorKey();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const audit = useAudit({ agentId });
  const entries = audit.data ?? [];

  async function revoke(): Promise<void> {
    if (!agent) return;
    if (!loaded) {
      pushToast('Set your operator host key first (top bar).', 'error');
      return;
    }
    if (!window.confirm(`Revoke agent ${agent.name || agent.id}? This is permanent.`)) {
      return;
    }
    setBusy(true);
    try {
      const hostJwt = await signHostJwt(parseHostKey(hostKey), await api.getIssuer());
      await api.revokeAgent(hostJwt, agent.id);
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      pushToast('Agent revoked', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view">
      <button type="button" className="backLink" onClick={() => onNavigate('agents')}>
        ← Agents
      </button>

      {!agent && (
        <EmptyState
          icon="agents"
          title="Agent not found"
          text="This agent no longer exists, or the registry is still loading."
          action={{ label: 'Back to agents', onClick: () => onNavigate('agents') }}
        />
      )}

      {agent && (
        <>
          <div className="viewHead">
            <div>
              <div className="detailTitleRow">
                <h1>{agent.name || 'Unnamed agent'}</h1>
                <StatusPill status={agent.status} />
                <ProjectChip projectId={agent.project_id} />
              </div>
              <p className="page-sub mono">{agent.id}</p>
            </div>
            <div className="rowActions">
              <button type="button" className="linkBtn" onClick={() => setEditing((s) => !s)}>
                Edit
              </button>
              <button
                type="button"
                className="linkBtn danger"
                disabled={busy || agent.status === 'revoked'}
                onClick={() => void revoke()}
              >
                {busy ? 'Revoking...' : 'Revoke agent'}
              </button>
            </div>
          </div>

          {editing && <EditAgentForm agent={agent} hostKey={hostKey} onClose={() => setEditing(false)} />}

          <dl className="configGrid detailMeta">
            <dt>Mode</dt>
            <dd className="mono">{agent.mode}</dd>
            <dt>Created</dt>
            <dd className="mono">{fmt(agent.created_at)}</dd>
            <dt>Activated</dt>
            <dd className="mono">{fmt(agent.activated_at)}</dd>
            <dt>Session expires</dt>
            <dd className="mono">{fmt(agent.session_expires_at)}</dd>
            {agent.description && (
              <>
                <dt>Description</dt>
                <dd>{agent.description}</dd>
              </>
            )}
          </dl>

          <AgentGrantsPanel agentId={agent.id} onNavigate={onNavigate} />

          <div className="sectionHead">
            <h2 className="cardTitle">Recent activity</h2>
          </div>
          {audit.isLoading && <p className="muted">Loading activity...</p>}
          {!audit.isLoading && entries.length === 0 && (
            <p className="muted">No audit events for this agent yet.</p>
          )}
          {entries.length > 0 && (
            <table className="registry">
              <thead>
                <tr>
                  <th>Time</th>
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
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
