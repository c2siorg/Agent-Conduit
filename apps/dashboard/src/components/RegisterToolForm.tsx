import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDashboardApi, type AdapterType, type ToolSummary } from '../api/client';
import { useTools } from '../api/queries';
import { parseHostKey, signHostJwt } from '../lib/agentCrypto';

const api = createDashboardApi();

/** A correct starter config per adapter type — the shape each adapter expects (see packages/adapters). */
const TEMPLATES: Record<AdapterType, string> = {
  mcp: JSON.stringify(
    {
      tool: {
        name: 'get_weather',
        description: 'Look up the current weather for a city.',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: ['city'],
        },
      },
    },
    null,
    2,
  ),
  openapi: JSON.stringify(
    {
      operation: {
        operationId: 'createIssue',
        summary: 'Create an issue.',
        parameters: [{ name: 'title', required: true, schema: { type: 'string' } }],
      },
    },
    null,
    2,
  ),
  cli: JSON.stringify(
    {
      command: 'gh issue create',
      description: 'Open a GitHub issue.',
      options: [{ name: 'title', type: 'string', required: true, description: 'Issue title' }],
    },
    null,
    2,
  ),
};

const ADAPTERS: ReadonlyArray<{ type: AdapterType; label: string; hint: string }> = [
  { type: 'mcp', label: 'MCP', hint: 'A Model Context Protocol tool (has an inputSchema).' },
  { type: 'openapi', label: 'OpenAPI', hint: 'One operation from an OpenAPI spec (parameters + body).' },
  { type: 'cli', label: 'CLI', hint: 'A command-line tool described by its options/flags.' },
];

/**
 * Register or edit a tool with the Token Router from the dashboard. Signs a host JWT in the browser
 * (operator key) and POSTs to /tools (an upsert). The adapter config is the shape the chosen adapter
 * expects; a template is prefilled for new tools. In edit mode the name is fixed (it is the key).
 */
export function RegisterToolForm({
  hostKey,
  onClose,
  initial,
}: {
  hostKey: string;
  onClose: () => void;
  /** When present, the form edits this existing tool instead of creating a new one. */
  initial?: ToolSummary;
}): JSX.Element {
  const editing = Boolean(initial);
  const queryClient = useQueryClient();
  const existingTools = useTools().data ?? [];
  const [name, setName] = useState(initial?.name ?? '');
  const [adapterType, setAdapterType] = useState<AdapterType>((initial?.adapter_type as AdapterType) ?? 'mcp');
  const [config, setConfig] = useState(
    initial ? JSON.stringify(initial.adapter_config, null, 2) : TEMPLATES.mcp,
  );
  // Track whether the operator edited the config, so switching adapter type can safely swap the template.
  const [configDirty, setConfigDirty] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickAdapter(type: AdapterType): void {
    setAdapterType(type);
    if (!configDirty) {
      setConfig(TEMPLATES[type]);
    }
  }

  /** Clone an existing tool's adapter + config into the form (a new name is still required). */
  function cloneFrom(toolName: string): void {
    const t = existingTools.find((x) => x.name === toolName);
    if (!t) return;
    setAdapterType(t.adapter_type as AdapterType);
    setConfig(JSON.stringify(t.adapter_config, null, 2));
    setConfigDirty(true);
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError('Tool name is required.');
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(config) as Record<string, unknown>;
    } catch {
      setError('Adapter config must be valid JSON.');
      return;
    }
    if (!hostKey.trim()) {
      setError('Set the operator host key first.');
      return;
    }
    setBusy(true);
    try {
      const issuer = await api.getIssuer();
      const hostJwt = await signHostJwt(parseHostKey(hostKey), issuer);
      await api.registerTool(hostJwt, { name: name.trim(), adapterType, adapterConfig: parsed });
      await queryClient.refetchQueries({ queryKey: ['tools'] }); // reflect immediately in the list
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const activeHint = ADAPTERS.find((a) => a.type === adapterType)?.hint;

  return (
    <div className="panel">
      <div className="panelHead">
        <h2>{editing ? `Edit tool` : 'Register tool'}</h2>
        <button type="button" className="linkBtn" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="muted">
        {editing
          ? 'Update this tool’s adapter or config. Saving clears its cached schema so the next fetch rebuilds it.'
          : 'Registers a tool with the Token Router. Its schema is served to agents on demand and only if they have a matching grant — the schema itself is never listed here.'}
      </p>

      {!editing && existingTools.length > 0 && (
        <label className="field">
          <span>Start from an existing tool (optional) — clones its adapter + config</span>
          <select defaultValue="" onChange={(e) => cloneFrom(e.target.value)}>
            <option value="">Blank (use a template)</option>
            {existingTools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.adapter_type})
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>Tool name{editing && ' (fixed)'}</span>
        <input
          type="text"
          value={name}
          disabled={editing}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. get_weather"
        />
      </label>

      <label className="field">
        <span>Adapter</span>
        <div className="seg">
          {ADAPTERS.map((a) => (
            <button
              key={a.type}
              type="button"
              className={a.type === adapterType ? 'segBtn on' : 'segBtn'}
              onClick={() => pickAdapter(a.type)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {activeHint && <span className="fieldHelp muted">{activeHint}</span>}
      </label>

      <label className="field">
        <span>Adapter config (JSON)</span>
        <textarea
          className="mono"
          rows={12}
          value={config}
          spellCheck={false}
          onChange={(e) => {
            setConfig(e.target.value);
            setConfigDirty(true);
          }}
        />
      </label>

      {error && <div className="errorBox">{error}</div>}
      <button type="button" className="primaryBtn" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Saving...' : editing ? 'Save changes' : 'Register tool'}
      </button>
    </div>
  );
}
