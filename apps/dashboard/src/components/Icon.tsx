// Minimal monochrome stroke icons (inline SVG, currentColor).
const PATHS: Record<string, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  agents: <path d="M12 3l7 2.5v5.2c0 4.2-2.9 7.2-7 8.3-4.1-1.1-7-4.1-7-8.3V5.5L12 3z" />,
  connections: (
    <>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="12" r="2.6" />
      <line x1="8.6" y1="12" x2="15.4" y2="12" />
    </>
  ),
  tools: (
    <>
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <line x1="8.1" y1="10.8" x2="15.9" y2="7.2" />
      <line x1="8.1" y1="13.2" x2="15.9" y2="16.8" />
    </>
  ),
  audit: (
    <>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.1" />
      <circle cx="4.5" cy="12" r="1.1" />
      <circle cx="4.5" cy="18" r="1.1" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="8" r="3.6" />
      <line x1="10.6" y1="10.6" x2="20" y2="20" />
      <line x1="17" y1="20" x2="20" y2="17" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </>
  ),
  topology: (
    <>
      <circle cx="5" cy="12" r="2.4" />
      <circle cx="19" cy="6" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <line x1="7.2" y1="11" x2="16.8" y2="7" />
      <line x1="7.2" y1="13" x2="16.8" y2="17" />
    </>
  ),
  projects: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  wiring: (
    <>
      <rect x="3" y="9" width="5" height="6" rx="1" />
      <rect x="16" y="4" width="5" height="5" rx="1" />
      <rect x="16" y="15" width="5" height="5" rx="1" />
      <path d="M8 12h4M12 12V6.5h4M12 12v5.5h4" />
    </>
  ),
  policy: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </>
  ),
  compliance: (
    <>
      <path d="M12 3l7 2.5v5.2c0 4.2-2.9 7.2-7 8.3-4.1-1.1-7-4.1-7-8.3V5.5L12 3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  getStarted: (
    <>
      <path d="M5 19c0-6 3.5-12 9.5-12 0 0 2 0 3.5.5.5 1.5.5 3.5.5 3.5C18 17 12 19 5 19z" />
      <circle cx="14" cy="9.5" r="1.4" />
      <path d="M5 19l2.5-2.5" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
