import { useAgents, useHealth } from '../api/queries';
import { EmptyState } from '../components/EmptyState';

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
 * Dashboard / System Observability. Shows live data where it exists (agent totals from the registry,
 * database health from /readyz) and clearly-labeled placeholders for pillars that are not wired yet.
 */
export function DashboardView(): JSX.Element {
  const agents = useAgents().data ?? [];
  const health = useHealth();
  const dbOk = health.data?.ready ?? false;
  const active = agents.filter((a) => a.status === 'active').length;
  const revoked = agents.filter((a) => a.status === 'revoked').length;

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>System Observability</h1>
          <p className="page-sub">Live identity, connection, and audit telemetry for the gateway.</p>
        </div>
      </div>

      <div className="metrics">
        <Metric label="Active Agents" value={String(active)} sub={`${agents.length} total identities`} />
        <Metric label="Revoked" value={String(revoked)} sub="lifetime" />
        <Metric label="Connections" value="0" sub="connection registry - Sprint 3" />
        <Metric label="Database" value={dbOk ? 'Healthy' : 'Down'} sub="primary store" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="card-title">Platform Health</span>
          </div>
          <div className="health-grid">
            <Health name="Database (Postgres)" ok={dbOk} state={dbOk ? 'connected' : 'unreachable'} />
            <Health name="Slack" state="not configured" />
            <Health name="GitHub" state="not configured" />
            <Health name="Google Workspace" state="not configured" />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Live Audit Stream</span>
          </div>
          <EmptyState
            icon="audit"
            title="No events yet"
            text="Per-agent audit events stream here once the Observability pillar ships."
            badge="Sprint 4"
          />
        </div>
      </div>
    </section>
  );
}
