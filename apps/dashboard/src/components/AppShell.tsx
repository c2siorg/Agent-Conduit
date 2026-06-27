import type { ReactNode } from 'react';
import { useHealth } from '../api/queries';
import { Icon } from './Icon';

export type NavKey = 'getStarted' | 'dashboard' | 'agents' | 'connections' | 'tools' | 'audit' | 'settings';

interface NavItem {
  key: NavKey;
  label: string;
  icon: string;
}

const NAV_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'Operations',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { key: 'agents', label: 'Agent Management', icon: 'agents' },
      { key: 'connections', label: 'Platform Connections', icon: 'connections' },
      { key: 'tools', label: 'Tool & Schema Router', icon: 'tools' },
      { key: 'audit', label: 'Audit Logs', icon: 'audit' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'getStarted', label: 'Get Started', icon: 'getStarted' },
      { key: 'settings', label: 'Settings', icon: 'settings' },
    ],
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
          <div className="crumb">{current ? current.label : ''}</div>
          <div className={ok ? 'sys sys-ok' : 'sys sys-bad'}>
            <span className="dot" />
            {ok ? 'Operational' : 'Degraded'}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
