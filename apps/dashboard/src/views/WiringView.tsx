import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createDashboardApi, type AgentConnection } from '../api/client';
import { useAgentConnections, useAgents, useConnections, useConnectors } from '../api/queries';
import { AgentPicker } from '../components/AgentPicker';
import type { NavKey } from '../components/AppShell';
import { ConnectorAvatar } from '../components/ConnectorPicker';
import { EmptyState } from '../components/EmptyState';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { pushToast } from '../lib/toast';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();
const ROW_H = 76; // attached-card row height incl. gap (must match CSS)

/**
 * Agent Access Wiring — authorize connectors for an agent by dragging them onto it (or, for keyboard/touch,
 * pressing Enter / tapping "Authorize"). Each wire is a connector the agent may use; per wire you can
 * restrict operations and set a rate limit. Backed by `POST`/`DELETE /agents/:id/connections`.
 */
export function WiringView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { key, loaded } = useOperatorKey();
  const queryClient = useQueryClient();
  const agents = useAgents().data ?? [];
  const connections = useConnections().data ?? [];
  const connectors = useConnectors().data ?? [];

  const [agentId, setAgentId] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agentId && agents.length > 0) {
      setAgentId(agents.find((a) => a.status === 'active')?.id ?? agents[0]!.id);
    }
  }, [agents, agentId]);

  const attached = useAgentConnections(agentId).data ?? [];
  const attachedIds = new Set(attached.map((c) => c.connection_id));
  const available = connections.filter((c) => !attachedIds.has(c.id));
  // The operations a connector-restriction may choose from = the CONNECTION's own allow-list if it has one
  // (the server validates against exactly this), otherwise the driver's concrete operations. Offering the
  // full driver set would let "Restrict" request an operation the connection forbids -> 400.
  const opsFor = (connectionId: string, platform: string): Array<{ name: string; description: string }> => {
    const driverOps = connectors.find((k) => k.platform === platform)?.operations ?? [];
    const connAllow = connections.find((c) => c.id === connectionId)?.allowed_operations ?? [];
    if (connAllow.length > 0) {
      return connAllow.map((name) => driverOps.find((o) => o.name === name) ?? { name, description: '' });
    }
    return driverOps;
  };
  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  async function hostJwt(): Promise<string> {
    return signHostJwt(parseHostKey(key), await api.getIssuer());
  }
  async function refresh(): Promise<void> {
    // refetch (not just invalidate) so the attached list + palette update immediately after a change.
    await queryClient.refetchQueries({ queryKey: ['agentConnections', agentId] });
  }

  async function attach(connectionId: string, patch: { allowedOperations?: string[]; rateLimit?: number | null } | undefined, successMsg: string): Promise<void> {
    if (!loaded) {
      pushToast('Set your operator host key first (Settings).', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.attachConnection(await hostJwt(), agentId, { connectionId, ...patch });
      await refresh();
      pushToast(successMsg, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function detach(connectionId: string): Promise<void> {
    setBusy(true);
    try {
      await api.detachConnection(await hostJwt(), agentId, connectionId);
      await refresh();
      pushToast(`Detached ${nameOf(connectionId)}`, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const agent = agents.find((a) => a.id === agentId);
  const canvasH = Math.max(attached.length * ROW_H, 140);

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Agent Access Wiring</h1>
          <p className="page-sub">Drag a connector onto the agent — or press Enter / tap Authorize — to grant it access.</p>
        </div>
        <AgentPicker agents={agents} value={agentId} onChange={setAgentId} />
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}
      {agents.length === 0 && (
        <EmptyState
          icon="agents"
          title="No agents to wire yet"
          text="Access wiring authorizes connectors for an agent. Register an agent first, then come back to grant it access."
          action={{ label: 'Register an agent', onClick: () => onNavigate('agents') }}
        />
      )}

      {agent && (
        <div
          className={dragOver ? 'wiring wiringDrag' : 'wiring'}
          aria-label="Authorized connectors for the agent. Drop a connector here to authorize it."
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const id = e.dataTransfer.getData('text/plain');
            if (id && !attachedIds.has(id)) {
              void attach(id, undefined, `Authorized ${nameOf(id)}`);
            }
          }}
          style={{ minHeight: canvasH }}
        >
          {/* Column 1 — the agent node */}
          <div className="wireAgentCol">
            <div className="wireAgentNode">
              <span className="wireAgentBadge">AGENT</span>
              <div className="cellName">{agent.name || 'Unnamed agent'}</div>
              <div className="cellId">{agent.id}</div>
              <div className="muted">{attached.length ? `${attached.length} authorized connector(s)` : 'no connectors — drop or authorize one'}</div>
            </div>
          </div>

          {/* Column 2 — SVG wires */}
          <svg className="wireSvg" viewBox={`0 0 140 ${canvasH}`} preserveAspectRatio="none" width="140" height={canvasH} aria-hidden>
            {attached.map((c, i) => {
              const y = i * ROW_H + ROW_H / 2;
              const cy = canvasH / 2;
              return (
                <g key={c.connection_id}>
                  <path d={`M 0 ${cy} C 70 ${cy} 70 ${y} 140 ${y}`} className="wirePath" />
                  <circle cx="0" cy={cy} r="3" className="wireDot" />
                  <circle cx="140" cy={y} r="3" className="wireDot" />
                </g>
              );
            })}
          </svg>

          {/* Column 3 — attached connectors */}
          <div className="wireConnCol">
            {attached.length === 0 && <div className="wireDropHint">Drop a connector here →</div>}
            {attached.map((c) => (
              <AttachedCard
                key={c.connection_id}
                conn={c}
                busy={busy}
                operations={opsFor(c.connection_id, c.platform)}
                // Pass BOTH fields every time — the grant upsert replaces both columns, so we preserve the
                // one that isn't changing (otherwise editing ops would wipe the rate limit and vice-versa).
                onOps={(ops) => attach(c.connection_id, { allowedOperations: ops, rateLimit: c.rate_limit }, ops.length ? 'Operations restricted' : 'All operations allowed')}
                onRate={(r) => attach(c.connection_id, { allowedOperations: c.allowed_operations, rateLimit: r }, r === null ? 'Rate limit removed' : `Rate limit set to ${r}/min`)}
                onDetach={() => detach(c.connection_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Palette — available connectors: draggable AND keyboard/tap accessible */}
      {agent && (
        <div className="card card-pad wirePalette">
          <h2 className="cardTitle">Available connectors</h2>
          <p className="muted">Drag onto the agent, or focus a card and press Enter / tap Authorize.</p>
          {available.length === 0 ? (
            <p className="muted">All connections are already authorized for this agent.</p>
          ) : (
            <div className="paletteGrid">
              {available.map((c) => (
                <div
                  key={c.id}
                  className="paletteCard"
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={`Authorize ${c.name} for this agent`}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void attach(c.id, undefined, `Authorized ${c.name}`);
                    }
                  }}
                >
                  <ConnectorAvatar platform={c.platform} label={c.name} size={26} />
                  <span className="cellName">{c.name}</span>
                  <button
                    type="button"
                    className="linkBtn paletteAttach"
                    disabled={busy}
                    onClick={() => void attach(c.id, undefined, `Authorized ${c.name}`)}
                  >
                    Authorize
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AttachedCard({
  conn,
  busy,
  operations,
  onOps,
  onRate,
  onDetach,
}: {
  conn: AgentConnection;
  busy: boolean;
  operations: Array<{ name: string; description: string }>;
  onOps: (ops: string[]) => void;
  onRate: (rate: number | null) => void;
  onDetach: () => void;
}): JSX.Element {
  const [rate, setRate] = useState(conn.rate_limit ?? '');
  useEffect(() => setRate(conn.rate_limit ?? ''), [conn.rate_limit]);

  // Only connectors with concrete operations can be restricted (generic REST ops are free-form).
  const concreteOps = operations.filter((o) => !o.name.includes('<'));
  const restricted = conn.allowed_operations.length > 0;
  const allowed = new Set(conn.allowed_operations);

  function toggleOp(name: string): void {
    const next = new Set(allowed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onOps([...next]); // empty -> the parent messages "all operations allowed" and the backend treats it as all
  }

  return (
    <div className="wireConnCard">
      <div className="wireConnHead">
        <ConnectorAvatar platform={conn.platform} label={conn.name} size={22} />
        <span className="cellName">{conn.name}</span>
        <button type="button" className="linkBtn danger wireDetach" title="Detach" aria-label={`Detach ${conn.name}`} disabled={busy} onClick={onDetach}>
          ✕
        </button>
      </div>
      <div className="wireConnBody">
        {concreteOps.length > 0 ? (
          <div className="opsControl">
            <div className="seg" role="group" aria-label="Operation scope">
              <button type="button" className={!restricted ? 'segBtn on' : 'segBtn'} disabled={busy} onClick={() => onOps([])}>
                All operations
              </button>
              <button
                type="button"
                className={restricted ? 'segBtn on' : 'segBtn'}
                disabled={busy}
                onClick={() => onOps(concreteOps.map((o) => o.name))}
              >
                Restrict
              </button>
            </div>
            {restricted && (
              <div className="opChips">
                {concreteOps.map((op) => (
                  <button
                    key={op.name}
                    type="button"
                    className={allowed.has(op.name) ? 'opChip on' : 'opChip'}
                    title={op.description}
                    disabled={busy}
                    onClick={() => toggleOp(op.name)}
                  >
                    {op.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="muted">all operations</span>
        )}
        <label className="wireRate">
          <span className="muted">rate/min</span>
          <input
            type="number"
            min={0}
            value={rate}
            placeholder="∞"
            aria-label={`Rate limit per minute for ${conn.name}`}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => {
              const next = rate === '' ? null : Math.max(0, Number(rate) || 0);
              if (next !== conn.rate_limit) {
                onRate(next);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
