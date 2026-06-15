'use client';

import { useEffect, useState } from 'react';
import type { McpServerDef, SessionConnectorsView } from '@lumpy/shared';
import { api } from '@/lib/api';

interface Preset {
  key: string;
  label: string;
  name: string;
  def: McpServerDef;
  /** Env var the preset needs a secret value for, if any. */
  envKey: string | null;
  note?: string;
}

const PRESETS: Preset[] = [
  {
    key: 'supabase',
    label: 'Supabase',
    name: 'supabase',
    def: {
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase@latest', '--read-only'],
      env: { SUPABASE_ACCESS_TOKEN: '${SUPABASE_ACCESS_TOKEN}' },
    },
    envKey: 'SUPABASE_ACCESS_TOKEN',
    note: 'read-only; prompts for a project ref so it is scoped to one project',
  },
  {
    key: 'github',
    label: 'GitHub',
    name: 'github',
    def: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    },
    envKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
  },
  {
    key: 'vercel',
    label: 'Vercel',
    name: 'vercel',
    def: { type: 'http', url: 'https://mcp.vercel.com' },
    envKey: null,
    note: 'hosted MCP; authorizes via OAuth on first use',
  },
  {
    key: 'postgres',
    label: 'Postgres',
    name: 'postgres',
    def: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'] },
    envKey: 'DATABASE_URL',
  },
  {
    key: 'filesystem',
    label: 'Filesystem',
    name: 'filesystem',
    def: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    envKey: null,
    note: 'exposes the project directory',
  },
  {
    key: 'tensorgarden',
    label: 'TensorGarden',
    name: 'tensorgarden',
    def: {
      type: 'http',
      url: 'https://tensorgarden.ai/api/mcp',
      headers: { Authorization: 'Bearer ${TENSORGARDEN_API_KEY}' },
    },
    envKey: 'TENSORGARDEN_API_KEY',
    note: 'portal MCP - create an API key (tg_live_…) in the TensorGarden portal',
  },
];

function describe(def: McpServerDef): string {
  if (def.type === 'http' || def.url) return `http · ${def.url ?? ''}`;
  return [def.command, ...(def.args ?? [])].join(' ');
}

