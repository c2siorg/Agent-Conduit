/**
 * Agent Management / Active Agent Identities — the cryptographic registry table:
 * identifier, status pill, creation date, last activity, per-row actions (Rotate Key, View Logs).
 * Surfaces key-rotation compliance + system latency.
 * @remarks Scaffold.
 */
export function AgentsView(): JSX.Element {
  return (
    <section className="view">
      <h1>Active Agent Identities</h1>
      <p className="muted">Scaffold — the agent registry table (status, last activity, Rotate Key) renders here.</p>
    </section>
  );
}
