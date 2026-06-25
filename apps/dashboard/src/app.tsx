import { useEffect, useState } from 'react';
import { AppShell, type NavKey } from './components/AppShell';
import { AgentsView } from './views/AgentsView';
import { AuditView } from './views/AuditView';
import { ConnectionsView } from './views/ConnectionsView';
import { DashboardView } from './views/DashboardView';
import { GetStartedView } from './views/GetStartedView';
import { SettingsView } from './views/SettingsView';
import { ToolsView } from './views/ToolsView';

const NAV_KEYS: readonly NavKey[] = [
  'getStarted',
  'dashboard',
  'agents',
  'connections',
  'tools',
  'audit',
  'settings',
];

function hasOperatorKey(): boolean {
  try {
    return Boolean(sessionStorage.getItem('conduit.operatorHostKey'));
  } catch {
    return false;
  }
}

/** Read the active view from the URL hash (e.g. "#/settings"); null if absent/unknown. */
function keyFromHash(): NavKey | null {
  const slug = window.location.hash.replace(/^#\/?/, '');
  return (NAV_KEYS as readonly string[]).includes(slug) ? (slug as NavKey) : null;
}

/**
 * Sidebar nav → view, with hash-based routing so each tab has a URL (#/agents, #/settings, ...) that
 * supports back/forward, refresh, and deep links. Hash routing needs no SPA server fallback. First run
 * (no operator key, no hash) lands on Get Started; otherwise the Dashboard.
 */
export function App(): JSX.Element {
  const [active, setActive] = useState<NavKey>(
    () => keyFromHash() ?? (hasOperatorKey() ? 'dashboard' : 'getStarted'),
  );

  useEffect(() => {
    // Reflect the initial view in the URL without adding a history entry.
    if (!keyFromHash()) {
      window.history.replaceState(null, '', `#/${active}`);
    }
    const onHashChange = (): void => {
      const key = keyFromHash();
      if (key) {
        setActive(key);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigation goes through the URL; the hashchange listener updates the active view.
  const navigate = (key: NavKey): void => {
    if (key === active) {
      return;
    }
    window.location.hash = `#/${key}`;
  };

  function render(): JSX.Element {
    switch (active) {
      case 'getStarted':
        return <GetStartedView onNavigate={navigate} />;
      case 'agents':
        return <AgentsView onNavigate={navigate} />;
      case 'connections':
        return <ConnectionsView onNavigate={navigate} />;
      case 'settings':
        return <SettingsView />;
      case 'tools':
        return <ToolsView />;
      case 'audit':
        return <AuditView />;
      case 'dashboard':
      default:
        return <DashboardView />;
    }
  }

  return (
    <AppShell active={active} onNavigate={navigate}>
      {render()}
    </AppShell>
  );
}
