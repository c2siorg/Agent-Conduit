import { useState } from 'react';
import { AppShell, type NavKey } from './components/AppShell';
import { AgentsView } from './views/AgentsView';
import { AuditView } from './views/AuditView';
import { ConnectionsView } from './views/ConnectionsView';
import { DashboardView } from './views/DashboardView';
import { ToolsView } from './views/ToolsView';

/** Sidebar nav → view. Lightweight in-app switch (no router dependency for the scaffold). */
const VIEWS: Record<NavKey, () => JSX.Element> = {
  dashboard: DashboardView,
  agents: AgentsView,
  connections: ConnectionsView,
  tools: ToolsView,
  audit: AuditView,
};

export function App(): JSX.Element {
  const [active, setActive] = useState<NavKey>('dashboard');
  const View = VIEWS[active];
  return (
    <AppShell active={active} onNavigate={setActive}>
      <View />
    </AppShell>
  );
}
