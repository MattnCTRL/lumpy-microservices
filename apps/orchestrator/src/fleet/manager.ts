import { customAlphabet } from 'nanoid';
import type {
  MetricsReport,
  Server,
  ServerDetail,
  ServerMetrics,
  ServerStatus,
} from '@lumpy/shared';
import type { EventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import type { FleetStore, ServerRecord, SshCredentials } from '../store/fleet.js';

const HEARTBEAT_TIMEOUT_MS = 30_000;
const CHECK_INTERVAL_MS = 10_000;
const HISTORY_LIMIT = 120;

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

export interface RegisterServerArgs {
  name: string;
  address: string;
  kind: ServerRecord['kind'];
  tags: string[];
  env: ServerRecord['env'];
  criticality: ServerRecord['criticality'];
  ssh?: SshCredentials | null;
}

export class FleetManager {
  private readonly latest = new Map<string, ServerMetrics>();
  private readonly history = new Map<string, ServerMetrics[]>();
  private readonly statuses = new Map<string, ServerStatus>();
  private readonly lastSeenMs = new Map<string, number>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly store: FleetStore,
    private readonly bus: EventBus,
  ) {
    for (const server of this.store.listServers()) {
      if (server.lastSeenAt) this.lastSeenMs.set(server.id, Date.parse(server.lastSeenAt));
    }
    this.timer = setInterval(() => this.checkStale(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  register(args: RegisterServerArgs): Server {
    const id = generateId();
    const record: ServerRecord = {
      id,
      name: args.name,
      address: args.address,
      kind: args.kind,
      tags: args.tags,
      env: args.env,
      criticality: args.criticality,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
      ssh: args.ssh ?? null,
    };
    this.store.createServer(record);
    logger.info({ id, address: args.address, ssh: Boolean(args.ssh) }, 'server registered');
    return this.toServer(record);
  }

  /** Servers configured for agentless SSH polling, with their credentials. */
  sshTargets(): { id: string; target: SshCredentials }[] {
    return this.store
      .listServers()
      .filter((server) => server.ssh !== null)
      .map((server) => ({ id: server.id, target: server.ssh as SshCredentials }));
  }

  rename(id: string, name: string): boolean {
    return this.store.renameServer(id, name);
  }

  setKind(id: string, kind: ServerRecord['kind']): boolean {
    return this.store.setKind(id, kind);
  }

  /** Attach SSH credentials to an existing server so it's monitored agentlessly. */
  configureSsh(id: string, creds: SshCredentials): boolean {
    if (!this.store.getServer(id)) return false;
    return this.store.setSsh(id, creds);
  }

  list(): Server[] {
    return this.store.listServers().map((record) => this.toServer(record));
  }

  get(id: string): ServerDetail | null {
    const record = this.store.getServer(id);
    if (!record) return null;
    return { ...this.toServer(record), history: this.history.get(id) ?? [] };
  }

  remove(id: string): boolean {
    const record = this.store.getServer(id);
    if (!record) return false;
    this.store.deleteServer(id);
    this.latest.delete(id);
    this.history.delete(id);
    this.statuses.delete(id);
    this.lastSeenMs.delete(id);
    this.bus.publish({
      type: 'fleet.server.removed',
      id,
      name: record.name,
      at: new Date().toISOString(),
    });
    logger.info({ id }, 'server removed');
    return true;
  }

  ingest(id: string, report: MetricsReport): boolean {
    if (!this.store.getServer(id)) return false;

    const at = new Date().toISOString();
    const metrics: ServerMetrics = { at, ...report };

    this.latest.set(id, metrics);
    const series = this.history.get(id) ?? [];
    series.push(metrics);
    if (series.length > HISTORY_LIMIT) series.shift();
    this.history.set(id, series);

    this.lastSeenMs.set(id, Date.now());
    this.store.markSeen(id, at);
    this.setStatus(id, 'online');
    const name = this.store.getServer(id)?.name ?? id;
    this.bus.publish({ type: 'fleet.metrics', id, name, metrics, at });
    return true;
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Flip cloud servers whose heartbeat has gone stale to offline. */
  checkStale(): void {
    const now = Date.now();
    for (const server of this.store.listServers()) {
      // Only always-on cloud servers use heartbeat staleness. Machines (laptops)
      // and remotes (phones/tablets) sleep, so their status comes from Tailscale
      // presence instead — being agent-less or asleep must not read as "offline".
      if (server.kind !== 'server') continue;
      const last = this.lastSeenMs.get(server.id);
      if (last !== undefined && now - last > HEARTBEAT_TIMEOUT_MS) {
        this.setStatus(server.id, 'offline');
      }
    }
  }

  /**
   * Set online/offline for tailnet devices (machines + remotes) from the set of
   * addresses currently present on the tailnet. Cloud servers are left to their
   * heartbeat. A machine on the tailnet is reachable, so it's online even with
   * no agent; metrics (when an agent is installed) are a separate concern.
   */
  setPresence(onlineAddresses: Set<string>): void {
    for (const server of this.store.listServers()) {
      if (server.kind === 'server') continue;
      this.setStatus(server.id, onlineAddresses.has(server.address) ? 'online' : 'offline');
    }
  }

  private setStatus(id: string, status: ServerStatus): void {
    if (this.statuses.get(id) === status) return;
    this.statuses.set(id, status);
    const record = this.store.getServer(id);
    this.bus.publish({
      type: 'fleet.server.status',
      id,
      name: record?.name ?? id,
      kind: record?.kind ?? 'server',
      status,
      at: new Date().toISOString(),
    });
  }

  private toServer(record: ServerRecord): Server {
    return {
      id: record.id,
      name: record.name,
      address: record.address,
      kind: record.kind,
      tags: record.tags,
      env: record.env,
      criticality: record.criticality,
      status: this.statuses.get(record.id) ?? 'unknown',
      monitoring: record.ssh ? 'ssh' : 'push',
      lastSeenAt: record.lastSeenAt,
      createdAt: record.createdAt,
      metrics: this.latest.get(record.id) ?? null,
      hostedServices: [],
      self: false,
    };
  }
}
