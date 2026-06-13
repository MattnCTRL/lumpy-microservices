'use client';

import { useEffect, useState } from 'react';
import type { AuthState } from '@lumpy/shared';
import { api } from '@/lib/api';

/**
 * When access gating is enabled and no one is signed in, show a sign-in screen
 * instead of letting pages fire requests that all 401. If the auth check itself
 * fails (e.g. orchestrator unreachable), fall through to the app so its own
 * offline indicators show.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null | undefined>(undefined);

  useEffect(() => {
    api
      .authMe()
      .then(setAuth)
      .catch(() => setAuth(null));
  }, []);

  if (auth === undefined) {
    return <Centered>Loading…</Centered>;
  }

  if (auth && auth.required && !auth.user) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-950 px-8 py-10 text-center">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold tracking-tight text-neutral-100">Lumpy</span>
            <span className="text-xs text-neutral-500">Micro Services</span>
          </div>
          <p className="max-w-xs text-sm text-neutral-400">
            Sign in to access sessions, your fleet, and alerts.
          </p>
          <a
            href={api.authLoginUrl()}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-800"
          >
            Sign in with GitHub
          </a>
        </div>
      </Centered>
    );
  }

  return <>{children}</>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-neutral-900 text-sm text-neutral-500">
      {children}
    </div>
  );
}
