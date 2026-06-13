'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  LumpyEvent,
  Server,
  ServerCriticality,
  ServerEnv,
  ServerMetrics,
  ServerStatus,
} from '@lumpy/shared';
import { Field } from '@/components/Field';
import { Sparkline } from '@/components/Sparkline';
import { api, fleetSocketUrl, ORCHESTRATOR_URL } from '@/lib/api';

export default function FleetPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [histories, setHistories] = useState<Record<string, ServerMetrics[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listServers();
      setServers(list);
      setError(null);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'orchestrator unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const socket = new WebSocket(fleetSocketUrl());
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as LumpyEvent;
      if (message.type === 'fleet.metrics') {
        setServers((prev) =>
          prev.map((s) =>
            s.id === message.id
              ? { ...s, metrics: message.metrics, lastSeenAt: message.metrics.at, status: 'online' }
              : s,
          ),
        );
        setHistories((prev) => ({
          ...prev,
          [message.id]: [...(prev[message.id] ?? []), message.metrics].slice(-120),
        }));
      } else if (message.type === 'fleet.server.status') {
        setServers((prev) =>
          prev.map((s) => (s.id === message.id ? { ...s, status: message.status } : s)),
        );
      }
    };
    return () => socket.close();
  }, []);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const detail = await api.getServer(id);
      setHistories((prev) => ({ ...prev, [id]: detail.history }));
      setServers((prev) => prev.map((s) => (s.id === id ? detail : s)));
    } catch {
      // Selection still works from the list data we already have.
    }
  }, []);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="bg-red-950/60 px-4 py-2 text-sm text-red-300">
          {error} — is the orchestrator running on {ORCHESTRATOR_URL}?
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-neutral-800 p-3 md:w-80 md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Servers</h2>
            <button
              onClick={() => setAdding(true)}
              className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
            >
              Add
            </button>
          </div>
          <ServerList
            servers={servers}
            selectedId={selectedId}
            onSelect={(id) => void select(id)}
          />
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          {selected ? (
            <ServerDetailPanel
              server={selected}
              history={histories[selected.id] ?? []}
              onDelete={async () => {
                await api.deleteServer(selected.id);
                setSelectedId(null);
                void refresh();
              }}
            />
          ) : (
            <EmptyState onAdd={() => setAdding(true)} />
          )}
        </main>
      </div>

      {adding && (
        <AddServerDialog
          onClose={() => setAdding(false)}
          onAdded={(server) => {
            setAdding(false);
            setSelectedId(server.id);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

const STATUS_STYLE: Record<ServerStatus, { dot: string; label: string }> = {
  online: { dot: 'bg-emerald-500', label: 'online' },
  offline: { dot: 'bg-red-500', label: 'offline' },
  unknown: { dot: 'bg-neutral-600', label: 'unknown' },
};

function StatusBadge({ status }: { status: ServerStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function ServerList({
  servers,
  selectedId,
  onSelect,
}: {
  servers: Server[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (servers.length === 0) {
    return <p className="px-1 py-2 text-sm text-neutral-500">No servers yet.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {servers.map((server) => (
        <li key={server.id}>
          <button
            onClick={() => onSelect(server.id)}
            className={`w-full rounded-md border px-3 py-2 text-left transition ${
              server.status === 'offline'
                ? 'border-red-900/60 bg-red-950/20'
                : server.id === selectedId
                  ? 'border-neutral-600 bg-neutral-900'
                  : 'border-transparent hover:bg-neutral-900/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-neutral-100">{server.name}</span>
              <StatusBadge status={server.status} />
            </div>
            <div className="mt-1 truncate text-xs text-neutral-500">{server.address}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ServerDetailPanel({
  server,
  history,
  onDelete,
}: {
  server: Server;
  history: ServerMetrics[];
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-neutral-100">{server.name}</h2>
          <p className="truncate text-xs text-neutral-500">
            {server.address} · {server.env} · {server.criticality} ·{' '}
            {server.lastSeenAt
              ? `seen ${new Date(server.lastSeenAt).toLocaleTimeString()}`
              : 'never seen'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={server.status} />
          <button
            onClick={onDelete}
            className="text-xs text-neutral-500 hover:text-red-400"
            title="Remove server"
          >
            remove
          </button>
        </div>
      </div>

      {server.metrics ? (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              label="CPU"
              value={server.metrics.cpuPercent}
              unit="%"
              series={history.map((m) => m.cpuPercent)}
            />
            <MetricCard
              label="Memory"
              value={server.metrics.memPercent}
              unit="%"
              series={history.map((m) => m.memPercent)}
            />
            <MetricCard
              label="Disk"
              value={server.metrics.diskPercent}
              unit="%"
              series={history.map((m) => m.diskPercent)}
            />
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-neutral-300">
            <Stat label="Load (1m)" value={server.metrics.load1.toFixed(2)} />
            <Stat label="Uptime" value={formatUptime(server.metrics.uptimeSeconds)} />
          </div>
        </div>
      ) : (
        <div className="p-6 text-sm text-neutral-500">
          No metrics reported yet. Point an agent at{' '}
          <code className="text-neutral-400">POST /api/fleet/servers/{server.id}/metrics</code>.
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  series,
}: {
  label: string;
  value: number;
  unit: string;
  series: number[];
}) {
  const high = value >= 90;
  const elevated = value >= 75;
  const barColor = high ? 'bg-red-500' : elevated ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor = high ? 'text-red-400' : elevated ? 'text-amber-400' : 'text-neutral-200';
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-400">{label}</span>
        <span className={`text-lg font-semibold ${textColor}`}>
          {value.toFixed(0)}
          <span className="text-xs text-neutral-500">{unit}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <Sparkline values={series} className="mt-2 h-8 w-full text-neutral-600" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-neutral-500">{label}: </span>
      <span className="text-neutral-200">{value}</span>
    </span>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-neutral-500">
      <p className="text-sm">No server selected. Register one to start monitoring.</p>
      <button
        onClick={onAdd}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
      >
        Add server
      </button>
    </div>
  );
}

function AddServerDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (server: Server) => void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [env, setEnv] = useState<ServerEnv>('prod');
  const [criticality, setCriticality] = useState<ServerCriticality>('medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const server = await api.createServer({
        name: name.trim(),
        address: address.trim(),
        env,
        criticality,
      });
      onAdded(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add server');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-950 p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-neutral-100">Add server</h2>
        <div className="space-y-3">
          <Field label="Name">
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="web-1"
              className="input"
            />
          </Field>
          <Field label="Address" hint="Tailscale IP or hostname">
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="100.x.y.z"
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Environment">
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value as ServerEnv)}
                className="input"
              >
                <option value="prod">prod</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
              </select>
            </Field>
            <Field label="Criticality">
              <select
                value={criticality}
                onChange={(e) => setCriticality(e.target.value as ServerCriticality)}
                className="input"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Field>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0 || address.trim().length === 0}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add server'}
          </button>
        </div>
      </form>
    </div>
  );
}
