'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthState, HealthResponse } from '@lumpy/shared';
import { api } from '@/lib/api';

const NAV = [
  { href: '/projects', label: 'Projects' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/fleet', label: 'Fleet' },
];

export function SideNav() {
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

  const alertsActive = pathname.startsWith('/alerts');

  return (
    <nav className="flex h-full w-48 shrink-0 flex-col border-r border-neutral-800 px-3 py-4">
      <div className="mb-6 px-1">
        <div className="text-lg font-semibold tracking-tight text-neutral-100">Lumpy</div>
        <div className="text-xs text-neutral-500">Micro Services</div>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                active
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800 pt-3">
        <Link
          href="/alerts"
          aria-label="Alerts"
          className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition ${
            alertsActive
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
          }`}
        >
          <span className="flex items-center gap-2">
            <span className="text-base leading-none">🔔</span> Alerts
          </span>
          {alertCount > 0 && (
            <span
              className={`rounded-full px-1.5 text-xs font-medium text-neutral-950 ${
                hasCritical ? 'bg-red-500' : 'bg-amber-500'
              }`}
            >
              {alertCount}
            </span>
          )}
        </Link>

        <Link
          href="/settings"
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
            pathname.startsWith('/settings')
              ? 'bg-neutral-800 text-neutral-100'
              : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
          }`}
        >
          <span className="text-base leading-none">⚙</span> Settings
        </Link>

        <div className="px-1 pt-1">
          <Profile auth={auth} onSignedOut={() => setAuth((a) => (a ? { ...a, user: null } : a))} />
        </div>

        <div className="px-3 pt-2">
          <HealthBadge health={health} />
        </div>
      </div>
    </nav>
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
        className="flex w-full items-center gap-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={auth.user.avatarUrl}
          alt={auth.user.login}
          className="h-6 w-6 rounded-full border border-neutral-700"
        />
        <span className="truncate text-sm text-neutral-200">{auth.user.name ?? auth.user.login}</span>
      </button>
    );
  }
  if (auth.configured) {
    return (
      <a
        href={api.authLoginUrl()}
        className="block rounded-md border border-neutral-700 px-3 py-1.5 text-center text-sm text-neutral-200 hover:bg-neutral-800"
      >
        Sign in
      </a>
    );
  }
  return null;
}

function HealthBadge({ health }: { health: HealthResponse | null }) {
  if (!health) return <span className="text-xs text-red-400">offline</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-500">
      <span className={`h-2 w-2 rounded-full ${health.tmux ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {health.tmux ? 'tmux ready' : 'tmux missing'} · v{health.version}
    </span>
  );
}
