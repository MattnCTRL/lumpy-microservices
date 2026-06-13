'use client';

import { useEffect, useRef } from 'react';
import { sessionSocketUrl } from '@/lib/api';

const THEME = {
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  selectionBackground: '#334155',
};

export function Terminal({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        fontSize: 13,
        cursorBlink: true,
        theme: THEME,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      const socket = new WebSocket(sessionSocketUrl(sessionId));
      socket.binaryType = 'arraybuffer';

      const sendResize = () => {
        fit.fit();
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      socket.onopen = () => sendResize();
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') return; // control messages handled elsewhere
        term.write(new Uint8Array(event.data as ArrayBuffer));
      };

      const dataDisposable = term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      const onWindowResize = () => sendResize();
      window.addEventListener('resize', onWindowResize);

      teardown = () => {
        window.removeEventListener('resize', onWindowResize);
        dataDisposable.dispose();
        socket.close();
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
