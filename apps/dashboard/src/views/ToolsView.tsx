import { EmptyState } from '../components/EmptyState';

export function ToolsView(): JSX.Element {
  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Tool &amp; Schema Router</h1>
          <p className="page-sub">On-demand, identity-scoped tool schemas from MCP, OpenAPI, and CLI sources.</p>
        </div>
      </div>
      <div className="card">
        <EmptyState
          icon="tools"
          title="No tools registered"
          text="Registered tools, their adapter type, and token-cost telemetry appear here once the Token Router ships."
          badge="Sprint 4"
        />
      </div>
    </section>
  );
}
