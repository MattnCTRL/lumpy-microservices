'use client';

import { useEffect, useRef, useState } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon as XFitAddon } from '@xterm/addon-fit';
import { sessionSocketUrl } from '@/lib/api';

const THEME = {
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  selectionBackground: '#334155',
};

const MIN_FONT = 7;
const MAX_FONT = 20;

export function Terminal({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const fontSizeRef = useRef(13);

  useEffect(() => {
    let disposed = false;
    let teardown = () => {};

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize,
        cursorBlink: true,
        theme: THEME,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      const sendResize = () => {
        fit.fit();
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      const dataDisposable = term.onData((data) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // The session WebSocket transparently reconnects (capped backoff) so a
      // routine orchestrator restart / safe-deploy or a network blip doesn't
      // freeze the terminal forever. On reconnect the broker replays its ring
      // buffer, so we reset and repaint from the fresh snapshot. `done` stops
      // retrying once the session is genuinely gone.
      let backoff = 1000;
      let retry: ReturnType<typeof setTimeout> | null = null;
      let done = false;

      const connect = () => {
        if (disposed || done) return;
        const socket = new WebSocket(sessionSocketUrl(sessionId));
        socket.binaryType = 'arraybuffer';
        socketRef.current = socket;

        socket.onopen = () => {
          backoff = 1000;
          term.reset();
          sendResize();
        };
        socket.onmessage = (event) => {
          if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data) as { type?: string; status?: string; message?: string };
              if (msg.type === 'status' && msg.status === 'stopped') {
                term.writeln('\r\n\x1b[2m[session stopped]\x1b[0m');
                done = true;
              } else if (msg.type === 'error' && msg.message) {
                term.writeln(`\r\n\x1b[33m[${msg.message}]\x1b[0m`);
                // Stop retrying on terminal conditions: session gone, or the server
                // closed the socket for auth/role reasons (retrying can't fix those).
                if (/not found|authentication required|admin role/i.test(msg.message)) {
                  done = true;
                }
              }
            } catch {
              // non-JSON text frame; ignore
            }
            return;
          }
          term.write(new Uint8Array(event.data as ArrayBuffer));
        };
        socket.onclose = () => {
          if (disposed || done || retry) return;
          retry = setTimeout(() => {
            retry = null;
            backoff = Math.min(backoff * 2, 15000);
            connect();
          }, backoff);
        };
        socket.onerror = () => socket.close();
      };

      const onWindowResize = () => sendResize();
      window.addEventListener('resize', onWindowResize);
      connect();

      teardown = () => {
        window.removeEventListener('resize', onWindowResize);
        dataDisposable.dispose();
        if (retry) clearTimeout(retry);
        const socket = socketRef.current;
        if (socket) {
          socket.onclose = null;
          socket.close();
        }
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      teardown();
      termRef.current = null;
      fitRef.current = null;
      socketRef.current = null;
    };
  }, [sessionId]);

  // Apply font-size changes: smaller font = the session resizes to show more.
  useEffect(() => {
    fontSizeRef.current = fontSize;
    const term = termRef.current;
    const fit = fitRef.current;
    const socket = socketRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;
    fit.fit();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, [fontSize]);

  // Pinch-to-zoom on touch: two-finger gesture adjusts the font size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startDistance = 0;
    let startFont = 13;
    const distance = (touches: TouchList) => {
      const a = touches[0]!;
      const b = touches[1]!;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        startDistance = distance(event.touches);
        startFont = fontSizeRef.current;
        event.preventDefault();
      }
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length === 2 && startDistance > 0) {
        event.preventDefault();
        const ratio = distance(event.touches) / startDistance;
        const next = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(startFont * ratio)));
        setFontSize(next);
      }
    };
    const onEnd = () => {
      startDistance = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-1 pb-1">
        <button
          onClick={() => setFontSize((s) => Math.max(MIN_FONT, s - 1))}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          aria-label="Decrease font size"
        >
          A−
        </button>
        <span className="w-9 text-center text-xs text-neutral-500">{fontSize}px</span>
        <button
          onClick={() => setFontSize((s) => Math.min(MAX_FONT, s + 1))}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          aria-label="Increase font size"
        >
          A+
        </button>
      </div>
      {/* Tapping focuses the terminal's input - on mobile this raises the
          keyboard so you can type directly into the session. */}
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        className="min-h-0 flex-1 overflow-auto"
      />
    </div>
  );
}
