import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDashboardApi, type AgentSummary } from '../api/client';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';

const api = createDashboardApi();

/** Edit an agent's operator-facing name/description (host-authorized, signed in the browser). */
export function EditAgentForm({
  agent,
  hostKey,
  onClose,
}: {
  agent: AgentSummary;
  hostKey: string;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState(agent.name ?? '');
  const [description, setDescription] = useState(agent.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (!hostKey.trim()) {
        throw new Error('Set the operator host key first.');
      }
      const hostJwk = parseHostKey(hostKey);
      const issuer = await api.getIssuer();
      const hostJwt = await signHostJwt(hostJwk, issuer);
      await api.updateAgent(hostJwt, agent.id, name.trim(), description.trim());
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panelHead">
        <h2>Edit agent</h2>
        <button type="button" className="linkBtn" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted mono">{agent.id}</p>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. nightly-report-bot"
        />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <div className="errorBox">{error}</div>}
      <button type="button" className="primaryBtn" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );
}
