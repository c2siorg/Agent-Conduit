/**
 * Sparkline — compact latency/usage chart for the metrics tiles.
 * @remarks Scaffold — wire a lightweight charting lib (e.g. uPlot) against `data`.
 */
export function Sparkline({ data }: { data: number[] }): JSX.Element {
  return (
    <span className="sparkline" data-points={data.length} aria-hidden>
      
    </span>
  );
}
