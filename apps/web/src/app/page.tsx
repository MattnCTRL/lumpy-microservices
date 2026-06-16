'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LumpyEvent, Session } from '@lumpy/shared';
import { api, eventsSocketUrl, ORCHESTRATOR_URL } from '@/lib/api';
import { reconnectingSocket } from '@/lib/socket';
import { CreateDialog, SessionPanel } from '@/components/SessionPanel';
import { SkeletonCards } from '@/components/Skeleton';

// The command center: one surface. Every piece of work is a card flowing through
// the board; the Conductor is the hub you command from the bar below; tapping a
// card opens its full conversation. The old per-tab split (Home / Sessions /
// Tasks) collapses into this.
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
const SESSION_KIND: Kind = { label: 'Session', icon: '⌨', tint: 'tint-ice', ring: 'text-ice' };

function kindOf(s: Session): Kind {
  if (s.kind === 'session') return SESSION_KIND;
  for (const tag of s.tags) if (KINDS[tag]) return KINDS[tag];
  return KINDS.task;
}

function ago(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
}

// A finished task lingers in "Finalizing" (memory is written on teardown, so this
// is the visible beat) before sliding to Done and draining over the reap grace.
const FINALIZE_MS = 9000;
const REAP_GRACE_MS = 90000;

type LaneKey = 'queued' | 'running' | 'finalizing' | 'done';

const LANES: { key: LaneKey; label: string; hint: string }[] = [
  { key: 'queued', label: 'Queued', hint: 'spinning up' },
  { key: 'running', label: 'Running', hint: 'nothing active' },
  { key: 'finalizing', label: 'Finalizing', hint: 'writing to memory' },
  { key: 'done', label: 'Done', hint: 'recently finished' },
];

function laneOf(s: Session): LaneKey {
  // Interactive sessions are persistent workspaces, not throughput jobs: running
  // ones sit in Running; stopped ones park in Done (resumable, never auto-drain).
  if (s.kind === 'session') return s.status === 'running' ? 'running' : 'done';
  // Tasks flow through the pipeline and drain when finished.
  if (s.status === 'running') {
    if ((s.activity === 'idle' || s.activity === 'unknown') && !s.lastActivityAt) return 'queued';
    return 'running';
  }
  if (s.doneForMs != null && s.doneForMs < FINALIZE_MS) return 'finalizing';
  return 'done';
}

export default function CommandCenterPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [conductor, setConductor] = useState<Session | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Session | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const all = await api.listSessions();
      setConductor(all.find((s) => s.kind === 'conductor') ?? null);
      setSessions(all.filter((s) => s.kind !== 'conductor'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const socket = reconnectingSocket(eventsSocketUrl(), (data) => {
      const m = JSON.parse(data) as LumpyEvent;
      if (m.type === 'session.status' || m.type === 'session.activity') void refresh();
    });
    // The 2s poll advances the client-side stage clock (Finalizing -> Done ->
    // drain) and drives retirement without waiting on an event.
    const interval = setInterval(() => void refresh(), 2000);
    return () => {
      socket.close();
      clearInterval(interval);
    };
  }, [refresh]);

  const byLane: Record<LaneKey, Session[]> = { queued: [], running: [], finalizing: [], done: [] };
  for (const s of sessions) byLane[laneOf(s)].push(s);
  const activeCount = byLane.queued.length + byLane.running.length;
  const wrapping = byLane.finalizing.length + byLane.done.length;

  const liveSelected =
    [...sessions, ...(conductor ? [conductor] : [])].find((s) => s.id === selectedId) ?? null;
  // Keep the last-known snapshot so an open drawer doesn't vanish when its task is
  // reaped out of the list (~90s after it finishes); we show a retired notice instead.
  useEffect(() => {
    if (liveSelected) setSnapshot(liveSelected);
  }, [liveSelected]);
  const selected = liveSelected ?? (selectedId ? snapshot : null);
  const retired = Boolean(selectedId && !liveSelected && snapshot);
  const closeDrawer = () => {
    setSelectedId(null);
    setSnapshot(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-neutral-100">Command center</h1>
          {!loading && (
            <span className="text-xs text-neutral-500">
              {activeCount} active{wrapping > 0 && ` · ${wrapping} wrapping up`}
            </span>
          )}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white"
        >
          + New session
        </button>
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
              <Lane key={lane.key} lane={lane} cards={byLane[lane.key]} onOpen={setSelectedId} />
            ))}
          </div>
        )}
      </div>

      <ConductorBar conductor={conductor} onExpand={() => conductor && setSelectedId(conductor.id)} />

      {selected && (
        <Drawer onClose={closeDrawer}>
          {retired ? (
            <RetiredNotice name={snapshot?.name ?? 'This task'} onClose={closeDrawer} />
          ) : (
            <SessionPanel
              session={selected}
              onBack={closeDrawer}
              onChanged={() => void refresh()}
              onDeleted={() => {
                closeDrawer();
                void refresh();
              }}
            />
          )}
        </Drawer>
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(session) => {
            setCreating(false);
            void refresh();
            setSelectedId(session.id);
          }}
        />
      )}
    </div>
  );
}

