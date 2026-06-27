import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDashboardApi } from '../api/client';
import { ed25519Supported, generateAgentKeyPair, parseHostKey, signHostJwt, type Ed25519Jwk } from '../lib/agentCrypto';

const api = createDashboardApi();

/**
 * Register an agent from the dashboard, acting as the AAP Client in the browser: the operator host key
 * (held by the view) signs a host JWT locally, an agent keypair is generated locally, and only the agent
 * PUBLIC key + signed JWT (plus the operator-supplied name/description) are sent to the gateway. The new
 * agent private key is shown once to save.
 */
export function RegisterAgentForm({ hostKey, onClose }: { hostKey: string; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('delegated');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ agentId: string; privateKey: Ed25519Jwk } | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (!(await ed25519Supported())) {
        throw new Error('This browser does not support Ed25519 signing. Use `npm run demo` or the CLI.');
      }
      if (!hostKey.trim()) {
        throw new Error('Enter the operator host key above first.');
      }
      const hostJwk = parseHostKey(hostKey);

      const issuer = await api.getIssuer();
      const agent = await generateAgentKeyPair();
      const hostJwt = await signHostJwt(hostJwk, issuer);
      const res = await api.registerAgent(hostJwt, {
        agentPublicKey: agent.publicKeyJwk,
        mode,
        name: name.trim(),
        description: description.trim(),
      });
      setResult({ agentId: res.agent_id, privateKey: agent.privateKeyJwk });
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panelHead">
        <h2>Register Agent</h2>
        <button type="button" className="linkBtn" onClick={onClose}>
          Close
        </button>
      </div>

      {!result && (
        <>
          <p className="muted">
            Generates an agent keypair and signs a host JWT in your browser using the operator host key
            above. The server only receives the agent public key plus the name/description.
          </p>
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
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does (for operator visibility)."
            />
          </label>
          <label className="field">
            <span>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="delegated">delegated</option>
              <option value="autonomous">autonomous</option>
            </select>
          </label>
          {error && <div className="errorBox">{error}</div>}
          <button type="button" className="primaryBtn" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Registering...' : 'Register Agent'}
          </button>
        </>
      )}

      {result && (
        <div className="resultBox">
          <p>
            Registered agent <span className="mono">{result.agentId}</span> (active).
          </p>
          <p className="muted">
            Save the agent private key now - it is shown once and never sent to the server.
          </p>
          <pre className="mono keyBlock">{JSON.stringify(result.privateKey, null, 2)}</pre>
          <button type="button" className="primaryBtn" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
