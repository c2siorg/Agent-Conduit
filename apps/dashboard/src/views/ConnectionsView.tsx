/**
 * Platform Connections / Connection Vault — per-platform cards: status, agent count,
 * encrypted-vault status, "Manage Credentials" / "Re-authenticate".
 * Credential VALUES are never displayed (they never leave the server).
 * @remarks Scaffold.
 */
export function ConnectionsView(): JSX.Element {
  return (
    <section className="view">
      <h1>Connection Vault</h1>
      <p className="muted">Scaffold — connection cards (status, agent count, encrypted-vault state) render here.</p>
    </section>
  );
}
