'use client';

import { useEffect, useState } from 'react';
import type { AuthState, SettingsResponse } from '@lumpy/shared';
import { api, type ModuleInfo } from '@/lib/api';

const MODES: { value: 'off' | 'investigate' | 'auto'; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Alerts only notify — no sessions are started.' },
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

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
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
  }, []);

  const patch = async (p: { remediationMode?: string; remediationAutoSeverities?: string[] }) => {
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

      <Section title="Notifications">
        {!settings ? (
          <Loading />
        ) : settings.system.notifications.configured ? (
          <dl className="space-y-1 text-sm">
            <Row label="Status" value="enabled" />
            <Row label="Topic" value={settings.system.notifications.topic ?? '—'} mono />
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
            <Row label="Public URL" value={settings.system.publicUrl ?? '—'} mono />
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
          <p className="text-xs text-neutral-500">@{auth.user.login} · GitHub</p>
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
