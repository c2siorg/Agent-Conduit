import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from './api/queries';
import { AppShell, type NavKey } from './components/AppShell';
import { LoginView } from './views/LoginView';
import { AgentDetailView } from './views/AgentDetailView';
import { AgentsView } from './views/AgentsView';
import { AuditView } from './views/AuditView';
import { ConnectionsView } from './views/ConnectionsView';
import { ComplianceView } from './views/ComplianceView';
import { DashboardView } from './views/DashboardView';
import { GetStartedView } from './views/GetStartedView';
import { PolicyView } from './views/PolicyView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { ToolsView } from './views/ToolsView';
import { WiringView } from './views/WiringView';

const NAV_KEYS: readonly NavKey[] = [
  'getStarted',
  'dashboard',
  'projects',
  'agents',
  'wiring',
  'policy',
  'connections',
  'tools',
  'audit',
  'compliance',
  'settings',
];

/** A resolved route: the active nav section plus an optional agent id for the detail drill-down. */
interface Route {
  key: NavKey;
  agentId?: string;
}

function hasOperatorKey(): boolean {
  try {
    return Boolean(sessionStorage.getItem('conduit.operatorHostKey'));
  } catch {
    return false;
  }
}

/** Read the active route from the URL hash: "#/settings" or the drill-down "#/agents/<id>"; null if unknown. */
function routeFromHash(): Route | null {
  const slug = window.location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = slug.split('/');
  if (head === 'agents' && rest.length > 0 && rest[0]) {
    return { key: 'agents', agentId: rest.join('/') };
  }
  return (NAV_KEYS as readonly string[]).includes(slug) ? { key: slug as NavKey } : null;
}

/**
 * Sidebar nav → view, with hash-based routing so each tab has a URL (#/agents, #/settings, ...) that
 * supports back/forward, refresh, and deep links. Hash routing needs no SPA server fallback. First run
 * (no operator key, no hash) lands on Get Started; otherwise the Dashboard.
 */
export function App(): JSX.Element {
  const session = useSession();
  const queryClient = useQueryClient();
  const [route, setRoute] = useState<Route>(
    () => routeFromHash() ?? { key: hasOperatorKey() ? 'dashboard' : 'getStarted' },
  );

  useEffect(() => {
    // Reflect the initial view in the URL without adding a history entry.
    if (!routeFromHash()) {
      window.history.replaceState(null, '', `#/${route.key}`);
    }
    const onHashChange = (): void => {
      const next = routeFromHash();
      if (next) {
        setRoute(next);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Navigation goes through the URL; the hashchange listener updates the active route.
  const navigate = (key: NavKey): void => {
    window.location.hash = `#/${key}`;
  };
  const openAgent = (id: string): void => {
    window.location.hash = `#/agents/${id}`;
  };

  function render(): JSX.Element {
    if (route.agentId) {
      return <AgentDetailView agentId={route.agentId} onNavigate={navigate} />;
    }
    switch (route.key) {
      case 'getStarted':
        return <GetStartedView onNavigate={navigate} />;
      case 'agents':
        return <AgentsView onNavigate={navigate} onOpenAgent={openAgent} />;
      case 'connections':
        return <ConnectionsView onNavigate={navigate} />;
      case 'settings':
        return <SettingsView />;
      case 'projects':
        return <ProjectsView onNavigate={navigate} />;
      case 'wiring':
        return <WiringView onNavigate={navigate} />;
      case 'policy':
        return <PolicyView onNavigate={navigate} />;
      case 'compliance':
        return <ComplianceView />;
      case 'tools':
        return <ToolsView onNavigate={navigate} />;
      case 'audit':
        return <AuditView />;
      case 'dashboard':
      default:
        return <DashboardView />;
    }
  }

  // Login gate. While the session check is in flight, render nothing (avoids a flash of the app or the
  // login screen). When auth is enabled and the session is not authenticated, show the login screen.
  if (session.isLoading) {
    return <div className="appLoading" />;
  }
  // The session check failed — gateway down or running an old build. Do not fall through to the app.
  if (session.isError) {
    return (
      <div className="loginWrap">
        <div className="loginCard">
          <div className="loginBrand">
            <div className="brand-mark">C</div>
            <div>
              <div className="brand-name">Conduit</div>
              <div className="brand-sub">Infrastructure Gateway</div>
            </div>
          </div>
          <h1 className="loginTitle">Cannot reach the gateway</h1>
          <p className="page-sub">
            The dashboard could not confirm the login state. The gateway may be down, still starting, or
            running an older build without the auth endpoint. If you just enabled login, make sure
            <span className="mono"> CONDUIT_ADMIN_PASSWORD</span> is set and the server was rebuilt.
          </p>
          <button type="button" className="primaryBtn loginBtn" onClick={() => void session.refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  const needsLogin = session.data?.required === true && session.data.authenticated !== true;
  if (needsLogin) {
    return (
      <LoginView
        onSuccess={() => {
          // Refresh the session and any data that was blocked while unauthenticated.
          void queryClient.invalidateQueries();
        }}
      />
    );
  }

  return (
    <AppShell active={route.key} onNavigate={navigate}>
      {render()}
    </AppShell>
  );
}
