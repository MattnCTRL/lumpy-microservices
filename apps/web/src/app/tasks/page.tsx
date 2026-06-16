'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LumpyEvent, Session } from '@lumpy/shared';
import { api, eventsSocketUrl, ORCHESTRATOR_URL } from '@/lib/api';
import { reconnectingSocket } from '@/lib/socket';
import { SkeletonCards } from '@/components/Skeleton';

// Each autonomous one-shot job (librarian/remediation/scheduled/service) is a
// "task": it runs headless and flows through the board - Queued -> Running ->
// Finalizing (its outcome is written to project memory) -> Done, then it drains
// off and auto-retires. The durable result lives in the ledger, not here.
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

// How long a stopped task lingers in "Finalizing" (memory is written on teardown,
// so this is the visible beat) before it slides to Done and starts draining.
const FINALIZE_MS = 9000;
// Matches the orchestrator's reap grace - the window over which a Done card fades.
const REAP_GRACE_MS = 90000;

type LaneKey = 'queued' | 'running' | 'finalizing' | 'done';

const LANES: { key: LaneKey; label: string; hint: string }[] = [
  { key: 'queued', label: 'Queued', hint: 'spinning up' },
  { key: 'running', label: 'Running', hint: 'working' },
  { key: 'finalizing', label: 'Finalizing', hint: 'writing to memory' },
  { key: 'done', label: 'Done', hint: 'recorded · draining' },
];

function laneOf(t: Session): LaneKey {
  if (t.status === 'running') {
    // Spun up but not yet observed doing anything = still queued.
    if ((t.activity === 'idle' || t.activity === 'unknown') && !t.lastActivityAt) return 'queued';
    return 'running';
  }
  if (t.doneForMs != null && t.doneForMs < FINALIZE_MS) return 'finalizing';
  return 'done';
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Session[]>([]);
  const [conductor, setConductor] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const all = await api.listSessions();
      setTasks(all.filter((s) => s.kind === 'task'));
      setConductor(all.find((s) => s.kind === 'conductor') ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Live: any session event nudges a refresh. The 2s poll also advances the
    // client-side stage clock (Finalizing -> Done -> drain) and drives retirement
    // (reaped tasks drop out of the list) without waiting on an event.
    const socket = reconnectingSocket(eventsSocketUrl(), (data) => {
      const m = JSON.parse(data) as LumpyEvent;
      if (m.type === 'session.status' || m.type === 'session.activity') void refresh();
    });
    const interval = setInterval(() => void refresh(), 2000);
    return () => {
      socket.close();
      clearInterval(interval);
    };
  }, [refresh]);

  const byLane: Record<LaneKey, Session[]> = { queued: [], running: [], finalizing: [], done: [] };
  for (const t of tasks) byLane[laneOf(t)].push(t);
  const activeCount = byLane.queued.length + byLane.running.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 pb-3 pt-4">
        <h1 className="text-lg font-semibold text-neutral-100">Mission control</h1>
        {!loading && (
          <span className="text-xs text-neutral-500">
            {activeCount} active
            {byLane.finalizing.length + byLane.done.length > 0 &&
              ` · ${byLane.finalizing.length + byLane.done.length} wrapping up`}
          </span>
        )}
      </div>

      {error && (
        <p className="px-4 pb-2 text-sm text-red-700">
          {error} - is the orchestrator running on {ORCHESTRATOR_URL}?
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto px-4">
        {loading ? (
          <SkeletonCards count={4} />
        ) : (
          <div className="grid h-full min-w-[760px] grid-cols-4 gap-3 pb-3">
            {LANES.map((lane) => (
              <Lane key={lane.key} lane={lane} cards={byLane[lane.key]} />
            ))}
          </div>
        )}
      </div>

      <ConductorBar conductor={conductor} />
    </div>
  );
}

