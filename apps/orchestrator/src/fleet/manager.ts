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
import type { FleetStore, ServerRecord } from '../store/fleet.js';

const HEARTBEAT_TIMEOUT_MS = 30_000;
const CHECK_INTERVAL_MS = 10_000;
const HISTORY_LIMIT = 120;

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

export interface RegisterServerArgs {
  name: string;
  address: string;
  tags: string[];
  env: ServerRecord['env'];
  criticality: ServerRecord['criticality'];
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
      tags: args.tags,
      env: args.env,
      criticality: args.criticality,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    this.store.createServer(record);
    logger.info({ id, address: args.address }, 'server registered');
    return this.toServer(record);
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
    if (!this.store.getServer(id)) return false;
    this.store.deleteServer(id);
    this.latest.delete(id);
    this.history.delete(id);
    this.statuses.delete(id);
    this.lastSeenMs.delete(id);
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
    this.bus.publish({ type: 'fleet.metrics', id, metrics, at });
    return true;
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Flip servers whose heartbeat has gone stale to offline. */
  checkStale(): void {
    const now = Date.now();
    for (const server of this.store.listServers()) {
      const last = this.lastSeenMs.get(server.id);
      if (last !== undefined && now - last > HEARTBEAT_TIMEOUT_MS) {
        this.setStatus(server.id, 'offline');
      }
    }
  }

  private setStatus(id: string, status: ServerStatus): void {
    if (this.statuses.get(id) === status) return;
    this.statuses.set(id, status);
    const name = this.store.getServer(id)?.name ?? id;
    this.bus.publish({
      type: 'fleet.server.status',
      id,
      name,
      status,
      at: new Date().toISOString(),
    });
  }

  private toServer(record: ServerRecord): Server {
    return {
      id: record.id,
      name: record.name,
      address: record.address,
      tags: record.tags,
      env: record.env,
      criticality: record.criticality,
      status: this.statuses.get(record.id) ?? 'unknown',
      lastSeenAt: record.lastSeenAt,
      createdAt: record.createdAt,
      metrics: this.latest.get(record.id) ?? null,
    };
  }
}
