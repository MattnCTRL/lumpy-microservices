'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LumpyEvent, Session, SessionActivity } from '@lumpy/shared';
import { ConnectorsDialog } from '@/components/ConnectorsDialog';
import { Field } from '@/components/Field';
import { Terminal } from '@/components/Terminal';
import { api, eventsSocketUrl, ORCHESTRATOR_URL } from '@/lib/api';
import { reconnectingSocket } from '@/lib/socket';
import { SkeletonRows } from '@/components/Skeleton';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Auto-select a session only on first load. Re-selecting on every refresh
  // would fight the user: on mobile, tapping "Back" sets null and the next
  // refresh would snap them right back into the session they just left.
  const didAutoSelect = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listSessions();
      setSessions(list);
      setError(null);
      if (!didAutoSelect.current) {
        didAutoSelect.current = true;
        setSelectedId((current) => current ?? list.find((s) => s.status === 'running')?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'orchestrator unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Live updates from the orchestrator event spine (auto-reconnecting).
  useEffect(() => {
    const handle = reconnectingSocket(eventsSocketUrl(), (data) => {
      const message = JSON.parse(data) as LumpyEvent;
      if (message.type === 'session.activity') {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === message.id
              ? { ...s, activity: message.activity, prompt: message.prompt }
              : s,
          ),
        );
      } else if (message.type === 'session.status') {
        setSessions((prev) =>
          prev.map((s) => (s.id === message.id ? { ...s, status: message.status } : s)),
        );
        if (message.status === 'stopped') void refresh();
      }
    });
    return () => handle.close();
  }, [refresh]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="bg-red-100 px-4 py-2 text-sm text-red-700">
          {error} - is the orchestrator running on {ORCHESTRATOR_URL}?
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={`w-full shrink-0 overflow-y-auto border-neutral-800 p-3 md:block md:w-80 md:border-r ${
            selected ? 'hidden' : 'block'
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Sessions</h2>
            <button
              onClick={() => setCreating(true)}
              className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
            >
              New
            </button>
          </div>
          {loading && sessions.length === 0 ? (
            <SkeletonRows rows={4} />
          ) : (
          <SessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onStop={async (id) => {
              await api.stopSession(id);
              void refresh();
            }}
            onDelete={async (id) => {
              if (!confirm('Delete this session? This removes it permanently.')) return;
              await api.deleteSession(id);
              setSelectedId((current) => (current === id ? null : current));
              void refresh();
            }}
          />
          )}
        </aside>

        <main className={`min-h-0 flex-1 p-3 ${selected ? 'block' : 'hidden md:block'}`}>
          {selected ? (
            <SessionPanel
              session={selected}
              onBack={() => setSelectedId(null)}
              onChanged={() => void refresh()}
              onDeleted={() => {
                setSelectedId(null);
                void refresh();
              }}
            />
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

function SessionList({
  sessions,
  selectedId,
  onSelect,
  onStop,
  onDelete,
}: {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return <p className="px-1 py-2 text-sm text-neutral-500">No sessions yet.</p>;
  }
  // Pin the locked Conductor to the top.
  const ordered = [...sessions].sort((a, b) => Number(b.locked) - Number(a.locked));
  return (
    <ul className="space-y-1.5">
      {ordered.map((session) => (
        <li key={session.id}>
          <button
            onClick={() => onSelect(session.id)}
            className={`w-full rounded-md border px-3 py-2 text-left transition ${
              session.locked
                ? 'border-indigo-300/60 bg-indigo-100'
                : session.status === 'running' && session.activity === 'awaiting_permission'
                  ? 'border-amber-600/70 bg-amber-100'
                  : session.id === selectedId
                    ? 'border-neutral-600 bg-neutral-900'
                    : 'border-transparent hover:bg-neutral-900/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-neutral-100">
                {session.locked && <span title="Locked master orchestrator">👑</span>}
                {session.name}
              </span>
              <ActivityBadge session={session} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-neutral-500">{session.command}</span>
              {session.locked ? (
                <span className="shrink-0 text-xs text-indigo-700">conductor</span>
              ) : (
                <RowAction
                  label={session.status === 'running' ? 'stop' : 'delete'}
                  onAction={() =>
                    session.status === 'running' ? onStop(session.id) : onDelete(session.id)
                  }
                />
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

const ACTIVITY_STYLE: Record<SessionActivity, { dot: string; label: string }> = {
  working: { dot: 'bg-blue-500 animate-pulse', label: 'working' },
  awaiting_permission: { dot: 'bg-amber-500 animate-pulse', label: 'needs you' },
  idle: { dot: 'bg-emerald-500', label: 'idle' },
  unknown: { dot: 'bg-neutral-600', label: '' },
};

function ActivityBadge({ session }: { session: Session }) {
  if (session.status === 'stopped') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
        <span className="h-2 w-2 rounded-full bg-neutral-600" />
        stopped
      </span>
    );
  }
  const style = ACTIVITY_STYLE[session.activity];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function RowAction({ label, onAction }: { label: string; onAction: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onAction();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          onAction();
        }
      }}
      className="shrink-0 text-xs text-neutral-500 hover:text-red-700"
    >
      {label}
    </span>
  );
}

function isClaudeCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === 'claude' || trimmed.startsWith('claude ');
}

