import { useCallback, useEffect, useState } from 'react';
import { createDashboardApi, type AgentGrant } from '../api/client';
import { useConnections, useConnectors, useTools } from '../api/queries';
import type { NavKey } from './AppShell';
import { ConnectorAvatar } from './ConnectorPicker';
import { OperatorKeyNotice } from './OperatorKeyNotice';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { blastRadius, grantRisk } from '../lib/risk';
import { pushToast } from '../lib/toast';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

/**
 * Access & blast radius for ONE agent: its capability grants (risk-colored, revocable), the connections
 * they reach, a blast-radius summary, and a "grant capability" form. Extracted from the old Topology page
 * so it can live inside the per-agent detail view.
 */
export function AgentGrantsPanel({
  agentId,
  onNavigate,
}: {
  agentId: string;
  onNavigate: (key: NavKey) => void;
}): JSX.Element {
  const connections = useConnections().data ?? [];
  const connectors = useConnectors().data ?? [];
  const tools = useTools().data ?? []; // registered capability/tool names, for the pick-don't-retype datalist
  const { key: hostKey, loaded } = useOperatorKey();
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyCap, setBusyCap] = useState<string | null>(null);

  // "Grant capability" form state.
  const [showGrant, setShowGrant] = useState(false);
  const [gCap, setGCap] = useState('');
  const [gConn, setGConn] = useState('');
  const [gOp, setGOp] = useState('');
  const [gConstraints, setGConstraints] = useState('{}');
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  // Valid operations for the chosen connection: its allow-list if set, else the connector's full set.
  const opsForConnection = (connId: string): string[] => {
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return [];
    if (conn.allowed_operations.length > 0) return conn.allowed_operations;
    return (connectors.find((k) => k.platform === conn.platform)?.operations ?? []).map((o) => o.name);
  };

  const loadGrants = useCallback((id: string) => {
    setLoading(true);
    return api
      .listAgentGrants(id)
      .then((g) => setGrants(g))
      .catch(() => setGrants([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (agentId) {
      void loadGrants(agentId);
    }
  }, [agentId, loadGrants]);

  async function hostJwt(): Promise<string> {
    return signHostJwt(parseHostKey(hostKey), await api.getIssuer());
  }

  async function revoke(capability: string): Promise<void> {
    if (!loaded) {
      pushToast('Set your operator host key first (top bar).', 'error');
      return;
    }
    if (!window.confirm(`Revoke "${capability}" from this agent? It will be denied on the next call.`)) {
      return;
    }
    setBusyCap(capability);
    try {
      await api.revokeGrant(await hostJwt(), agentId, capability);
      await loadGrants(agentId);
      pushToast(`Revoked "${capability}"`, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusyCap(null);
    }
  }

  // Re-grant a previously-revoked capability in one click — restores its exact connection + operation +
  // constraints (no retyping). Falls back to opening the form prefilled if the mapping is incomplete.
  async function regrant(g: AgentGrant): Promise<void> {
    if (!loaded) {
      pushToast('Set your operator host key first (top bar).', 'error');
      return;
    }
    if (!g.connection_id || !g.operation) {
      openGrant();
      setGCap(g.capability);
      return;
    }
    setBusyCap(g.capability);
    try {
      await api.grantCapability(await hostJwt(), {
        agentId,
        capability: g.capability,
        connectionId: g.connection_id,
        operation: g.operation,
        constraints: g.constraints ?? {},
      });
      await loadGrants(agentId);
      pushToast(`Re-granted "${g.capability}"`, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusyCap(null);
    }
  }

  function openGrant(): void {
    setGCap('');
    setGConstraints('{}');
    const firstConn = connections[0];
    setGConn(firstConn?.id ?? '');
    setGOp(firstConn ? (opsForConnection(firstConn.id)[0] ?? '') : '');
    setGrantError(null);
    setShowGrant(true);
  }

  function pickConn(id: string): void {
    setGConn(id);
    setGOp(opsForConnection(id)[0] ?? ''); // reset operation to the first valid one for the new connection
  }

  async function grant(): Promise<void> {
    setGrantError(null);
    if (!loaded) {
      setGrantError('Set your operator host key first (top bar).');
      return;
    }
    if (!gCap.trim() || !gConn || !gOp) {
      setGrantError('Capability name, connection, and operation are required.');
      return;
    }
    let constraints: Record<string, unknown>;
    try {
      constraints = JSON.parse(gConstraints || '{}') as Record<string, unknown>;
    } catch {
      setGrantError('Constraints must be valid JSON (use {} for none).');
      return;
    }
    setGranting(true);
    try {
      await api.grantCapability(await hostJwt(), { agentId, capability: gCap.trim(), connectionId: gConn, operation: gOp, constraints });
      await loadGrants(agentId);
      setShowGrant(false);
      pushToast(`Granted "${gCap.trim()}"`, 'success');
    } catch (e) {
      setGrantError(e instanceof Error ? e.message : String(e));
    } finally {
      setGranting(false);
    }
  }

  const connName = (id: string | null): string => connections.find((c) => c.id === id)?.name ?? (id ? id.slice(0, 8) : 'unmapped');
  const connPlatform = (id: string | null): string => connections.find((c) => c.id === id)?.platform ?? 'rest';
  const connLabel = (platform: string): string => connectors.find((c) => c.platform === platform)?.label ?? platform;

  const active = grants.filter((g) => g.status === 'active');
  const revoked = grants.filter((g) => g.status !== 'active'); // denied/expired — re-grantable
  const riskOf = (g: AgentGrant) => (g.risk ? { level: g.risk, score: g.risk === 'high' ? 3 : g.risk === 'med' ? 2 : 1 } : grantRisk(g.operation, g.capability));
  const radius = blastRadius(active.map((g) => riskOf(g).score));
  const reached = Array.from(new Set(active.map((g) => g.connection_id).filter((x): x is string => Boolean(x))));

  return (
    <>
      <div className="sectionHead">
        <h2 className="cardTitle">Access &amp; Blast Radius</h2>
        <button type="button" className="primaryBtn" onClick={() => (showGrant ? setShowGrant(false) : openGrant())}>
          Grant capability
        </button>
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}

      {showGrant && (
        <div className="panel">
          <div className="panelHead">
            <h2>Grant capability</h2>
            <button type="button" className="linkBtn" onClick={() => setShowGrant(false)}>
              Close
            </button>
          </div>
          <p className="muted">
            Maps a capability name to a connection + operation for this agent. The agent invokes the
            capability by name; Conduit injects the connection credential at execute time.
          </p>
          <div className="ruleForm">
            <label className="field">
              <span>Capability name</span>
              <input
                type="text"
                list="agent-capability-names"
                value={gCap}
                onChange={(e) => setGCap(e.target.value)}
                placeholder="e.g. github_create_issue"
              />
              <datalist id="agent-capability-names">
                {tools.map((t) => (
                  <option key={t.name} value={t.name} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Connection</span>
              <select value={gConn} onChange={(e) => pickConn(e.target.value)}>
                {connections.length === 0 && <option value="">No connections</option>}
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.platform})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Operation</span>
              <select value={gOp} onChange={(e) => setGOp(e.target.value)}>
                {opsForConnection(gConn).length === 0 && <option value="">No operations</option>}
                {opsForConnection(gConn).map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Constraints (JSON) — pin args, e.g. {'{ "owner": "wwishd-org", "repo": "sample" }'}</span>
            <textarea className="mono" rows={3} value={gConstraints} onChange={(e) => setGConstraints(e.target.value)} />
          </label>
          {grantError && <div className="errorBox">{grantError}</div>}
          <button type="button" className="primaryBtn" disabled={granting} onClick={() => void grant()}>
            {granting ? 'Granting...' : 'Grant capability'}
          </button>
        </div>
      )}

      <div className="statRow">
        <div className="stat">
          <div className="statValue mono">{active.length}</div>
          <div className="statLabel">Active grants</div>
        </div>
        <div className="stat">
          <div className="statValue mono">{reached.length}</div>
          <div className="statLabel">Connections reached</div>
        </div>
        <div className="stat">
          <div className={`statValue mono risk-${radius.level}`}>{radius.total}</div>
          <div className="statLabel">Blast radius ({radius.level})</div>
        </div>
        <div className="stat">
          <div className={`statValue mono ${active.some((g) => g.blocked) ? 'risk-high' : ''}`}>
            {active.filter((g) => g.blocked).length}
          </div>
          <div className="statLabel">Broken wires</div>
        </div>
      </div>

      {loading && <p className="muted">Loading grants...</p>}

      {!loading && (
        <div className="topology cols-2">
          {/* Capabilities (risk colored, revocable) */}
          <div className="topoCol">
            <div className="topoColHead">Capabilities</div>
            {active.length === 0 && <p className="muted">Zero standing access.</p>}
            {active.map((g) => {
              const r = riskOf(g);
              return (
                <div
                  key={g.capability}
                  className={`topoNode capNode risk-border-${r.level}${g.blocked ? ' capBlocked' : ''}`}
                  title={g.blocked ? 'Broken wire: the agent is not authorized to use this connector' : g.operation ?? ''}
                >
                  <span className={`riskDot risk-bg-${r.level}`} />
                  <div className="capNodeBody">
                    <div className="cellName">
                      {g.capability}
                      {g.blocked && <span className="brokenWire" title="Broken wire — blocked at execute">⚠ blocked</span>}
                    </div>
                    <div className="cellId mono">
                      {g.operation ?? '—'} → {connName(g.connection_id)}
                      {g.task_id ? ' · task' : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="linkBtn danger capRevoke"
                    disabled={busyCap === g.capability}
                    title="Revoke this capability (denied on the next call)"
                    onClick={() => void revoke(g.capability)}
                  >
                    {busyCap === g.capability ? '...' : 'Revoke'}
                  </button>
                </div>
              );
            })}

            {/* Revoked capabilities — one-click re-grant restores the same connection/operation/constraints. */}
            {revoked.length > 0 && (
              <>
                <div className="topoColHead revokedHead">Revoked · re-grantable</div>
                {revoked.map((g) => (
                  <div key={g.capability} className="topoNode capNode capRevoked">
                    <span className="riskDot risk-bg-low" style={{ opacity: 0.4 }} />
                    <div className="capNodeBody">
                      <div className="cellName">{g.capability}</div>
                      <div className="cellId mono">
                        {g.operation ?? '—'} → {connName(g.connection_id)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="linkBtn capRevoke"
                      disabled={busyCap === g.capability}
                      title="Re-grant with the same connection, operation, and constraints"
                      onClick={() => void regrant(g)}
                    >
                      {busyCap === g.capability ? '...' : 'Re-grant'}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Connections reached */}
          <div className="topoCol">
            <div className="topoColHead">Connections reached</div>
            {reached.length === 0 && <p className="muted">None.</p>}
            {reached.map((cid) => (
              <div key={cid} className="topoNode connNode">
                <ConnectorAvatar platform={connPlatform(cid)} label={connName(cid)} size={22} />
                <div>
                  <div className="cellName">{connName(cid)}</div>
                  <div className="cellId mono">{connLabel(connPlatform(cid))}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
