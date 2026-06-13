'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  FleetMounts,
  FleetNodeKind,
  LumpyEvent,
  MountState,
  Server,
  ServerCriticality,
  ServerEnv,
  ServerMetrics,
  ServerStatus,
  TailnetDevice,
} from '@lumpy/shared';
import { Field } from '@/components/Field';
import { Sparkline } from '@/components/Sparkline';
import { api, fleetSocketUrl, ORCHESTRATOR_URL } from '@/lib/api';
import { reconnectingSocket } from '@/lib/socket';

export default function FleetPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [histories, setHistories] = useState<Record<string, ServerMetrics[]>>({});
  const [mounts, setMounts] = useState<FleetMounts>({});
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
    const load = () =>
      api
        .getMounts()
        .then(setMounts)
        .catch(() => {});
    void load();
    const interval = setInterval(() => void load(), 7000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handle = reconnectingSocket(fleetSocketUrl(), (data) => {
      const message = JSON.parse(data) as LumpyEvent;
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
    });
    return () => handle.close();
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
        <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-b border-neutral-800 p-3 md:w-80 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Fleet</h2>
            <button
              onClick={() => setAdding(true)}
              className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
            >
              Add
            </button>
          </div>
          <FleetGroup
            title="Servers"
            empty="No servers yet."
            servers={servers.filter((s) => s.kind === 'server')}
            mounts={mounts}
            selectedId={selectedId}
            onSelect={(id) => void select(id)}
          />
          <FleetGroup
            title="Machines"
            empty="No machines yet."
            servers={servers.filter((s) => s.kind === 'machine')}
            mounts={mounts}
            selectedId={selectedId}
            onSelect={(id) => void select(id)}
          />
          <FleetGroup
            title="Remotes"
            empty="No remotes yet."
            servers={servers.filter((s) => s.kind === 'remote')}
            mounts={mounts}
            selectedId={selectedId}
            onSelect={(id) => void select(id)}
          />
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          {selected ? (
            <ServerDetailPanel
              server={selected}
              mount={mounts[selected.id]}
              history={histories[selected.id] ?? []}
              onChanged={() => void refresh()}
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

const KIND_ICON: Record<FleetNodeKind, string> = {
  server: '🖥',
  machine: '💻',
  remote: '📱',
};

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

function FleetGroup({
  title,
  empty,
  servers,
  mounts,
  selectedId,
  onSelect,
}: {
  title: string;
  empty: string;
  servers: Server[];
  mounts: FleetMounts;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </span>
        <span className="text-xs text-neutral-600">{servers.length}</span>
      </div>
      {servers.length === 0 ? (
        <p className="px-1 py-1 text-sm text-neutral-600">{empty}</p>
      ) : (
        <ServerList
          servers={servers}
          mounts={mounts}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function ServerList({
  servers,
  mounts,
  selectedId,
  onSelect,
}: {
  servers: Server[];
  mounts: FleetMounts;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
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
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-neutral-500">{server.address}</span>
              <MountBadge mount={mounts[server.id]} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MountBadge({ mount }: { mount: MountState | undefined }) {
  if (!mount?.mounted) return null;
  return (
    <span
      className={`flex shrink-0 items-center gap-1 text-xs ${
        mount.healthy ? 'text-sky-400' : 'text-amber-400'
      }`}
      title={mount.healthy ? 'Files mounted and responsive' : 'Mount stalled (host asleep?)'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${mount.healthy ? 'bg-sky-400' : 'bg-amber-400'}`} />
      {mount.healthy ? 'mounted' : 'mount stalled'}
    </span>
  );
}

function ServerDetailPanel({
  server,
  mount,
  history,
  onChanged,
  onDelete,
}: {
  server: Server;
  mount: MountState | undefined;
  history: ServerMetrics[];
  onChanged: () => void;
  onDelete: () => void;
}) {
  const rename = async () => {
    const next = window.prompt('Rename', server.name);
    if (next && next.trim() && next.trim() !== server.name) {
      await api.renameServer(server.id, next.trim());
      onChanged();
    }
  };

  const changeKind = async (kind: FleetNodeKind) => {
    if (kind === server.kind) return;
    await api.setServerKind(server.id, kind);
    onChanged();
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-neutral-100">{server.name}</h2>
          <p className="truncate text-xs text-neutral-500">
            {server.kind} · {server.address} · {server.monitoring === 'ssh' ? 'SSH' : 'agent'} ·{' '}
            {server.env} · {server.criticality} ·{' '}
            {server.lastSeenAt
              ? `seen ${new Date(server.lastSeenAt).toLocaleTimeString()}`
              : 'never seen'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MountBadge mount={mount} />
          <StatusBadge status={server.status} />
          <select
            value={server.kind}
            onChange={(e) => void changeKind(e.target.value as FleetNodeKind)}
            title="Change type"
            className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-300"
          >
            <option value="server">server</option>
            <option value="machine">machine</option>
            <option value="remote">remote</option>
          </select>
          <button onClick={rename} className="text-xs text-neutral-500 hover:text-neutral-200">
            rename
          </button>
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
      <p className="text-sm">No machine selected. Add one to start monitoring.</p>
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
  const [mode, setMode] = useState<'ssh' | 'manual'>('ssh');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FleetNodeKind>('server');
  const [env, setEnv] = useState<ServerEnv>('prod');
  const [criticality, setCriticality] = useState<ServerCriticality>('medium');

  // SSH
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('root');
  const [authType, setAuthType] = useState<'key' | 'password'>('key');
  const [secret, setSecret] = useState('');

  // Manual
  const [address, setAddress] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<TailnetDevice[]>([]);

  useEffect(() => {
    api
      .discoverDevices()
      .then(setDiscovered)
      .catch(() => setDiscovered([]));
  }, []);

  const pick = (d: TailnetDevice) => {
    setName(d.name);
    setKind(d.kind);
    setMode('manual');
    setAddress(d.address);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const server =
        mode === 'ssh'
          ? await api.createServer({
              name: name.trim(),
              address: host.trim(),
              kind,
              env,
              criticality,
              ssh: {
                host: host.trim(),
                port: Number(port) || 22,
                user: user.trim(),
                privateKey: authType === 'key' ? secret : undefined,
                password: authType === 'password' ? secret : undefined,
              },
            })
          : await api.createServer({
              name: name.trim(),
              address: address.trim(),
              kind,
              env,
              criticality,
            });
      onAdded(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add server');
      setSubmitting(false);
    }
  };

  const ready =
    name.trim().length > 0 &&
    (mode === 'ssh' ? host.trim() && user.trim() && secret.trim() : address.trim().length > 0);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-950 p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-neutral-100">Add to fleet</h2>

        {discovered.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              On your tailnet — tap to fill
            </p>
            <div className="flex flex-wrap gap-1.5">
              {discovered.map((d) => (
                <button
                  key={d.address}
                  type="button"
                  onClick={() => pick(d)}
                  title={`${d.address} · ${d.os || 'unknown OS'}${d.online ? '' : ' · offline'}`}
                  className="flex items-center gap-1.5 rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
                  {d.name}
                  <span className="text-neutral-500">{KIND_ICON[d.kind]}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-600">
              Machines need the agent — see the install command in the docs after adding.
            </p>
          </div>
        )}

        <div className="mb-4 flex gap-1 rounded-md border border-neutral-800 p-1 text-sm">
          <ModeTab active={mode === 'ssh'} onClick={() => setMode('ssh')}>
            Connect via SSH
          </ModeTab>
          <ModeTab active={mode === 'manual'} onClick={() => setMode('manual')}>
            Manual / agent
          </ModeTab>
        </div>

        {mode === 'ssh' && (
          <p className="mb-3 text-xs text-neutral-500">
            Lumpy connects over SSH and monitors the server for you — no agent to install. The
            connection is tested before the server is added.
          </p>
        )}

        <div className="space-y-3">
          <Field label="Name" hint="a friendly label, e.g. Nublear">
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nublear"
              className="input"
            />
          </Field>

          {mode === 'ssh' ? (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <Field label="Host" hint="Tailscale IP or public address">
                  <input
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="100.81.90.46"
                    className="input"
                  />
                </Field>
                <Field label="Port">
                  <input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="input w-20"
                  />
                </Field>
              </div>
              <Field label="SSH user">
                <input
                  required
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="root"
                  className="input"
                />
              </Field>
              <Field label="Authentication">
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as 'key' | 'password')}
                  className="input"
                >
                  <option value="key">Private key</option>
                  <option value="password">Password</option>
                </select>
              </Field>
              <Field
                label={authType === 'key' ? 'Private key (PEM)' : 'Password'}
                hint={authType === 'key' ? 'paste the contents of your private key' : undefined}
              >
                {authType === 'key' ? (
                  <textarea
                    required
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="input h-28 font-mono text-xs"
                  />
                ) : (
                  <input
                    required
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="input"
                  />
                )}
              </Field>
            </>
          ) : (
            <Field label="Address" hint="Tailscale IP or hostname (push/agent monitoring)">
              <input
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="100.x.y.z"
                className="input"
              />
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Type">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as FleetNodeKind)}
                className="input"
              >
                <option value="server">server</option>
                <option value="machine">machine</option>
                <option value="remote">remote</option>
              </select>
            </Field>
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
            disabled={submitting || !ready}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {submitting
              ? mode === 'ssh'
                ? 'Connecting…'
                : 'Adding…'
              : mode === 'ssh'
                ? `Connect & add ${kind}`
                : `Add ${kind}`}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1.5 transition ${
        active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  );
}
