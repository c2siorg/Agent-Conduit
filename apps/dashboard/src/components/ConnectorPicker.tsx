import { useMemo, useState } from 'react';
import type { ConnectorInfo } from '../api/client';
import { BRAND_ICONS, readableForeground } from '../lib/brandIcons';

/** Deterministic hue from a platform id, so each connector avatar has a stable accent color. */
function hue(platform: string): number {
  let h = 0;
  for (let i = 0; i < platform.length; i += 1) {
    h = (h * 31 + platform.charCodeAt(i)) % 360;
  }
  return h;
}

/** 1–2 char monogram from a connector label (e.g. "Google Calendar" -> "GC", "Slack" -> "S"). */
function monogram(label: string): string {
  const words = label.replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/);
  const first = words[0] ?? '';
  const second = words[1] ?? '';
  if (first && second) {
    return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
  }
  return (first || '?').slice(0, 2).toUpperCase();
}

/**
 * Connector avatar: the platform's brand icon (Simple Icons) on its brand color when available, otherwise
 * a colored monogram. No network calls — icons are bundled.
 */
export function ConnectorAvatar({ platform, label, size = 34 }: { platform: string; label: string; size?: number }): JSX.Element {
  const brand = BRAND_ICONS[platform];
  if (brand) {
    const fg = readableForeground(brand.hex);
    return (
      <span
        className="connectorAvatar"
        style={{ width: size, height: size, background: `#${brand.hex}`, borderColor: `#${brand.hex}` }}
        aria-hidden
      >
        <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill={fg}>
          <path d={brand.path} />
        </svg>
      </span>
    );
  }
  const h = hue(platform);
  return (
    <span
      className="connectorAvatar"
      style={{
        width: size,
        height: size,
        background: `hsl(${h} 45% 22%)`,
        color: `hsl(${h} 70% 72%)`,
        borderColor: `hsl(${h} 45% 34%)`,
        fontSize: Math.round(size * 0.4),
      }}
      aria-hidden
    >
      {monogram(label)}
    </span>
  );
}

/**
 * A searchable card grid for choosing a connector. Replaces the long platform dropdown — pick a card and
 * the register form is pre-configured from that connector.
 */
export function ConnectorPicker({
  connectors,
  onSelect,
}: {
  connectors: ConnectorInfo[];
  onSelect: (connector: ConnectorInfo) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? connectors.filter((c) => c.label.toLowerCase().includes(term) || c.platform.toLowerCase().includes(term))
      : connectors;
    return [...list].sort((a, b) => a.label.localeCompare(b.label));
  }, [connectors, q]);

  return (
    <div>
      <input
        className="pickerSearch"
        type="search"
        placeholder="Search connectors (Slack, Gmail, GitHub, ...)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="connectorGrid">
        {filtered.map((c) => (
          <button key={c.platform} type="button" className="connectorCard" onClick={() => onSelect(c)}>
            <ConnectorAvatar platform={c.platform} label={c.label} />
            <span className="connectorCardBody">
              <span className="connectorCardName">{c.label}</span>
              <span className="connectorCardMeta">
                {c.auth_methods[0] ?? 'custom'} · {c.operations.length} op{c.operations.length === 1 ? '' : 's'}
              </span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && <p className="muted">No connectors match “{q}”.</p>}
      </div>
    </div>
  );
}
