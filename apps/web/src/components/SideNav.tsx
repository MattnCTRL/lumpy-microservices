'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthState, HealthResponse } from '@lumpy/shared';
import { api } from '@/lib/api';

interface Item {
  href: string;
  label: string;
  icon: string;
}

// Full nav — shown on the desktop left rail.
const NAV: Item[] = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/projects', label: 'Projects', icon: '📁' },
  { href: '/sessions', label: 'Sessions', icon: '⌨' },
  { href: '/services', label: 'Services', icon: '🧩' },
  { href: '/schedules', label: 'Schedules', icon: '⏰' },
  { href: '/fleet', label: 'Fleet', icon: '🖥' },
];

// Mobile bottom bar: a focused 5-tab set (Alerts + More are added in markup).
// Everything else lives behind "More" so the bar never overflows.
const MOBILE_PRIMARY: Item[] = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/sessions', label: 'Sessions', icon: '⌨' },
  { href: '/fleet', label: 'Fleet', icon: '🖥' },
];
const MOBILE_MORE: Item[] = [
  { href: '/projects', label: 'Projects', icon: '📁' },
  { href: '/services', label: 'Services', icon: '🧩' },
  { href: '/schedules', label: 'Schedules', icon: '⏰' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function SideNav() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [hasCritical, setHasCritical] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

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

  // Close the More sheet whenever the route changes.
  useEffect(() => setMoreOpen(false), [pathname]);

  const alertBadge = alertCount > 0 ? { count: alertCount, critical: hasCritical } : undefined;
  const moreActive = MOBILE_MORE.some((i) => isActive(pathname, i.href)) || moreOpen;
  const signOut = () => void api.authLogout().then(() => setAuth((a) => (a ? { ...a, user: null } : a)));

  return (
    <>
      {/* ---- Desktop left rail ---- */}
      <nav className="hidden h-full w-48 shrink-0 flex-col border-r border-neutral-800 px-3 py-4 md:flex">
        <Link href="/" className="mb-6 px-1">
          <div className="text-lg font-semibold tracking-tight text-neutral-100">Lumpy</div>
          <div className="text-xs text-neutral-500">Micro Services</div>
        </Link>
        <div className="flex flex-col gap-1">
          {NAV.map((item) => (
            <RailItem key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800 pt-3">
          <RailItem
            href="/alerts"
            label="Alerts"
            icon="🔔"
            active={pathname.startsWith('/alerts')}
            badge={alertBadge}
          />
          <RailItem href="/settings" label="Settings" icon="⚙" active={pathname.startsWith('/settings')} />
          <div className="px-1 py-2">
            <Profile auth={auth} onSignOut={signOut} />
          </div>
          <div className="px-3 pt-2">
            <HealthBadge health={health} />
          </div>
        </div>
      </nav>

      {/* ---- Mobile bottom tab bar (5 tabs, never overflows) ---- */}
      <nav
        className="flex shrink-0 items-stretch border-t border-neutral-800 bg-neutral-950 md:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
      >
        {MOBILE_PRIMARY.map((item) => (
          <Tab key={item.href} {...item} active={isActive(pathname, item.href)} />
        ))}
        <Tab href="/alerts" label="Alerts" icon="🔔" active={pathname.startsWith('/alerts')} badge={alertBadge} />
        <TabButton label="More" icon="⋯" active={moreActive} onClick={() => setMoreOpen((v) => !v)} />
      </nav>

      {moreOpen && (
        <MoreSheet
          items={MOBILE_MORE}
          pathname={pathname}
          auth={auth}
          health={health}
          onClose={() => setMoreOpen(false)}
          onSignOut={signOut}
        />
      )}
    </>
  );
}

/** A desktop rail row (icon + label, horizontal). */
function RailItem({
  href,
  label,
  icon,
  active,
  badge,
}: Item & { active: boolean; badge?: { count: number; critical: boolean } }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
        active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
      {badge && (
        <span
          className={`ml-auto rounded-full px-1.5 text-xs font-medium text-neutral-950 ${
            badge.critical ? 'bg-red-500' : 'bg-amber-500'
          }`}
        >
          {badge.count}
        </span>
      )}
    </Link>
  );
}

/** A mobile bottom-bar tab (icon over label, generous tap target). */
function Tab({
  href,
  label,
  icon,
  active,
  badge,
}: Item & { active: boolean; badge?: { count: number; critical: boolean } }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition active:bg-neutral-900 ${
        active ? 'text-neutral-100' : 'text-neutral-400'
      }`}
    >
      <span className={`text-xl leading-none ${active ? 'scale-110' : ''} transition-transform`}>{icon}</span>
      <span>{label}</span>
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-neutral-200" />}
      {badge && (
        <span
          className={`absolute right-[22%] top-1 rounded-full px-1.5 text-[10px] font-medium text-neutral-950 ${
            badge.critical ? 'bg-red-500' : 'bg-amber-500'
          }`}
        >
          {badge.count}
        </span>
      )}
    </Link>
  );
}

/** A mobile bottom-bar button (for "More"). */
function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition active:bg-neutral-900 ${
        active ? 'text-neutral-100' : 'text-neutral-400'
      }`}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span>{label}</span>
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-neutral-200" />}
    </button>
  );
}

/** Bottom sheet listing the secondary destinations + account. */
function MoreSheet({
  items,
  pathname,
  auth,
  health,
  onClose,
  onSignOut,
}: {
  items: Item[];
  pathname: string;
  auth: AuthState | null;
  health: HealthResponse | null;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-neutral-800 bg-neutral-950 p-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-700" />
        <div className="flex flex-col gap-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-base ${
                  active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-200 active:bg-neutral-900'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
          <div className="mt-1 border-t border-neutral-800 pt-2">
            {auth?.user ? (
              <button
                onClick={() => {
                  onSignOut();
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-base text-neutral-200 active:bg-neutral-900"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={auth.user.avatarUrl}
                  alt={auth.user.login}
                  className="h-6 w-6 rounded-full border border-neutral-700"
                />
                Sign out
                <span className="ml-auto text-xs text-neutral-500">@{auth.user.login}</span>
              </button>
            ) : auth?.configured ? (
              <a
                href={api.authLoginUrl()}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-base text-neutral-200 active:bg-neutral-900"
              >
                <span className="text-xl">👤</span>
                Sign in with GitHub
              </a>
            ) : null}
            <div className="px-4 pt-2">
              <HealthBadge health={health} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Profile({ auth, onSignOut }: { auth: AuthState | null; onSignOut: () => void }) {
  if (!auth) return null;
  if (auth.user) {
    return (
      <button onClick={onSignOut} title="Sign out" className="flex w-full items-center gap-2">
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
