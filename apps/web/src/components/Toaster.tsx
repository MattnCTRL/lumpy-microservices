'use client';

import { useEffect, useState } from 'react';

interface Toast {
  id: number;
  message: string;
}

/**
 * Surfaces otherwise-silent failures. API mutations now reject with the server's
 * error message (see api.ts `ok`), so any action whose call site does not handle
 * the rejection bubbles up here as a transient toast instead of silently no-opping
 * (e.g. a viewer's forbidden Stop, or a 500). Call sites that show their own inline
 * error catch the rejection, so they do not double-surface.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let counter = 0;
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      // Ignore aborted fetches and non-Error rejections; only show actionable messages.
      if (!(reason instanceof Error) || reason.name === 'AbortError' || !reason.message) return;
      event.preventDefault();
      const id = ++counter;
      setToasts((prev) => [...prev.slice(-3), { id, message: reason.message }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto max-w-md rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-700 shadow-lg"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
