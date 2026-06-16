'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { LumpyEvent, Session } from '@lumpy/shared';
import { api, eventsSocketUrl, ORCHESTRATOR_URL } from '@/lib/api';
import { reconnectingSocket } from '@/lib/socket';
import { SkeletonCards } from '@/components/Skeleton';

// Each autonomous one-shot job (librarian/remediation/scheduled/service) is a
// "task": it runs headless, shows live on this board, then auto-retires when
// done - its output persists in the project, not as a perpetual session.
interface Kind {
  label: string;
  icon: string;
  tint: string;
  ring: string;
}
const KINDS: Record<string, Kind> = {
  librarian: { label: 'Librarian', icon: '📚', tint: 'tint-violet', ring: 'text-violet' },
  remediation: { label: 'Remediation', icon: '🔧', tint: 'tint-coral', ring: 'text-coral' },
  scheduled: { label: 'Scheduled', icon: '⏰', tint: 'tint-ice', ring: 'text-ice' },
  service: { label: 'Service', icon: '🧩', tint: 'tint-mint', ring: 'text-mint' },
  task: { label: 'Task', icon: '⚡', tint: 'tint-ice', ring: 'text-ice' },
};

function kindOf(s: Session): Kind {
  for (const tag of s.tags) if (KINDS[tag]) return KINDS[tag];
  return KINDS.task;
}

function ago(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const all = await api.listSessions();
      setTasks(all.filter((s) => s.kind === 'task'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Live: any session event nudges a refresh; a slow poll is the fallback and
    // also drives the auto-retire (reaped tasks drop out of the list).
    const socket = reconnectingSocket(eventsSocketUrl(), (data) => {
      const m = JSON.parse(data) as LumpyEvent;
      if (m.type === 'session.status' || m.type === 'session.activity') void refresh();
    });
    const interval = setInterval(() => void refresh(), 5000);
    return () => {
      socket.close();
      clearInterval(interval);
    };
  }, [refresh]);

  const running = tasks.filter((t) => t.status === 'running');
  const done = tasks.filter((t) => t.status !== 'running');

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Mission control</h1>
        {!loading && (
          <span className="text-xs text-neutral-500">
            {running.length} running{done.length > 0 && ` · ${done.length} finishing`}
          </span>
        )}
      </div>
      {error && (
        <p className="mb-3 text-sm text-red-700">
          {error} - is the orchestrator running on {ORCHESTRATOR_URL}?
        </p>
      )}

      {loading ? (
        <SkeletonCards count={4} />
      ) : tasks.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-1 text-center text-sm text-neutral-500">
          <span className="text-2xl">🛰️</span>
          <p>No tasks running.</p>
          <p className="text-xs">
            Build a project&apos;s knowledge base, or one appears when an alert or schedule fires.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...running, ...done].map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: Session }) {
  const kind = kindOf(task);
  const running = task.status === 'running';
  return (
    <div
      className={`surface ${kind.tint} p-4 transition ${running ? '' : 'opacity-70'}`}
      aria-label={`${kind.label}: ${task.name}`}
    >
      <div className="flex items-start gap-3">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/70 text-lg shadow-glass">
          {kind.icon}
          {running && (
            <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ${'animate-pulse'}`} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {kind.label}
            </span>
            <StatusPill running={running} />
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-neutral-100" title={task.name}>
            {task.name}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
        {running ? (
          <span className={`flex items-center gap-1.5 ${kind.ring}`}>
            <Spinner /> working · {ago(task.createdAt)}
          </span>
        ) : (
          <span className="text-neutral-500">✓ done · retiring…</span>
        )}
        {task.kind === 'task' && task.projectId && (
          <Link href="/projects" className="font-medium text-ink hover:underline">
            {running ? 'open project' : 'review draft →'}
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusPill({ running }: { running: boolean }) {
  return running ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      running
    </span>
  ) : (
    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">
      done
    </span>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}