function Lane({
  lane,
  cards,
}: {
  lane: { key: LaneKey; label: string; hint: string };
  cards: Session[];
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {lane.label}
        </span>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/70 px-1.5 text-[10px] font-semibold text-neutral-500 shadow-glass">
          {cards.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
        {cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line py-6 text-center text-[11px] text-neutral-500">
            {lane.hint}
          </div>
        ) : (
          cards.map((t) => <TaskCard key={t.id} task={t} lane={lane.key} />)
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, lane }: { task: Session; lane: LaneKey }) {
  const kind = kindOf(task);
  // In the Done lane the card visibly drains: opacity falls with age until reaped.
  const drainOpacity =
    lane === 'done' && task.doneForMs != null
      ? Math.max(0.3, 1 - task.doneForMs / REAP_GRACE_MS)
      : 1;

  return (
    <div
      className={`surface ${kind.tint} animate-lane-in p-3`}
      style={lane === 'done' ? { opacity: drainOpacity } : undefined}
      aria-label={`${kind.label}: ${task.name}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70 text-base shadow-glass">
          {kind.icon}
          {lane === 'running' && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {kind.label}
          </span>
          <div className="truncate text-sm font-medium text-neutral-100" title={task.name}>
            {task.name}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        <StageLine task={task} lane={lane} ring={kind.ring} />
        {task.projectId && (
          <Link href="/projects" className="shrink-0 font-medium text-ink hover:underline">
            {lane === 'finalizing' || lane === 'done' ? 'review →' : 'project'}
          </Link>
        )}
      </div>
    </div>
  );
}

function StageLine({ task, lane, ring }: { task: Session; lane: LaneKey; ring: string }) {
  if (lane === 'queued') return <span className="text-neutral-500">queued · {ago(task.createdAt)}</span>;
  if (lane === 'running') {
    if (task.activity === 'awaiting_permission') {
      return <span className="font-medium text-warn">needs your input</span>;
    }
    return (
      <span className={`flex items-center gap-1.5 ${ring}`}>
        <Spinner /> working · {ago(task.createdAt)}
      </span>
    );
  }
  if (lane === 'finalizing') {
    return (
      <span className={`flex items-center gap-1.5 ${ring}`}>
        <Spinner /> writing to memory
      </span>
    );
  }
  return <span className="text-neutral-500">✓ recorded · draining</span>;
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

/**
 * The Conductor command bar - pinned below the flow board. Send the Conductor an
 * instruction from here; it coordinates the agents/cards above. The full back-and-
 * forth lives on the Sessions page (linked); this is the quick command line.
 */
function ConductorBar({ conductor }: { conductor: Session | null }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  const online = conductor?.status === 'running';
  const needsYou = conductor?.activity === 'awaiting_permission';

  const send = async () => {
    const value = text.trim();
    if (!value || !conductor || sending) return;
    setSending(true);
    try {
      await api.sendInput(conductor.id, `${value}\r`);
      setText('');
      setSentAt(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setSentAt(false), 2500);
    } catch {
      // surfaced by the global toast
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-line bg-glass px-4 py-3 backdrop-blur-glass">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          <span
            className={`h-2 w-2 rounded-full ${
              !online ? 'bg-neutral-400' : needsYou ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'
            }`}
          />
          Conductor
          <span className="font-normal normal-case text-neutral-500">
            {!conductor
              ? 'not running'
              : needsYou
                ? 'needs your input'
                : conductor.activity === 'working'
                  ? 'working'
                  : 'ready'}
          </span>
        </span>
        {conductor && (
          <Link href="/sessions" className="text-[11px] font-medium text-ink hover:underline">
            open full conversation →
          </Link>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={!online || sending}
          placeholder={online ? 'Command the Conductor…' : 'Conductor offline'}
          className="input flex-1"
        />
        <button
          onClick={() => void send()}
          disabled={!online || sending || !text.trim()}
          className="shrink-0 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {sentAt ? 'sent ✓' : 'Send'}
        </button>
      </div>
    </div>
  );
}
