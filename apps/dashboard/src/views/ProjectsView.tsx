import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDashboardApi } from '../api/client';
import { useAgents, useConnections, useProjects } from '../api/queries';
import type { NavKey } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { OperatorKeyNotice } from '../components/OperatorKeyNotice';
import { ProjectChip } from '../components/ProjectChip';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';
import { pushToast } from '../lib/toast';
import { useOperatorKey } from '../lib/useOperatorKey';

const api = createDashboardApi();

/**
 * Projects — governance boundaries for per-project credential isolation. A project-scoped connection can
 * only be used by an agent in the SAME project (enforced server-side at execute). Create/delete here;
 * assign on the agent + connection registration forms.
 */
export function ProjectsView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { key, loaded } = useOperatorKey();
  const queryClient = useQueryClient();
  const { data, isLoading } = useProjects();
  const projects = data ?? [];
  const agents = useAgents().data ?? [];
  const connections = useConnections().data ?? [];

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function hostJwt(): Promise<string> {
    return signHostJwt(parseHostKey(key), await api.getIssuer());
  }

  async function create(): Promise<void> {
    if (!name.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.createProject(await hostJwt(), name.trim(), description.trim());
      setName('');
      setDescription('');
      setShowForm(false);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      pushToast('Project created', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, pname: string): Promise<void> {
    if (!window.confirm(`Delete project "${pname}"? Its agents and connections become unassigned (global).`)) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteProject(await hostJwt(), id);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      pushToast('Project deleted', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const countAgents = (id: string) => agents.filter((a) => a.project_id === id).length;
  const countConns = (id: string) => connections.filter((c) => c.project_id === id).length;
  const globalAgents = agents.filter((a) => a.project_id === null).length;
  const globalConns = connections.filter((c) => c.project_id === null).length;

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Projects</h1>
          <p className="page-sub">
            A governance boundary. A <strong>project-scoped credential</strong> can only be used by agents in the
            same project — cross-project access is blocked at execute.
          </p>
        </div>
        {loaded &&
          (showForm ? (
            <button type="button" className="linkBtn" onClick={() => setShowForm(false)}>
              Close
            </button>
          ) : (
            <button type="button" className="primaryBtn" onClick={() => setShowForm(true)}>
              New Project
            </button>
          ))}
      </div>

      {!loaded && <OperatorKeyNotice onNavigate={onNavigate} />}

      {loaded && showForm && (
        <div className="card card-pad">
          <h2 className="cardTitle">New project</h2>
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. payments-team" autoFocus />
          </label>
          <label className="field">
            <span>Description (optional)</span>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this project isolates" />
          </label>
          <button type="button" className="primaryBtn" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? 'Creating...' : 'Create project'}
          </button>
        </div>
      )}

      {isLoading && <p className="muted">Loading projects...</p>}

      {!isLoading && projects.length === 0 && globalAgents === 0 && globalConns === 0 && !showForm && (
        <EmptyState
          icon="projects"
          title="No projects yet"
          text="Projects isolate credentials: a project-scoped connection is only usable by agents in the same project. Create one, then assign agents and connections to it as you register them."
          action={{ label: 'New project', onClick: () => setShowForm(true) }}
        />
      )}

      {!isLoading && (projects.length > 0 || globalAgents > 0 || globalConns > 0) && (
        <table className="registry">
          <thead>
            <tr>
              <th>Project</th>
              <th>Description</th>
              <th>Agents</th>
              <th>Connections</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <ProjectChip projectId={p.id} />
                  <div className="cellId mono">{p.id}</div>
                </td>
                <td className="cellDesc">{p.description || '-'}</td>
                <td className="mono">{countAgents(p.id)}</td>
                <td className="mono">{countConns(p.id)}</td>
                <td>
                  <button type="button" className="linkBtn danger" disabled={busy} onClick={() => void remove(p.id, p.name)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {/* The implicit "global" bucket for unassigned agents/connections. */}
            {(globalAgents > 0 || globalConns > 0) && (
              <tr>
                <td>
                  <ProjectChip projectId={null} />
                </td>
                <td className="cellDesc muted">Unassigned agents and connections (usable across projects)</td>
                <td className="mono">{globalAgents}</td>
                <td className="mono">{globalConns}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
