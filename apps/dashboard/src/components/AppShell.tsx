import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createDashboardApi } from '../api/client';
import { useHealth, useSession } from '../api/queries';
import { Icon } from './Icon';
import { OperatorKeyMenu } from './OperatorKeyMenu';
import { Toaster } from './Toaster';

const api = createDashboardApi();

export type NavKey =
  | 'getStarted'
  | 'dashboard'
  | 'projects'
  | 'agents'
  | 'wiring'
  | 'policy'
  | 'connections'
  | 'tools'
  | 'audit'
  | 'compliance'
  | 'settings';

interface NavItem {
  key: NavKey;
  label: string;
  icon: string;
}

// Grouped into a few small, plain-language sections so the structure reads at a glance and a newcomer
// can map a task to a section (identities, access, insight) instead of scanning one long list of jargon.
const NAV_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'Start',
    items: [
      { key: 'getStarted', label: 'Get Started', icon: 'getStarted' },
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    ],
  },
  {
    label: 'Identities',
    items: [
      { key: 'agents', label: 'Agents', icon: 'agents' },
      { key: 'projects', label: 'Projects', icon: 'projects' },
    ],
  },
  {
    label: 'Access',
    items: [
      { key: 'connections', label: 'Connections', icon: 'connections' },
      { key: 'wiring', label: 'Access Wiring', icon: 'wiring' },
      { key: 'policy', label: 'Execution Policy', icon: 'policy' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { key: 'tools', label: 'Tools', icon: 'tools' },
      { key: 'audit', label: 'Audit Logs', icon: 'audit' },
      { key: 'compliance', label: 'Compliance', icon: 'compliance' },
    ],
  },
  {
    label: 'System',
    items: [{ key: 'settings', label: 'Settings', icon: 'settings' }],
  },
];

const ALL_ITEMS: ReadonlyArray<NavItem> = NAV_GROUPS.flatMap((g) => g.items);

interface AppShellProps {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  children: ReactNode;
}

/** Persistent sidebar + top bar (with live gateway status) wrapping the active view. */
export function AppShell({ active, onNavigate, children }: AppShellProps): JSX.Element {
  const health = useHealth();
  const ok = health.data?.ready ?? false;
  const current = ALL_ITEMS.find((n) => n.key === active);
  const currentGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.key === active));
  const session = useSession();
  const queryClient = useQueryClient();
  const loggedIn = session.data?.required === true && session.data.authenticated === true;

  const logout = (): void => {
    void api.logout().then(() => queryClient.invalidateQueries());
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">Conduit</div>
            <div className="brand-sub">Infrastructure Gateway</div>
          </div>
        </div>

        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === active ? 'nav-item active' : 'nav-item'}
                  onClick={() => onNavigate(item.key)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className={ok ? 'dot dot-ok' : 'dot dot-danger'} />
          {ok ? 'Gateway operational' : 'Gateway unreachable'}
          <span className="muted">v0.1.0</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <nav className="crumb" aria-label="Breadcrumb">
            {currentGroup && <span className="crumb-group">{currentGroup.label}</span>}
            {currentGroup && <span className="crumb-sep">/</span>}
            <span className="crumb-page">{current ? current.label : ''}</span>
          </nav>
          <div className="topbar-right">
            <OperatorKeyMenu />
            <div className={ok ? 'sys sys-ok' : 'sys sys-bad'}>
              <span className="dot" />
              {ok ? 'Operational' : 'Degraded'}
            </div>
            {loggedIn && (
              <div className="userMenu">
                <span className="userName">
                  <Icon name="agents" size={14} />
                  {session.data?.username}
                </span>
                <button type="button" className="linkBtn" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
