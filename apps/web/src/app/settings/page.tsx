'use client';

import { useEffect, useState } from 'react';
import type { AuthState, Playbook, SettingsResponse } from '@lumpy/shared';
import { api, type ModuleInfo } from '@/lib/api';

const MODES: { value: 'off' | 'investigate' | 'auto'; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Alerts only notify - no sessions are started.' },
  {
    value: 'investigate',
    label: 'Investigate',
    hint: 'Spin up Claude to diagnose and report. No changes.',
  },
  {
    value: 'auto',
    label: 'Auto',
    hint: 'Claude investigates and fixes safe, non-destructive issues.',
  },
];

const SEVERITIES = ['warning', 'critical'];

const GATE_MODES: { value: 'off' | 'advisory' | 'enforce'; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No second opinion. Autonomous actions run as configured.' },
  {
    value: 'advisory',
    label: 'Advisory',
    hint: 'Codex reviews and records its opinion, but never blocks an action.',
  },
  {
    value: 'enforce',
    label: 'Enforce',
    hint: 'If Codex rejects an auto-action, hold it for your one-tap approval instead of running it.',
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
    api
      .authMe()
      .then(setAuth)
      .catch(() => setAuth(null));
    api
      .listModules()
      .then(setModules)
      .catch(() => {});
    api
      .listPlaybooks()
      .then(setPlaybooks)
      .catch(() => {});
  }, []);

  const patch = async (p: {
    remediationMode?: string;
    remediationAutoSeverities?: string[];
    secondOpinionMode?: string;
    supabaseToken?: string;
    vercelToken?: string;
    githubToken?: string;
    openaiToken?: string;
  }) => {
    try {
      setSettings(await api.updateSettings(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed');
    }
  };

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-4">
      <h1 className="mb-4 text-lg font-semibold text-neutral-100">Settings</h1>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <Section title="Account">
        <AccountSettings
          auth={auth}
          onSignedOut={() => setAuth((a) => (a ? { ...a, user: null } : a))}
        />
      </Section>

      <Section
        title="Integrations"
        hint="Account-level credentials shared across projects (scoped to each project at launch)."
      >
        {!settings ? (
          <Loading />
        ) : (
          <div className="space-y-5">
            <TokenSetting
              label="Supabase Personal Access Token"
              placeholder="sbp_…"
              help="Covers all your Supabase projects; each Lumpy project scopes to its own DB via its URL. Create one at supabase.com/dashboard/account/tokens."
              configured={settings.integrations.supabaseConfigured}
              onSave={(token) => patch({ supabaseToken: token })}
            />
            <TokenSetting
              label="Vercel Access Token"
              placeholder="vercel token…"
              help="Lets Lumpy sessions read and manage your Vercel deployments. Create one at vercel.com/account/tokens."
              configured={settings.integrations.vercelConfigured}
              onSave={(token) => patch({ vercelToken: token })}
            />
            <TokenSetting
              label="GitHub Token"
              placeholder="github_pat_… or ghp_…"
              help="Covers all your repos. Lets the box push/pull and powers Repo Sync (backs the box's repos up to GitHub). Create a fine-grained PAT (Contents: read/write) at github.com/settings/tokens."
              configured={settings.integrations.githubConfigured}
              onSave={(token) => patch({ githubToken: token })}
            />
            <TokenSetting
              label="OpenAI API Key"
              placeholder="sk-…"
              help="Powers Codex second-opinion consults (a read-only cross-model check on autonomous actions). Create one at platform.openai.com/api-keys."
              configured={settings.integrations.codexConfigured}
              onSave={(token) => patch({ openaiToken: token })}
            />
          </div>
        )}
      </Section>

      <Section
        title="Second opinion (Codex)"
        hint="A read-only, cross-model check before Lumpy acts on its own. Codex reviews each auto-remediation; on a reject it's held for your one-tap approval instead of running unattended."
      >
        {!settings ? (
          <Loading />
        ) : (
          <SecondOpinion settings={settings} onMode={(mode) => patch({ secondOpinionMode: mode })} />
        )}
      </Section>

      <Section title="Remediation" hint="What Lumpy does automatically when an alert fires.">
        {!settings ? (
          <Loading />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {MODES.map((m) => (
                <label key={m.value} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={settings.remediation.mode === m.value}
                    onChange={() => void patch({ remediationMode: m.value })}
                    className="mt-1"
                  />
                  <span className="text-sm text-neutral-200">
                    {m.label}
                    <span className="mt-0.5 block text-xs text-neutral-500">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {settings.remediation.mode !== 'off' && (
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-400">
                  Auto-remediate these severities (others require one-tap approval):
                </p>
                <div className="flex gap-4">
                  {SEVERITIES.map((sev) => {
                    const on = settings.remediation.autoSeverities.includes(sev);
                    return (
                      <label
                        key={sev}
                        className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            void patch({
                              remediationAutoSeverities: on
                                ? settings.remediation.autoSeverities.filter((s) => s !== sev)
                                : [...settings.remediation.autoSeverities, sev],
                            })
                          }
                        />
                        {sev}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Playbooks"
        hint="Vetted instructions Lumpy uses to remediate specific alerts."
      >
        {playbooks.length === 0 ? (
          <Loading />
        ) : (
          <ul className="space-y-2">
            {playbooks.map((p) => (
              <li key={p.id} className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-100">{p.name}</span>
                  <span className="font-mono text-xs text-neutral-500">{p.ruleIds.join(', ')}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{p.description}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notifications">
        {!settings ? (
          <Loading />
        ) : settings.system.notifications.configured ? (
          <dl className="space-y-1 text-sm">
            <Row label="Status" value="enabled" />
            <Row label="Topic" value={settings.system.notifications.topic ?? '-'} mono />
            <Row label="Server" value={settings.system.notifications.server} mono />
          </dl>
        ) : (
          <p className="text-sm text-neutral-500">
            Not configured. Set <code className="text-neutral-400">LUMPY_NTFY_TOPIC</code> on the
            orchestrator to enable phone push.
          </p>
        )}
      </Section>

      <Section title="System">
        {!settings ? (
          <Loading />
        ) : (
          <dl className="space-y-1 text-sm">
            <Row label="Version" value={settings.system.version} />
            <Row
              label="Session user"
              value={settings.system.sessionUser ?? 'orchestrator user'}
              mono
            />
            <Row label="Workspace root" value={settings.system.workspaceRoot} mono />
            <Row label="Default command" value={settings.system.defaultCommand} mono />
            <Row label="Public URL" value={settings.system.publicUrl ?? '-'} mono />
          </dl>
        )}
        {modules.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-neutral-400">Modules</p>
            <div className="flex flex-wrap gap-1.5">
              {modules.map((m) => (
                <span
                  key={m.id}
                  title={m.description}
                  className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300"
                >
                  {m.id} <span className="text-neutral-600">v{m.version}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="text-sm font-medium text-neutral-100">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`truncate text-neutral-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function Loading() {
  return <p className="text-sm text-neutral-500">Loading…</p>;
}

function TokenSetting({
  label,
  placeholder,
  help,
  configured,
  onSave,
}: {
  label: string;
  placeholder: string;
  help: string;
  configured: boolean;
  onSave: (token: string) => void;
}) {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-neutral-300">{label}</p>
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={configured ? '•••••••• (stored)' : placeholder}
          className="input flex-1"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          onClick={() => {
            onSave(token.trim());
            setToken('');
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
          disabled={!token.trim()}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        {configured ? 'Stored (encrypted). Enter a new one to replace it. ' : 'Not set. '}
        {help}
      </p>
    </div>
  );
}

function SecondOpinion({
  settings,
  onMode,
}: {
  settings: SettingsResponse;
  onMode: (mode: 'off' | 'advisory' | 'enforce') => void;
}) {
  const { codexConfigured } = settings.integrations;
  const { mode, cliInstalled } = settings.secondOpinion;
  const status =
    mode === 'off'
      ? { tone: 'text-neutral-500', text: 'Disabled.' }
      : !codexConfigured
        ? {
            tone: 'text-amber-400',
            text: 'Add an OpenAI API key above to activate. Until then, actions run without a second opinion.',
          }
        : !cliInstalled
          ? {
              tone: 'text-amber-400',
              text: 'Key stored, but the Codex CLI was not detected on the host. Consults are skipped (fail open).',
            }
          : { tone: 'text-emerald-400', text: 'Active. Codex reviews autonomous actions read-only.' };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {GATE_MODES.map((m) => (
          <label key={m.value} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="secondOpinion"
              checked={mode === m.value}
              onChange={() => void onMode(m.value)}
              className="mt-1"
            />
            <span className="text-sm text-neutral-200">
              {m.label}
              <span className="mt-0.5 block text-xs text-neutral-500">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className={`text-xs ${status.tone}`}>{status.text}</p>
    </div>
  );
}

function AccountSettings({
  auth,
  onSignedOut,
}: {
  auth: AuthState | null;
  onSignedOut: () => void;
}) {
  if (!auth) return <Loading />;
  if (auth.user) {
    return (
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={auth.user.avatarUrl}
          alt={auth.user.login}
          className="h-10 w-10 rounded-full border border-neutral-700"
        />
        <div className="min-w-0">
          <p className="text-sm text-neutral-100">{auth.user.name ?? auth.user.login}</p>
          <p className="text-xs text-neutral-500">
            @{auth.user.login} · GitHub ·{' '}
            <span className={auth.user.role === 'admin' ? 'text-emerald-400' : 'text-amber-400'}>
              {auth.user.role}
            </span>
          </p>
        </div>
        <button
          onClick={() => void api.authLogout().then(onSignedOut)}
          className="ml-auto rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Sign out
        </button>
      </div>
    );
  }
  if (auth.configured) {
    return (
      <a
        href={api.authLoginUrl()}
        className="inline-block rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        Sign in with GitHub
      </a>
    );
  }
  return (
    <p className="text-sm text-neutral-500">
      GitHub sign-in is not configured. Set{' '}
      <code className="text-neutral-400">LUMPY_GITHUB_CLIENT_ID</code> /{' '}
      <code className="text-neutral-400">LUMPY_GITHUB_CLIENT_SECRET</code> on the orchestrator.
    </p>
  );
}
