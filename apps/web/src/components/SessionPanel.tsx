'use client';

import { useEffect, useState } from 'react';
import type { Session, SessionActivity } from '@lumpy/shared';
import { ConnectorsDialog } from '@/components/ConnectorsDialog';
import { Field } from '@/components/Field';
import { Terminal } from '@/components/Terminal';
import { api } from '@/lib/api';

export function isClaudeCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === 'claude' || trimmed.startsWith('claude ');
}

const ACTIVITY_STYLE: Record<SessionActivity, { dot: string; label: string }> = {
  working: { dot: 'bg-blue-500 animate-pulse', label: 'working' },
  awaiting_permission: { dot: 'bg-amber-500 animate-pulse', label: 'needs you' },
  idle: { dot: 'bg-emerald-500', label: 'idle' },
  unknown: { dot: 'bg-neutral-600', label: '' },
};

export function ActivityBadge({ session }: { session: Session }) {
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

/**
 * The full session view: chat-first (the raw terminal is hidden by default and
 * toggled on to inspect), with connectors, a prompt banner when the session is
 * asking, the composer, and resume/restart/delete when stopped. Shared by the
 * command center (in a slide-over drawer) and any raw session list.
 */
export function SessionPanel({
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
  const [showTerminal, setShowTerminal] = useState(false);
  const running = session.status === 'running';
  return (
    <div className="flex h-full flex-col surface">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            className="shrink-0 rounded px-1.5 py-0.5 text-sm text-neutral-400 hover:bg-neutral-800"
            aria-label="Close"
          >
            ←
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-neutral-100">
              {session.kind === 'conductor' ? '👑 ' : ''}
              {session.name}
            </h2>
            <p className="truncate text-xs text-neutral-500">{session.workspace}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <button
              onClick={() => setShowTerminal((v) => !v)}
              className={`rounded border px-2 py-0.5 text-xs ${
                showTerminal
                  ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                  : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
              }`}
              title="Show or hide the raw terminal"
            >
              {showTerminal ? 'Hide terminal' : '⌟ Terminal'}
            </button>
          )}
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
      {running && session.activity === 'awaiting_permission' && (
        <PromptBanner sessionId={session.id} prompt={session.prompt} />
      )}
      {running ? (
        <>
          <div className="min-h-0 flex-1">
            {showTerminal ? (
              <div className="h-full p-2">
                <Terminal key={session.id} sessionId={session.id} />
              </div>
            ) : (
              <div className="h-full overflow-y-auto p-3">
                <ConversationLede session={session} />
              </div>
            )}
          </div>
          <InputBar sessionId={session.id} />
        </>
      ) : (
        <div className="min-h-0 flex-1 p-2">
          <StoppedActions session={session} onChanged={onChanged} onDeleted={onDeleted} />
        </div>
      )}
    </div>
  );
}

/** The clean, conversation-first view shown instead of the raw terminal. */
function ConversationLede({ session }: { session: Session }) {
  const conductor = session.kind === 'conductor';
  const status =
    session.activity === 'awaiting_permission'
      ? { label: 'needs you', cls: 'bg-amber-100 text-amber-700' }
      : session.activity === 'working'
        ? { label: 'working…', cls: 'bg-emerald-100 text-emerald-700' }
        : { label: 'idle', cls: 'bg-neutral-200 text-neutral-600' };
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/70 text-3xl shadow-glass">
        {conductor ? '👑' : '⌨'}
      </div>
      <div>
        <div className="text-base font-semibold text-neutral-100">
          {conductor ? 'Lumpy Conductor' : session.name}
        </div>
        <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.cls}`}>
          {status.label}
        </span>
      </div>
      <p className="max-w-sm text-sm text-neutral-500">
        {conductor
          ? 'Talk to Lumpy below - it coordinates your sessions, tasks, and fleet. Just tell it what you need.'
          : 'Message this session below; it is running its task autonomously.'}
      </p>
      <p className="text-xs text-neutral-500">
        Toggle <span className="font-medium text-neutral-400">Terminal</span> (top right) to watch the
        raw session.
      </p>
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
      throw error;
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

function PromptBanner({ sessionId, prompt }: { sessionId: string; prompt: Session['prompt'] }) {
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

const TERMINAL_KEYS: { label: string; data: string; title: string }[] = [
  { label: '↵ Enter', data: '\r', title: 'Submit / confirm the current line' },
  { label: '↑', data: '\x1b[A', title: 'Up - move through a menu or history' },
  { label: '↓', data: '\x1b[B', title: 'Down - move through a menu' },
  { label: 'Esc', data: '\x1b', title: 'Cancel / dismiss' },
  { label: '⌃C Stop', data: '\x03', title: 'Interrupt the running task' },
];

/** The session composer - a chat box wired to the live session. */
export function InputBar({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('');
  const [compose, setCompose] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    const value = text;
    if (!value.trim()) return;
    setText('');
    try {
      await api.sendInput(sessionId, '\x15');
      await api.sendInput(sessionId, value);
      await new Promise((r) => setTimeout(r, 80));
      await api.sendInput(sessionId, '\r');
      setSent(true);
      setTimeout(() => setSent(false), 1200);
    } catch (error) {
      setText(value);
      throw error;
    }
  };

  const inputClass =
    'min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none';

  return (
    <div
      className="space-y-1.5 border-t border-neutral-800 px-2 py-2"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
    >
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
    </div>
  );
}

/** New-session dialog. */
export function CreateDialog({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-md surface p-5">
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
