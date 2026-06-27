import type { NavKey } from '../components/AppShell';
import { useAgents, useConnections } from '../api/queries';
import { useOperatorKey } from '../lib/useOperatorKey';

interface Step {
  title: string;
  body: JSX.Element;
  done: boolean;
  action?: { label: string; to: NavKey };
}

/**
 * Get Started. A first-run checklist for the AAP flow: bootstrap a host, load the operator key, register
 * an agent, register a connection, then grant + execute a capability. Steps self-check from live data
 * where possible. The dashboard is the AAP Client (§6) running in your browser.
 */
export function GetStartedView({ onNavigate }: { onNavigate: (key: NavKey) => void }): JSX.Element {
  const { loaded } = useOperatorKey();
  const agents = useAgents();
  const connections = useConnections();
  const hasAgents = (agents.data?.length ?? 0) > 0;
  const hasConnections = (connections.data?.length ?? 0) > 0;

  const steps: Step[] = [
    {
      title: 'Bootstrap a host',
      done: false,
      body: (
        <>
          <p className="muted">
            A host is a persistent client identity (Ed25519 keypair). Create one and copy its private JWK:
          </p>
          <pre className="mono keyBlock">docker compose exec conduit node apps/server/dist/scripts/bootstrapHost.js</pre>
        </>
      ),
    },
    {
      title: 'Load your operator host key',
      done: loaded,
      action: { label: 'Open Settings', to: 'settings' },
      body: (
        <p className="muted">
          Paste the <span className="mono">hostPrivateKeyJwk</span> into Settings. It signs host JWTs in
          your browser and is never sent to the server.
        </p>
      ),
    },
    {
      title: 'Register an agent',
      done: hasAgents,
      action: { label: 'Agent Management', to: 'agents' },
      body: (
        <p className="muted">
          Agents are per-session runtime actors under your host, each with their own keypair and
          short-lived JWTs. Registering generates the agent keypair in your browser.
        </p>
      ),
    },
    {
      title: 'Register a connection',
      done: hasConnections,
      action: { label: 'Connection Vault', to: 'connections' },
      body: (
        <p className="muted">
          Store a governed platform credential (Slack, GitHub, REST, ...). It is encrypted at rest
          (AES-256-GCM) and injected server-side only - never returned to agents.
        </p>
      ),
    },
    {
      title: 'Grant a capability, then execute',
      done: false,
      body: (
        <p className="muted">
          Map a capability to a connection + operation with constraints (or have the agent request it and
          approve via device authorization). The agent then calls{' '}
          <span className="mono">POST /capability/execute</span>; every call is constraint-checked and
          audited (args hashed). See <span className="mono">docs/connecting-platforms.md</span>.
        </p>
      ),
    },
  ];

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Get Started</h1>
          <p className="page-sub">
            Stand up an end-to-end flow. Conduit implements the Agent Auth Protocol (AAP); this dashboard
            is the AAP Client running in your browser.
          </p>
        </div>
      </div>

      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.title} className={step.done ? 'step stepDone' : 'step'}>
            <span className="stepNum">{step.done ? '✓' : i + 1}</span>
            <div className="stepBody">
              <h2 className="stepTitle">{step.title}</h2>
              {step.body}
              {step.action && (
                <button type="button" className="linkBtn" onClick={() => onNavigate(step.action!.to)}>
                  {step.action.label} &rarr;
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
