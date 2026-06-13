'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthState, HealthResponse } from '@lumpy/shared';
import { api } from '@/lib/api';

const TABS = [
  { href: '/sessions', label: 'Sessions' },
  { href: '/fleet', label: 'Fleet' },
  { href: '/alerts', label: 'Alerts' },
];

export function TopNav() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [hasCritical, setHasCritical] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    api
      .authMe()
      .then(setAuth)
      .catch(() => setAuth(null));
  }, []);

  useEffect(() => {
    const load = () =>
      api
        .health()
        .then(setHealth)
        .catch(() => setHealth(null));
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () =>
      api
        .listAlerts()
        .then((alerts) => {
          setAlertCount(alerts.length);
          setHasCritical(alerts.some((a) => a.severity === 'critical'));
        })
        .catch(() => {});
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-neutral-100">Lumpy</span>
          <span className="hidden text-xs text-neutral-500 sm:inline">Micro Services</span>
        </div>
        <nav className="flex gap-1">
          {TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            const showBadge = tab.href === '/alerts' && alertCount > 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${
                  active
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {tab.label}
                {showBadge && (
                  <span
                    className={`rounded-full px-1.5 text-xs font-medium text-neutral-950 ${
                      hasCritical ? 'bg-red-500' : 'bg-amber-500'
                    }`}
                  >
                    {alertCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <HealthBadge health={health} />
        <Profile auth={auth} onSignedOut={() => setAuth((a) => (a ? { ...a, user: null } : a))} />
      </div>
    </header>
  );
}

function Profile({ auth, onSignedOut }: { auth: AuthState | null; onSignedOut: () => void }) {
  if (!auth) return null;
  if (auth.user) {
    return (
      <button
        onClick={() => {
          void api.authLogout().then(onSignedOut);
        }}
        title="Sign out"
        className="flex items-center gap-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={auth.user.avatarUrl}
          alt={auth.user.login}
          className="h-6 w-6 rounded-full border border-neutral-700"
        />
        <span className="hidden text-sm text-neutral-200 sm:inline">
          {auth.user.name ?? auth.user.login}
        </span>
      </button>
    );
  }
  if (auth.configured) {
    return (
      <a
        href={api.authLoginUrl()}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        Sign in with GitHub
      </a>
    );
  }
  return null;
}

function HealthBadge({ health }: { health: HealthResponse | null }) {
  if (!health) return <span className="text-xs text-red-400">offline</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${health.tmux ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      <span className="hidden sm:inline">{health.tmux ? 'tmux ready' : 'tmux missing'} · </span>v
      {health.version}
    </span>
  );
}
