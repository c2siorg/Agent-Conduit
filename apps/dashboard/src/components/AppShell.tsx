import type { ReactNode } from 'react';

/** Sidebar nav keys → the five operator views (mapped from the proposal mockups). */
export type NavKey = 'dashboard' | 'agents' | 'connections' | 'tools' | 'audit';

const NAV: ReadonlyArray<{ key: NavKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'agents', label: 'Agent Management' },
  { key: 'connections', label: 'Platform Connections' },
  { key: 'tools', label: 'Tool & Schema Router' },
  { key: 'audit', label: 'Audit Logs' },
];

interface AppShellProps {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  children: ReactNode;
}

/**
 * AppShell — persistent left sidebar + content area.
 * Branding: "Conduit · Infrastructure Gateway". Dark, data-dense operator console.
 */
export function AppShell({ active, onNavigate, children }: AppShellProps): JSX.Element {
  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          Conduit <span className="brandSub">· Infrastructure Gateway</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === active ? 'navItem navItemActive' : 'navItem'}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
