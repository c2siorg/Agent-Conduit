import { useMetrics, useTools } from '../api/queries';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'not cached';
}

/**
 * Tool & Schema Router. Registered tools, their adapter type, schema-cache status, and per-tool token-cost
 * telemetry from the router. Schemas themselves are identity-scoped and never listed here.
 */
export function ToolsView(): JSX.Element {
  const { data, isLoading, error } = useTools();
  const metrics = useMetrics();
  const tools = data ?? [];
  const tokens = metrics.data?.tokensByTool ?? {};

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Tool &amp; Schema Router</h1>
          <p className="page-sub">On-demand, identity-scoped tool schemas from MCP, OpenAPI, and CLI sources.</p>
        </div>
      </div>

      {isLoading && <p className="muted">Loading tools...</p>}
      {error && <p className="muted">Failed to load tools (is the gateway running?).</p>}

      {!isLoading && !error && (
        <table className="registry">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Adapter</th>
              <th>Schema cache</th>
              <th>Requests</th>
              <th>Avg tokens</th>
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
                </tr>
              );
            })}
            {tools.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No tools registered yet. Register one with POST /tools (host-authorized).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
