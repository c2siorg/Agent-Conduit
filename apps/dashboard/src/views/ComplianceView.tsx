import { useCompliance } from '../api/queries';
import type { ComplianceControl } from '../api/client';

function StatusChip({ status }: { status: ComplianceControl['status'] }): JSX.Element {
  const label = status === 'met' ? 'Met' : status === 'partial' ? 'Partial' : 'Gap';
  return <span className={`ctrlChip ctrl-${status}`}>{label}</span>;
}

/**
 * Compliance posture. Maps Conduit's live enforcement to a control catalog (Agentic Trust Controls /
 * OWASP agentic / ISO 42001 flavored). Some controls reflect runtime settings, so the posture tracks the
 * running gateway rather than a static claim.
 */
export function ComplianceView(): JSX.Element {
  const { data, isLoading, error } = useCompliance();

  return (
    <section className="view">
      <div className="viewHead">
        <div>
          <h1>Compliance Posture</h1>
          <p className="page-sub">Control coverage mapped to what the gateway actually enforces.</p>
        </div>
      </div>

      {isLoading && <p className="muted">Loading posture...</p>}
      {error && <p className="muted">Failed to load compliance (is the gateway running?).</p>}

      {data && (
        <>
          <div className="statRow">
            <div className="stat">
              <div className="statValue mono ctrl-met-fg">{data.summary.met}</div>
              <div className="statLabel">Met</div>
            </div>
            <div className="stat">
              <div className="statValue mono ctrl-partial-fg">{data.summary.partial}</div>
              <div className="statLabel">Partial</div>
            </div>
            <div className="stat">
              <div className="statValue mono ctrl-gap-fg">{data.summary.gap}</div>
              <div className="statLabel">Gap</div>
            </div>
            <div className="stat">
              <div className="statValue mono">{Math.round((data.summary.met / Math.max(1, data.summary.total)) * 100)}%</div>
              <div className="statLabel">Fully met</div>
            </div>
          </div>

          {data.domains.map((d) => (
            <div key={d.domain} className="card card-pad complianceDomain">
              <h2 className="cardTitle">{d.domain}</h2>
              <table className="registry">
                <tbody>
                  {d.controls.map((c) => (
                    <tr key={c.id}>
                      <td className="mono cellId" style={{ width: 60 }}>{c.id}</td>
                      <td style={{ width: 220 }} className="cellName">{c.title}</td>
                      <td style={{ width: 90 }}><StatusChip status={c.status} /></td>
                      <td className="cellDesc">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
