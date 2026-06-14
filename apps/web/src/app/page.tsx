'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type {
  Alert,
  HostedIncident,
  Schedule,
  Server,
  ServerHostedService,
  Session,
} from '@lumpy/shared';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

export default function DashboardPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [incidents, setIncidents] = useState<HostedIncident[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [sv, se, al, sc, inc] = await Promise.all([
        api.listServers(),
        api.listSessions(),
        api.listAlerts(),
        api.listSchedules().catch(() => []),
        api.listIncidents().catch(() => []),
      ]);
      setServers(sv);
      setSessions(se);
      setAlerts(al);
      setSchedules(sc);
      setIncidents(inc);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 6000);
    return () => clearInterval(interval);
  }, [refresh]);

  const cloud = servers.filter((s) => s.kind === 'server');
  const serversOnline = cloud.filter((s) => s.status === 'online').length;
  const serversDown = cloud.filter((s) => s.status === 'offline');
  const services: ServerHostedService[] = servers.flatMap((s) => s.hostedServices);
  const servicesDown = services.filter((s) => s.status === 'down');
  const running = sessions.filter((s) => s.status === 'running');
  const needsYou = running.filter((s) => s.activity === 'awaiting_permission');
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical').length;
  const enabledSchedules = schedules.filter((s) => s.enabled);
  const nextSchedule = enabledSchedules
    .map((s) => s.nextRunAt)
    .filter((x): x is string => Boolean(x))
    .sort()[0];

  const attention =
    serversDown.length + servicesDown.length + alerts.length + needsYou.length;

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Lumpy</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            attention > 0
              ? 'bg-amber-950/40 text-amber-300'
              : 'bg-emerald-950/40 text-emerald-300'
          }`}
        >
          {attention > 0 ? `${attention} need attention` : 'all clear ✅'}
        </span>
      </div>
      {error && (
        <p className="mb-3 text-sm text-red-400">
          {error} — is the orchestrator running on {ORCHESTRATOR_URL}?
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card href="/fleet" title="Servers" stat={`${serversOnline}/${cloud.length}`} hint="online">
          {cloud.length === 0 ? (
            <Empty>No servers yet.</Empty>
          ) : (
            cloud.map((s) => (
              <Row key={s.id} dot={serverDot(s.status)} label={s.name} right={s.status} />
            ))
          )}
        </Card>

        <Card
          href="/fleet"
          title="Hosted services"
          stat={`${services.length - servicesDown.length}/${services.length}`}
          hint="up"
        >
          {services.length === 0 ? (
            <Empty>None tracked yet.</Empty>
          ) : (
            services.map((s, i) => (
              <Row
                key={`${s.url}:${i}`}
                dot={hostedDot(s.status)}
                label={s.name}
                right={s.uptime24h != null ? `${(s.uptime24h * 100).toFixed(s.uptime24h >= 0.9995 ? 0 : 1)}%` : s.status}
              />
            ))
          )}
        </Card>

        <Card
          href="/sessions"
          title="Sessions"
          stat={`${running.length}`}
          hint="running"
          accent={needsYou.length > 0 ? 'amber' : undefined}
        >
          {needsYou.length > 0 && (
            <p className="mb-1 text-xs font-medium text-amber-400">{needsYou.length} need your input</p>
          )}
          {running.length === 0 ? (
            <Empty>Nothing running.</Empty>
          ) : (
            running
              .slice(0, 5)
              .map((s) => (
                <Row
                  key={s.id}
                  dot={s.activity === 'awaiting_permission' ? 'bg-amber-500' : 'bg-blue-500'}
                  label={s.name}
                  right={s.activity === 'awaiting_permission' ? 'needs you' : s.activity}
                />
              ))
          )}
        </Card>

        <Card
          href="/alerts"
          title="Alerts"
          stat={`${alerts.length}`}
          hint="active"
          accent={criticalAlerts > 0 ? 'red' : undefined}
        >
          {alerts.length === 0 ? (
            <Empty>No active alerts.</Empty>
          ) : (
            alerts
              .slice(0, 5)
              .map((a) => (
                <Row
                  key={a.id}
                  dot={a.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}
                  label={`${a.serverName}: ${a.label}`}
                  right={a.severity}
                />
              ))
          )}
        </Card>

        <Card
          href="/schedules"
          title="Schedules"
          stat={`${enabledSchedules.length}`}
          hint="enabled"
        >
          {schedules.length === 0 ? (
            <Empty>No schedules.</Empty>
          ) : (
            enabledSchedules
              .slice(0, 5)
              .map((s) => (
                <Row
                  key={s.id}
                  dot="bg-neutral-500"
                  label={s.name}
                  right={s.nextRunAt ? new Date(s.nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                />
              ))
          )}
          {nextSchedule && (
            <p className="mt-1 text-[11px] text-neutral-600">
              next run {new Date(nextSchedule).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </Card>

        <Card href="/fleet" title="Recent incidents" stat={`${incidents.filter((i) => !i.resolvedAt).length}`} hint="open">
          {incidents.length === 0 ? (
            <Empty>No incidents recorded. 🎉</Empty>
          ) : (
            incidents
              .slice(0, 5)
              .map((i) => (
                <Row
                  key={i.id}
                  dot={i.resolvedAt ? 'bg-neutral-600' : 'bg-red-500'}
                  label={i.name}
                  right={incidentSpan(i)}
                />
              ))
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({
  href,
  title,
  stat,
  hint,
  accent,
  children,
}: {
  href: string;
  title: string;
  stat: string;
  hint: string;
  accent?: 'amber' | 'red';
  children: React.ReactNode;
}) {
  const border =
    accent === 'red'
      ? 'border-red-900/50'
      : accent === 'amber'
        ? 'border-amber-800/50'
        : 'border-neutral-800';
  return (
    <Link
      href={href}
      className={`block rounded-lg border ${border} bg-neutral-950 p-4 transition hover:border-neutral-700`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-300">{title}</h2>
        <span className="text-xs text-neutral-600">
          <span className="text-base font-semibold text-neutral-100">{stat}</span> {hint}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </Link>
  );
}

function Row({ dot, label, right }: { dot: string; label: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-neutral-200">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-xs text-neutral-500">{right}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-neutral-600">{children}</p>;
}

function serverDot(status: string): string {
  return status === 'online' ? 'bg-emerald-500' : status === 'offline' ? 'bg-red-500' : 'bg-neutral-600';
}
function hostedDot(status: string): string {
  return status === 'up' ? 'bg-emerald-500' : status === 'down' ? 'bg-red-500' : 'bg-neutral-600';
}
function incidentSpan(i: HostedIncident): string {
  const start = Date.parse(i.startedAt);
  const end = i.resolvedAt ? Date.parse(i.resolvedAt) : Date.now();
  const mins = Math.max(1, Math.round((end - start) / 60000));
  const dur = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
  return i.resolvedAt ? `${dur} ago` : `down ${dur}`;
}
