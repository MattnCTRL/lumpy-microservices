'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { feedRole, parseSessionFeed } from '@/lib/transcript';

const ROLE_CLASS: Record<string, string> = {
  user: 'text-ink font-medium',
  assistant: 'text-neutral-100',
  status: 'text-neutral-500 italic',
  error: 'text-red-700 font-medium',
  plain: 'text-neutral-400',
};

/**
 * A live, cleaned transcript of a running session, polled from its terminal
 * output. This is the feedback the command bar was missing: you see your message
 * land, the session working, and its reply (including errors) - without reading
 * the raw TTY. `tail` caps how many recent lines to show.
 */
export function SessionFeed({
  sessionId,
  running,
  tail = 8,
  className = '',
}: {
  sessionId: string;
  running: boolean;
  tail?: number;
  className?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [unreachable, setUnreachable] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) {
      setLines([]);
      return;
    }
    let active = true;
    const load = () =>
      api
        .getOutput(sessionId, 200)
        .then((o) => {
          if (!active) return;
          setLines(parseSessionFeed(o.output));
          setUnreachable(false);
        })
        .catch(() => {
          if (active) setUnreachable(true);
        });
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [sessionId, running]);

  // Keep the newest line in view as it streams.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!running) return null;

  const shown = lines.slice(-tail);
  return (
    <div
      ref={boxRef}
      className={`overflow-y-auto rounded-lg bg-white/55 p-2 font-mono text-[11px] leading-relaxed shadow-glass ${className}`}
    >
      {shown.length === 0 ? (
        <p className="text-neutral-500">{unreachable ? 'session unreachable' : 'waiting for output…'}</p>
      ) : (
        shown.map((line, i) => (
          <div key={`${i}-${line.slice(0, 12)}`} className={`whitespace-pre-wrap break-words ${ROLE_CLASS[feedRole(line)]}`}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}
