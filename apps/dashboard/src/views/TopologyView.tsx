import { useEffect, useState } from 'react';
import { createDashboardApi, type AgentGrant } from '../api/client';
import { useAgents, useConnections, useConnectors } from '../api/queries';
import { ConnectorAvatar } from '../components/ConnectorPicker';
import { blastRadius, grantRisk } from '../lib/risk';

const api = createDashboardApi();

/**
 * Topology / blast radius. Pick an agent to see what it can reach — its active capability grants (risk
 * colored) mapped to the connections and platforms they invoke — and its overall blast-radius score.
 * Makes least-privilege (and its violations) visible.
 */
export function TopologyView(): JSX.Element {
  const agents = useAgents().data ?? [];
  const connections = useConnections().data ?? [];
  const connectors = useConnectors().data ?? [];
  const [agentId, setAgentId] = useState('');
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [loading, setLoading] = useState(false);

  // Default to the first active agent.
  useEffect(() => {
    if (!agentId && agents.length > 0) {
      setAgentId(agents.find((a) => a.status === 'active')?.id ?? agents[0]!.id);
    }
  }, [agents, agentId]);

  useEffect(() => {
    if (!agentId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api
      .listAgentGrants(agentId)
      .then((g) => !cancelled && setGrants(g))
      .catch(() => !cancelled && setGrants([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const connName = (id: string | null): string => connections.find((c) => c.id === id)?.name ?? (id ? id.slice(0, 8) : 'unmapped');
  const connPlatform = (id: string | null): string => connections.find((c) => c.id === id)?.platform ?? 'rest';
  const connLabel = (platform: string): string => connectors.find((c) => c.platform === platform)?.label ?? platform;

  const active = grants.filter((g) => g.status === 'active');
  // Prefer the server-computed risk when present; fall back to the local heuristic.
  const riskOf = (g: AgentGrant) => (g.risk ? { level: g.risk, score: g.risk === 'high' ? 3 : g.risk === 'med' ? 2 : 1 } : grantRisk(g.operation, g.capability));
  const radius = blastRadius(active.map((g) => riskOf(g).score));
  const agent = agents.find((a) => a.id === agentId);

  // Unique connections this agent reaches.
  const reached = Array.from(new Set(active.map((g) => g.connection_id).filter((x): x is string => Boolean(x))));

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Topology &amp; Blast Radius</h1>
          <p className="page-sub">What an agent can reach — capability grants mapped to connections, weighted by risk.</p>
        </div>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id}
            </option>
          ))}
        </select>
      </div>

      {agents.length === 0 && <p className="muted">No agents registered.</p>}

      {agent && (
        <>
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
            <div className="topology">
              {/* Column 1: the agent */}
              <div className="topoCol">
                <div className="topoColHead">Agent</div>
                <div className="topoNode agentNode">
                  <div className="cellName">{agent.name || 'Unnamed agent'}</div>
                  <div className="cellId">{agent.id}</div>
                </div>
              </div>

              {/* Column 2: capabilities (risk colored) */}
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
                      <div>
                        <div className="cellName">
                          {g.capability}
                          {g.blocked && <span className="brokenWire" title="Broken wire — blocked at execute">⚠ blocked</span>}
                        </div>
                        <div className="cellId mono">{g.operation ?? '—'}{g.task_id ? ' · task' : ''}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Column 3: connections + platforms */}
              <div className="topoCol">
                <div className="topoColHead">Connections</div>
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
      )}
    </section>
  );
}