export function ConnectorsDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<SessionConnectorsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable working state.
  const [repo, setRepo] = useState('');
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerDef>>({});
  const [setEnv, setSetEnv] = useState<Record<string, string>>({}); // new/updated values
  const [removeEnv, setRemoveEnv] = useState<string[]>([]); // existing keys to drop
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  // Custom connector form.
  const [showCustom, setShowCustom] = useState(false);
  const [cName, setCName] = useState('');
  const [cType, setCType] = useState<'http' | 'stdio'>('http');
  const [cUrl, setCUrl] = useState('');
  const [cAuth, setCAuth] = useState(''); // bearer token or full header value
  const [cCmd, setCCmd] = useState('');

  // Esc closes the dialog (a11y / expected modal behavior).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    api
      .getConnectors(sessionId)
      .then((v) => {
        setView(v);
        setRepo(v.repo ?? '');
        setMcpServers(v.mcpServers);
      })
      .catch((e) => setError(String(e)));
  }, [sessionId]);

  const existingKeys = (view?.envKeys ?? []).filter((k) => !removeEnv.includes(k));

  const addPreset = (preset: Preset) => {
    let def = preset.def;
    // A Supabase connector MUST be pinned to one project ref, or the account
    // token gives it access to every Supabase project on the account. Project
    // sessions get a scoped server automatically; a session-level one must ask.
    if (preset.key === 'supabase') {
      const ref = window
        .prompt(
          'Supabase project ref to scope this connector to (the <ref> in https://<ref>.supabase.co). Required so it cannot reach your whole account.',
        )
        ?.trim();
      if (!ref) {
        setError('Supabase connector needs a project ref to be safely scoped - not added.');
        return;
      }
      def = { ...preset.def, args: [...(preset.def.args ?? []), `--project-ref=${ref}`] };
    }
    setMcpServers((prev) => ({ ...prev, [preset.name]: def }));
    if (preset.envKey && !existingKeys.includes(preset.envKey) && !(preset.envKey in setEnv)) {
      setSetEnv((prev) => ({ ...prev, [preset.envKey as string]: '' }));
    }
  };

  const removeServer = (name: string) => {
    setMcpServers((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const addCustom = () => {
    const name = cName.trim();
    if (!name) return;
    let def: McpServerDef;
    if (cType === 'http') {
      if (!cUrl.trim()) return;
      def = { type: 'http', url: cUrl.trim() };
      if (cAuth.trim()) {
        // Store the secret as an env var and reference it from the header.
        const key = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOKEN`;
        def.headers = { Authorization: `Bearer \${${key}}` };
        setSetEnv((prev) => ({ ...prev, [key]: cAuth.trim() }));
      }
    } else {
      if (!cCmd.trim()) return;
      const [command, ...args] = cCmd.trim().split(/\s+/);
      def = { command, args };
    }
    setMcpServers((prev) => ({ ...prev, [name]: def }));
    setShowCustom(false);
    setCName('');
    setCUrl('');
    setCAuth('');
    setCCmd('');
  };

  const addEnv = () => {
    const key = newKey.trim();
    if (!key) return;
    setSetEnv((prev) => ({ ...prev, [key]: newVal }));
    setRemoveEnv((prev) => prev.filter((k) => k !== key));
    setNewKey('');
    setNewVal('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateConnectors(sessionId, {
        setEnv: Object.keys(setEnv).length ? setEnv : undefined,
        removeEnv: removeEnv.length ? removeEnv : undefined,
        mcpServers,
        repo: repo.trim() || null,
      });
      setView(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connectors"
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg surface p-5"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-100">Connectors</h2>
          <button onClick={onClose} className="text-sm text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-neutral-500">
          Where this project pulls and pushes data. MCP servers are written to the workspace&apos;s{' '}
          <code className="text-neutral-400">.mcp.json</code>; secrets are encrypted and injected at
          launch. Restart the session to apply changes.
        </p>

        {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
        {!view ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                GitHub repo
              </h3>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="github.com/you/project (optional metadata)"
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              />
            </section>

            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                MCP servers (plugins)
              </h3>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => addPreset(p)}
                    title={p.note}
                    className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    + {p.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustom((s) => !s)}
                  className={`rounded border px-2.5 py-1 text-xs ${
                    showCustom
                      ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                      : 'border-dashed border-neutral-600 text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  + Custom
                </button>
              </div>

              {showCustom && (
                <div className="mb-2 space-y-2 rounded-xl border border-glass bg-white/55 p-3">
                  <div className="flex gap-2">
                    <input
                      value={cName}
                      onChange={(e) => setCName(e.target.value)}
                      placeholder="name (e.g. my-portal)"
                      className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                    />
                    <select
                      value={cType}
                      onChange={(e) => setCType(e.target.value as 'http' | 'stdio')}
                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
                    >
                      <option value="http">HTTP / API</option>
                      <option value="stdio">Local (stdio)</option>
                    </select>
                  </div>
                  {cType === 'http' ? (
                    <>
                      <input
                        value={cUrl}
                        onChange={(e) => setCUrl(e.target.value)}
                        placeholder="https://your-portal.com/api/mcp"
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                      />
                      <input
                        value={cAuth}
                        onChange={(e) => setCAuth(e.target.value)}
                        type="password"
                        placeholder="Bearer token (optional - stored encrypted)"
                        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                      />
                    </>
                  ) : (
                    <input
                      value={cCmd}
                      onChange={(e) => setCCmd(e.target.value)}
                      placeholder="command, e.g. npx -y @scope/mcp-server"
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                    />
                  )}
                  <button
                    onClick={addCustom}
                    className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                  >
                    Add connector
                  </button>
                </div>
              )}
              {Object.keys(mcpServers).length === 0 ? (
                <p className="text-xs text-neutral-600">None yet - add one above.</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(mcpServers).map(([name, def]) => (
                    <li
                      key={name}
                      className="flex items-center justify-between gap-2 rounded-xl border border-glass bg-white/55 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-neutral-100">{name}</div>
                        <div className="truncate font-mono text-xs text-neutral-500">
                          {describe(def)}
                        </div>
                      </div>
                      <button
                        onClick={() => removeServer(name)}
                        className="shrink-0 text-xs text-neutral-500 hover:text-red-700"
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Environment / secrets
              </h3>
              <ul className="space-y-1.5">
                {existingKeys.map((key) => (
                  <li key={key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono text-neutral-200">{key}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-neutral-600">••••••••</span>
                      <button
                        onClick={() => setRemoveEnv((prev) => [...prev, key])}
                        className="text-xs text-neutral-500 hover:text-red-700"
                      >
                        remove
                      </button>
                    </span>
                  </li>
                ))}
                {Object.entries(setEnv).map(([key, val]) => (
                  <li key={key} className="flex items-center gap-2">
                    <span className="w-1/2 truncate font-mono text-sm text-neutral-200">{key}</span>
                    <input
                      value={val}
                      onChange={(e) => setSetEnv((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder="value"
                      type="password"
                      className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
                    />
                    <button
                      onClick={() =>
                        setSetEnv((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        })
                      }
                      className="text-xs text-neutral-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                  placeholder="KEY"
                  className="w-1/2 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
                <input
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                  placeholder="value"
                  type="password"
                  className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                />
                <button
                  onClick={addEnv}
                  className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  add
                </button>
              </div>
            </section>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !view}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
