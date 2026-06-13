'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { HealthResponse } from '@lumpy/shared';
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
      <HealthBadge health={health} />
    </header>
  );
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