function SessionPanel({
  session,
  onBack,
  onChanged,
  onDeleted,
}: {
  session: Session;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [showConnectors, setShowConnectors] = useState(false);
  return (
    <div className="flex h-full flex-col surface">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            className="shrink-0 rounded px-1.5 py-0.5 text-sm text-neutral-400 hover:bg-neutral-800 md:hidden"
            aria-label="Back to sessions"
          >
            ←
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-neutral-100">{session.name}</h2>
            <p className="truncate text-xs text-neutral-500">{session.workspace}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConnectors(true)}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
            title="Connectors (data sources, secrets, MCP servers)"
          >
            🔌 Connectors
          </button>
          <ActivityBadge session={session} />
        </div>
      </div>
      {showConnectors && (
        <ConnectorsDialog sessionId={session.id} onClose={() => setShowConnectors(false)} />
      )}
      {session.status === 'running' && session.activity === 'awaiting_permission' && (
        <PromptBanner sessionId={session.id} prompt={session.prompt} />
      )}
      <div className="min-h-0 flex-1 p-2">
        {session.status === 'running' ? (
          <Terminal key={session.id} sessionId={session.id} />
        ) : (
          <StoppedActions session={session} onChanged={onChanged} onDeleted={onDeleted} />
        )}
      </div>
      {session.status === 'running' && <InputBar sessionId={session.id} />}
    </div>
  );
}

