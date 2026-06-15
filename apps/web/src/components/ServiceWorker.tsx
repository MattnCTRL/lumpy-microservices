'use client';

import { useEffect } from 'react';

/** Registers the network-first service worker (offline app-shell + installability). */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // registration is best-effort; the app works without it
    });
  }, []);
  return null;
}
