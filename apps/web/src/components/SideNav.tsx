'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthState, HealthResponse } from '@lumpy/shared';
import { api } from '@/lib/api';

const NAV = [
  { href: '/projects', label: 'Projects', icon: '📁' },
  { href: '/sessions', label: 'Sessions', icon: '⌨' },
  { href: '/services', label: 'Services', icon: '🧩' },
  { href: '/schedules', label: 'Schedules', icon: '⏰' },
  { href: '/fleet', label: 'Fleet', icon: '🖥' },
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

  return (
    <nav
      className="flex shrink-0 items-stretch border-neutral-800 bg-neutral-950
                 border-t md:h-full md:w-48 md:flex-col md:border-r md:border-t-0
                 md:bg-transparent md:px-3 md:py-4"
    >
      <div className="mb-6 hidden px-1 md:block">
        <div className="text-lg font-semibold tracking-tight text-neutral-100">Lumpy</div>
        <div className="text-xs text-neutral-500">Micro Services</div>
      </div>

      {/* Primary nav: row on mobile, column on desktop. */}
      <div className="flex flex-1 justify-around md:flex-col md:justify-start md:gap-1">
        {NAV.map((item) => (
          <NavItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
        ))}
      </div>

      {/* Utility cluster: inline on mobile, pinned to the bottom on desktop. */}
      <div className="flex items-center justify-around md:mt-4 md:flex-col md:items-stretch md:gap-1 md:border-t md:border-neutral-800 md:pt-3">
        <NavItem
          href="/alerts"
          label="Alerts"
          icon="🔔"
          active={pathname.startsWith('/alerts')}
          badge={alertCount > 0 ? { count: alertCount, critical: hasCritical } : undefined}
        />
        <NavItem
          href="/settings"
          label="Settings"
          icon="⚙"
          active={pathname.startsWith('/settings')}
        />
        <div className="px-2 py-2 md:px-1 md:pt-1">
          <Profile auth={auth} onSignedOut={() => setAuth((a) => (a ? { ...a, user: null } : a))} />
        </div>
        <div className="hidden md:block md:px-3 md:pt-2">
          <HealthBadge health={health} />
        </div>
      </div>
    </nav>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge?: { count: number; critical: boolean };
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`relative flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-xs transition
        md:flex-row md:gap-2 md:text-sm ${
          active
            ? 'text-neutral-100 md:bg-neutral-800'
            : 'text-neutral-400 hover:text-neutral-200 md:hover:bg-neutral-900'
        }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
      {badge && (
        <span
          className={`absolute right-1 top-0.5 rounded-full px-1.5 text-[10px] font-medium text-neutral-950 md:static md:ml-auto md:text-xs ${
            badge.critical ? 'bg-red-500' : 'bg-amber-500'
          }`}
        >
          {badge.count}
        </span>
      )}
    </Link>
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
        <span className="hidden truncate text-sm text-neutral-200 md:inline">
          {auth.user.name ?? auth.user.login}
        </span>
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
