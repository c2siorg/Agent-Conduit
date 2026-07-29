import { useAgents, useConnections, useHealth } from '../api/queries';
import { ConnectorAvatar } from '../components/ConnectorPicker';
import { SecurityFeed } from '../components/SecurityFeed';

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function Health({ name, state, ok }: { name: string; state: string; ok?: boolean }): JSX.Element {
  const dot = ok === true ? 'dot dot-ok' : ok === false ? 'dot dot-danger' : 'dot dot-idle';
  return (
    <div className="health">
      <span className={dot} />
      <span className="health-name">{name}</span>
      <span className="health-state">{state}</span>
    </div>
  );
}

/**
 * Dashboard / System Observability. Live identity + connection totals, connection health derived from the
 * last credential test, and a real-time security event feed (SSE).
 */
export function DashboardView(): JSX.Element {
  const agents = useAgents().data ?? [];
  const connections = useConnections().data ?? [];
  const health = useHealth();
  const dbOk = health.data?.ready ?? false;
  const active = agents.filter((a) => a.status === 'active').length;
  const revoked = agents.filter((a) => a.status === 'revoked').length;
  const failingConns = connections.filter((c) => c.last_test_ok === false).length;

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>System Observability</h1>
          <p className="page-sub">Live identity, connection, and security telemetry for the gateway.</p>
        </div>
      </div>

      <div className="metrics">
        <Metric label="Active Agents" value={String(active)} sub={`${agents.length} total identities`} />
        <Metric label="Revoked" value={String(revoked)} sub="lifetime" />
        <Metric label="Connections" value={String(connections.length)} sub={failingConns ? `${failingConns} failing` : 'all healthy'} />
        <Metric label="Database" value={dbOk ? 'Healthy' : 'Down'} sub="primary store" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="card-title">Connection Health</span>
          </div>
          <div className="health-grid">
            <Health name="Database (Postgres)" ok={dbOk} state={dbOk ? 'connected' : 'unreachable'} />
            {connections.slice(0, 6).map((c) => (
              <div className="health" key={c.id}>
                <ConnectorAvatar platform={c.platform} label={c.name} size={18} />
                <span className="health-name">{c.name}</span>
                <span className="health-state">
                  {c.last_test_ok === null ? 'untested' : c.last_test_ok ? 'healthy' : 'failing'}
                </span>
              </div>
            ))}
            {connections.length === 0 && <p className="muted">No connections registered.</p>}
          </div>
        </div>

        <SecurityFeed />
      </div>
    </section>
  );
}