function Lane({
  lane,
  cards,
  onOpen,
}: {
  lane: { key: LaneKey; label: string; hint: string };
  cards: Session[];
  onOpen: (id: string) => void;
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
          cards.map((s) => <SessionCard key={s.id} session={s} lane={lane.key} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  lane,
  onOpen,
}: {
  session: Session;
  lane: LaneKey;
  onOpen: (id: string) => void;
}) {
  const kind = kindOf(session);
  const isSession = session.kind === 'session';
  // Tasks visibly drain in Done (opacity falls with age); parked sessions don't.
  const drainOpacity =
    lane === 'done' && !isSession && session.doneForMs != null
      ? Math.max(0.3, 1 - session.doneForMs / REAP_GRACE_MS)
      : 1;
  const needsYou = session.status === 'running' && session.activity === 'awaiting_permission';

  return (
    <button
      onClick={() => onOpen(session.id)}
      style={drainOpacity !== 1 ? { opacity: drainOpacity } : undefined}
      className={`surface ${kind.tint} animate-lane-in block w-full p-3 text-left transition hover:-translate-y-0.5 hover:shadow-glass-lg ${
        needsYou ? 'ring-1 ring-warn/50' : ''
      }`}
      aria-label={`${kind.label}: ${session.name}`}
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
          <div className="truncate text-sm font-medium text-neutral-100" title={session.name}>
            {session.name}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        <StageLine session={session} lane={lane} ring={kind.ring} isSession={isSession} />
        <span className="shrink-0 font-medium text-ink">open →</span>
      </div>
    </button>
  );
}

function StageLine({
  session,
  lane,
  ring,
  isSession,
}: {
  session: Session;
  lane: LaneKey;
  ring: string;
  isSession: boolean;
}) {
  if (session.status === 'running' && session.activity === 'awaiting_permission') {
    return <span className="font-medium text-warn">needs your input</span>;
  }
  if (lane === 'queued') return <span className="text-neutral-500">queued · {ago(session.createdAt)}</span>;
  if (lane === 'running') {
    if (isSession) return <span className={ring}>live workspace</span>;
    return (
      <span className={`flex items-center gap-1.5 ${ring}`}>
        <Spinner /> working · {ago(session.createdAt)}
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
  // Done lane.
  if (isSession) return <span className="text-neutral-500">parked · resume</span>;
  return <span className="text-neutral-500">✓ recorded · draining</span>;
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

/** A right-side slide-over holding the full session/conversation view. Taps
 *  anywhere outside the panel (and Escape) close it; the panel stops propagation
 *  so the whole non-panel area is dismissible regardless of width. z-50 sits it
 *  above the z-40 mobile tab bar. */
function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div aria-hidden className="flex-1 bg-black/40 backdrop-blur-[2px]" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl shrink-0 animate-lane-in shadow-glass-lg sm:w-[34rem]"
      >
        {children}
      </div>
    </div>
  );
}

/** Shown in the drawer when the task whose panel was open has finished and been
 *  retired from the board, so the view doesn't just vanish out from under you. */
function RetiredNotice({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 surface p-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/70 text-2xl shadow-glass">
        ✓
      </div>
      <div className="text-sm font-medium text-neutral-100">{name} finished</div>
      <p className="max-w-xs text-xs text-neutral-500">
        Its outcome was recorded to memory and the task has retired off the board. The durable
        result lives in the project&apos;s knowledge, not here.
      </p>
      <button
        onClick={onClose}
        className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
      >
        Close
      </button>
    </div>
  );
}

/**
 * The Conductor command bar - pinned below the board. Send a command from here;
 * the Conductor coordinates the cards above. "Expand" opens its full conversation.
 */
function ConductorBar({ conductor, onExpand }: { conductor: Session | null; onExpand: () => void }) {
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
      // Clear any pre-filled line, type the command, submit it.
      await api.sendInput(conductor.id, '\x15');
      await api.sendInput(conductor.id, value);
      await new Promise((r) => setTimeout(r, 80));
      await api.sendInput(conductor.id, '\r');
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
          👑 Conductor
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
          <button onClick={onExpand} className="text-[11px] font-medium text-ink hover:underline">
            expand conversation →
          </button>
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
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
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
