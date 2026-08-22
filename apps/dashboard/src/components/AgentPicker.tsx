import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSummary } from '../api/client';
import { ProjectChip } from './ProjectChip';
import { StatusPill } from './StatusPill';

/** Map a lifecycle status to a status-dot color class (mirrors StatusPill's coloring). */
function dotClass(status: string): string {
  if (status === 'active') return 'dot dot-ok';
  if (status === 'pending' || status === 'expired') return 'dot dot-warn';
  if (status === 'revoked' || status === 'rejected') return 'dot dot-danger';
  return 'dot dot-idle';
}

function Chevron(): JSX.Element {
  return (
    <svg className="agentPicker-chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A searchable agent selector — replaces the bare native <select> that dumped raw UUIDs. Shows each agent's
 * name, short id, lifecycle status, and project, with type-to-filter and keyboard navigation. Reusable
 * anywhere an agent must be chosen.
 */
export function AgentPicker({
  agents,
  value,
  onChange,
  allAgentsLabel,
}: {
  agents: AgentSummary[];
  value: string;
  onChange: (id: string) => void;
  /** When set, adds a first "all agents" entry (value ''), e.g. for filters. */
  allAgentsLabel?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = agents.find((a) => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        (a.name ?? '').toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q),
    );
  }, [agents, query]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Focus the search box and reset the highlight when opening.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // defer so the input exists
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  function choose(id: string): void {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[active];
      if (pick) choose(pick.id);
    }
  }

  return (
    <div className="agentPicker" ref={ref}>
      <button
        type="button"
        className="agentPicker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={agents.length === 0}
      >
        {selected ? (
          <>
            <span className={dotClass(selected.status)} />
            <span className="agentPicker-name">{selected.name || 'Unnamed agent'}</span>
            <span className="mono agentPicker-id">{selected.id.slice(0, 8)}</span>
          </>
        ) : allAgentsLabel && !value ? (
          <span className="agentPicker-name">{allAgentsLabel}</span>
        ) : (
          <span className="muted">{agents.length === 0 ? 'No agents' : 'Select an agent'}</span>
        )}
        <Chevron />
      </button>

      {open && (
        <div className="agentPicker-pop" onKeyDown={onKeyDown}>
          <input
            ref={searchRef}
            type="search"
            className="agentPicker-search"
            placeholder="Search by name, id, or status..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <div className="agentPicker-list" role="listbox">
            {allAgentsLabel && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={'agentPicker-opt' + (!value ? ' is-selected' : '')}
                onClick={() => choose('')}
              >
                <span className="dot dot-idle" />
                <span className="agentPicker-opt-main">
                  <span className="agentPicker-opt-name">{allAgentsLabel}</span>
                </span>
              </button>
            )}
            {filtered.length === 0 && <div className="agentPicker-empty muted">No agents match.</div>}
            {filtered.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={a.id === value}
                className={
                  'agentPicker-opt' + (a.id === value ? ' is-selected' : '') + (i === active ? ' is-active' : '')
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(a.id)}
              >
                <span className={dotClass(a.status)} />
                <span className="agentPicker-opt-main">
                  <span className="agentPicker-opt-name">{a.name || 'Unnamed agent'}</span>
                  <span className="mono agentPicker-opt-id">{a.id}</span>
                </span>
                <StatusPill status={a.status} />
                <ProjectChip projectId={a.project_id} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
