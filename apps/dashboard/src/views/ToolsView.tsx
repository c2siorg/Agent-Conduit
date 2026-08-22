import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createDashboardApi, type ToolSummary } from '../api/client';
import { useMetrics, useTools } from '../api/queries';
import type { NavKey } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import { RegisterToolForm } from '../components/RegisterToolForm';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { pushToast } from '../lib/toast';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'not cached';
}

/**
 * Tool & Schema Router. Registered tools, their adapter type, schema-cache status, and per-tool token-cost
 * telemetry from the router. Schemas themselves are identity-scoped and never listed here. Operators can
 * register, edit, and delete tools (host-key signed), and flush the shared schema cache.
 */
export function ToolsView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { data, isLoading, error } = useTools();
  const metrics = useMetrics();
  const { key: hostKey, loaded } = useOperatorKey();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ToolSummary | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const tools = data ?? [];
  const tokens = metrics.data?.tokensByTool ?? {};

  function requireKey(): boolean {
    if (!hostKey.trim()) {
      setActionError('Set the operator host key first.');
      return false;
    }
    return true;
  }

  async function hostJwt(): Promise<string> {
    const issuer = await api.getIssuer();
    return signHostJwt(parseHostKey(hostKey), issuer);
  }

  async function remove(tool: ToolSummary): Promise<void> {
    setActionError(null);
    if (!requireKey()) {
      return;
    }
    if (!window.confirm(`Delete tool "${tool.name}"? Agents will no longer be able to fetch its schema.`)) {
      return;
    }
    setRowBusy(tool.name);
    try {
      await api.deleteTool(await hostJwt(), tool.name);
      await queryClient.invalidateQueries({ queryKey: ['tools'] });
      pushToast(`Deleted tool "${tool.name}"`, 'success');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  async function flushCache(): Promise<void> {
    setActionError(null);
    if (!requireKey()) {
      return;
    }
    setRowBusy('__flush__');
    try {
      await api.flushToolCache(await hostJwt());
      await queryClient.invalidateQueries({ queryKey: ['tools'] });
      pushToast('Schema cache flushed', 'success');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setRowBusy(null);
    }
  }

  function openEdit(tool: ToolSummary): void {
    setEditing(tool);
    setShowForm(false);
  }

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Tool &amp; Schema Router</h1>
          <p className="page-sub">On-demand, identity-scoped tool schemas from MCP, OpenAPI, and CLI sources.</p>
        </div>
        <div className="rowActions">
          {tools.length > 0 && (
            <button
              type="button"
              className="linkBtn"
              disabled={rowBusy === '__flush__'}
              onClick={() => void flushCache()}
            >
              {rowBusy === '__flush__' ? 'Flushing...' : 'Flush cache'}
            </button>
          )}
          <button
            type="button"
            className="primaryBtn"
            onClick={() => {
              setEditing(null);
              setShowForm((s) => !s);
            }}
          >
            Register tool
          </button>
        </div>
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}
      {showForm && !editing && <RegisterToolForm hostKey={hostKey} onClose={() => setShowForm(false)} />}
      {editing && (
        <RegisterToolForm hostKey={hostKey} initial={editing} onClose={() => setEditing(null)} />
      )}
      {actionError && <div className="errorBox">{actionError}</div>}

      {isLoading && <p className="muted">Loading tools...</p>}
      {error && <p className="muted">Failed to load tools (is the gateway running?).</p>}

      {!isLoading && !error && tools.length === 0 && !showForm && (
        <EmptyState
          icon="tools"
          title="No tools registered yet"
          text="Register a tool to serve its schema to agents on demand. Each tool is bound to an adapter (MCP, OpenAPI, or CLI); agents only receive a schema when they hold a matching grant."
          action={{
            label: 'Register your first tool',
            onClick: () => {
              setEditing(null);
              setShowForm(true);
            },
          }}
        />
      )}

      {!isLoading && !error && tools.length > 0 && (
        <table className="registry">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Adapter</th>
              <th>Schema cache</th>
              <th>Requests</th>
              <th>Avg tokens</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => {
              const stat = tokens[t.name];
              const avg = stat && stat.calls ? Math.round(stat.totalTokens / stat.calls) : null;
              return (
                <tr key={t.name}>
                  <td className="cellName">{t.name}</td>
                  <td className="mono">{t.adapter_type}</td>
                  <td className="mono">{fmt(t.schema_cached_at)}</td>
                  <td className="mono">{stat?.calls ?? 0}</td>
                  <td className="mono">{avg != null ? `~${avg}` : '-'}</td>
                  <td>
                    <div className="rowActions">
                      <button type="button" className="linkBtn" onClick={() => openEdit(t)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="linkBtn danger"
                        disabled={rowBusy === t.name}
                        onClick={() => void remove(t)}
                      >
                        {rowBusy === t.name ? 'Deleting...' : 'Delete'}
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