function StoppedActions({
  session,
  onChanged,
  onDeleted,
}: {
  session: Session;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const canResume = isClaudeCommand(session.command);

  const run = async (label: string, action: () => Promise<unknown>, after: () => void) => {
    setBusy(label);
    try {
      await action();
      after();
    } catch (error) {
      setBusy(null);
      throw error; // surface a failed restart/resume/delete via the global toast
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm text-neutral-500">Session stopped.</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canResume && (
          <button
            disabled={busy !== null}
            onClick={() => run('resume', () => api.resumeSession(session.id), onChanged)}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {busy === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
        )}
        <button
          disabled={busy !== null}
          onClick={() => run('restart', () => api.restartSession(session.id), onChanged)}
          className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${
            canResume
              ? 'border border-neutral-700 text-neutral-200 hover:bg-neutral-900'
              : 'bg-neutral-100 font-medium text-neutral-900 hover:bg-white'
          }`}
        >
          {busy === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => {
            if (confirm('Delete this session? This removes it permanently.')) {
              void run('delete', () => api.deleteSession(session.id), onDeleted);
            }
          }}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:text-red-700 disabled:opacity-50"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      {canResume && (
        <p className="max-w-xs text-xs text-neutral-600">
          Resume continues the previous conversation. Restart starts fresh but first reviews{' '}
          <code className="text-neutral-500">.lumpy/PROGRESS.md</code> to build on prior work.
        </p>
      )}
    </div>
  );
}

// Surfaces the question a session is asking, pulled from its terminal stream,
// so you can answer with a tap instead of reading raw TTY output.
function PromptBanner({
  sessionId,
  prompt,
}: {
  sessionId: string;
  prompt: Session['prompt'];
}) {
  const options =
    prompt?.options && prompt.options.length > 0
      ? prompt.options
      : [
          { key: 'y', label: 'Yes' },
          { key: 'n', label: 'No' },
        ];
  return (
    <div className="border-b border-amber-300/40 bg-amber-100 px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs font-medium text-amber-700">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        Claude is asking
      </div>
      <p className="mt-1 text-sm text-neutral-100">
        {prompt?.question ?? 'This session needs your input.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            onClick={() => void api.sendInput(sessionId, option.key)}
            className="rounded-md border border-amber-300/60 bg-amber-100 px-3 py-1 text-sm text-amber-700 hover:bg-amber-100"
          >
            <span className="font-mono text-amber-700">{option.key}</span> {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Terminal control keys, clearly labelled - for navigating menus and
// interrupting, the things a typed message can't express. Menu *answers*
// (1/2/3, yes/no) are surfaced contextually by the PromptBanner instead.
const TERMINAL_KEYS: { label: string; data: string; title: string }[] = [
  { label: '↵ Enter', data: '\r', title: 'Submit / confirm the current line' },
  { label: '↑', data: '\x1b[A', title: 'Up - move through a menu or history' },
  { label: '↓', data: '\x1b[B', title: 'Down - move through a menu' },
  { label: 'Esc', data: '\x1b', title: 'Cancel / dismiss' },
  { label: '⌃C Stop', data: '\x03', title: 'Interrupt the running task' },
];

/**
 * The session composer. Typing a message and pressing Send clears whatever is
 * on the session's input line, types your message, and submits it - so it
 * behaves like a chat box wired to the live session, regardless of any text
 * Claude has pre-filled. The labelled key row handles menu navigation; the
 * PromptBanner handles menu answers.
 */
function InputBar({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('');
  const [compose, setCompose] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    const value = text;
    if (!value.trim()) return;
    setText('');
    try {
      // Clear any pre-filled input, type the message, then submit it.
      await api.sendInput(sessionId, '\x15');
      await api.sendInput(sessionId, value);
      await new Promise((r) => setTimeout(r, 80));
      await api.sendInput(sessionId, '\r');
      setSent(true);
      setTimeout(() => setSent(false), 1200);
    } catch (error) {
      setText(value); // restore so a failed send doesn't drop the operator's message
      throw error; // surface via the global toast
    }
  };

  const inputClass =
    'min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none';

  return (
    <div className="space-y-1.5 border-t border-neutral-800 px-2 py-2">
      <div className="flex items-end gap-1.5">
        {compose ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={4}
            placeholder="Compose a multi-line message or paste a block… (⌘/Ctrl+Enter to send)"
            className={`${inputClass} resize-y`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        ) : (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message this session, then Enter…"
            className={inputClass}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        )}
        <button
          onClick={() => void send()}
          disabled={!text.trim()}
          className="shrink-0 rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setCompose((c) => !c)}
          className={`rounded border px-2.5 py-1 text-xs ${
            compose
              ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
              : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
          }`}
          title="Toggle multi-line compose"
        >
          ⊞ Compose
        </button>
        <span className="mx-0.5 h-4 w-px bg-neutral-800" />
        <span className="text-[11px] uppercase tracking-wide text-neutral-600">keys</span>
        {TERMINAL_KEYS.map((key) => (
          <button
            key={key.label}
            onClick={() => void api.sendInput(sessionId, key.data)}
            title={key.title}
            className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {key.label}
          </button>
        ))}
        {sent && <span className="text-xs text-emerald-700">sent ✓</span>}
      </div>
      <p className="px-1 text-[11px] text-neutral-600">
        Type to talk to this session. When it asks a question, answer with the buttons up top or
        these keys.
      </p>
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
  const [task, setTask] = useState('');
  const [autonomous, setAutonomous] = useState(true);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setWorkspaceRoot(h.workspaceRoot))
      .catch(() => {});
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.createSession({
        name: name.trim(),
        workspace: workspace.trim() || undefined,
        command: command.trim() || undefined,
        autonomous,
        task: task.trim() || undefined,
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
        className="w-full max-w-md surface p-5"
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
          <Field
            label="Workspace"
            hint={
              workspaceRoot
                ? `path on the orchestrator host (e.g. ${workspaceRoot}/my-project). Blank = a fresh isolated directory for this session.`
                : 'absolute path on the orchestrator host; blank = a fresh isolated directory'
            }
          >
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder={workspaceRoot ? `${workspaceRoot}/my-project` : '/path/to/project'}
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
          <Field label="Task" hint="optional - what Claude should start working on">
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. review the open PR and fix any failing tests"
              className="input h-20"
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={autonomous}
              onChange={(e) => setAutonomous(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-neutral-200">
              Autonomous
              <span className="mt-0.5 block text-xs text-neutral-500">
                Claude runs commands without pausing for permission. Powerful - only on trusted
                workspaces.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

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
