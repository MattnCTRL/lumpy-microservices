'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse, Session } from '@lumpy/shared';
import { Terminal } from '@/components/Terminal';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

export default function Page() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
      setError(null);
      setSelectedId((current) => current ?? list.find((s) => s.status === 'running')?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'orchestrator unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <Header health={health} onNew={() => setCreating(true)} />

      {error && (
        <div className="bg-red-950/60 px-4 py-2 text-sm text-red-300">
          {error} — is the orchestrator running on {ORCHESTRATOR_URL}?
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-neutral-800 p-3 md:w-80 md:border-b-0 md:border-r">
          <SessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onStop={async (id) => {
              await api.stopSession(id);
              void refresh();
            }}
          />
        </aside>

        <main className="min-h-0 flex-1 p-3">
          {selected ? (
            <SessionPanel session={selected} />
          ) : (
            <EmptyState onNew={() => setCreating(true)} />
          )}
        </main>
      </div>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(session) => {
            setCreating(false);
            setSelectedId(session.id);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function Header({ health, onNew }: { health: HealthResponse | null; onNew: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Lumpy</h1>
        <span className="text-xs text-neutral-500">Micro Services</span>
      </div>
      <div className="flex items-center gap-4">
        <HealthBadge health={health} />
        <button
          onClick={onNew}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          New session
        </button>
      </div>
    </header>
  );
}

function HealthBadge({ health }: { health: HealthResponse | null }) {
  if (!health) return <span className="text-xs text-red-400">offline</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${health.tmux ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {health.tmux ? 'tmux ready' : 'tmux missing'} · v{health.version}
    </span>
  );
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
  onStop,
}: {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStop: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return <p className="px-1 py-2 text-sm text-neutral-500">No sessions yet.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            onClick={() => onSelect(session.id)}
            className={`w-full rounded-md border px-3 py-2 text-left transition ${
              session.id === selectedId
                ? 'border-neutral-600 bg-neutral-900'
                : 'border-transparent hover:bg-neutral-900/60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate text-sm font-medium text-neutral-100">{session.name}</span>
              <StatusDot status={session.status} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-neutral-500">{session.command}</span>
              {session.status === 'running' && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStop(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.stopPropagation();
                      onStop(session.id);
                    }
                  }}
                  className="shrink-0 text-xs text-neutral-500 hover:text-red-400"
                >
                  stop
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusDot({ status }: { status: Session['status'] }) {
  return (
    <span
      title={status}
      className={`h-2 w-2 shrink-0 rounded-full ${
        status === 'running' ? 'bg-emerald-500' : 'bg-neutral-600'
      }`}
    />
  );
}

function SessionPanel({ session }: { session: Session }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-neutral-100">{session.name}</h2>
          <p className="truncate text-xs text-neutral-500">{session.workspace}</p>
        </div>
        <StatusDot status={session.status} />
      </div>
      <div className="min-h-0 flex-1 p-2">
        {session.status === 'running' ? (
          <Terminal key={session.id} sessionId={session.id} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Session stopped.
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-neutral-500">
      <p className="text-sm">Select a session, or start a new one.</p>
      <button
        onClick={onNew}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
      >
        New session
      </button>
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (session: Session) => void;
}) {
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [command, setCommand] = useState('claude');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.createSession({
        name: name.trim(),
        workspace: workspace.trim() || undefined,
        command: command.trim() || undefined,
      });
      onCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create session');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-950 p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-neutral-100">New session</h2>
        <div className="space-y-3">
          <Field label="Name">
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api refactor"
              className="input"
            />
          </Field>
          <Field label="Workspace" hint="absolute or relative to the workspace root">
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="~/dev/lumpy"
              className="input"
            />
          </Field>
          <Field label="Command">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="claude"
              className="input"
            />
          </Field>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Start session'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-600">{hint}</span>}
    </label>
  );
}
