import { connect as tlsConnect } from 'node:tls';
import type { HostedServiceStatus, ServerHostedService } from '@lumpy/shared';
import type { EventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import type { Store } from '../store/sqlite.js';

interface ProbeResult {
  status: HostedServiceStatus;
  statusCode: number | null;
  latencyMs: number | null;
  certDaysLeft: number | null;
  checkedAt: string;
}

interface ServiceRef {
  url: string;
  name: string;
  projectId: string;
  projectName: string;
}

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const CERT_WARN_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * Probes the URL of every project's hosted services and resolves them onto the
 * Fleet servers that run them — with live status, latency, TLS-cert expiry, and
 * 24h uptime computed from recorded incidents. Status transitions open/resolve
 * incidents and publish events (which the notify module turns into push).
 */
export class HostedServicesMonitor {
  private readonly results = new Map<string, ProbeResult>();
  private readonly certWarned = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
  ) {}

  start(): void {
    void this.probeAll();
    this.timer = setInterval(() => void this.probeAll(), PROBE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Distinct hosted services across all projects (first project wins per URL). */
  private services(): ServiceRef[] {
    const out: ServiceRef[] = [];
    const seen = new Set<string>();
    for (const project of this.store.listProjects()) {
      for (const svc of project.sources.hostedServices) {
        const url = svc.url.trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({ url, name: svc.name, projectId: project.id, projectName: project.name });
      }
    }
    return out;
  }

  private async probe(url: string): Promise<ProbeResult> {
    const checkedAt = new Date().toISOString();
    const startMs = Date.now();
    let status: HostedServiceStatus = 'down';
    let statusCode: number | null = null;
    let latencyMs: number | null = null;
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      latencyMs = Date.now() - startMs;
      statusCode = res.status;
      status = res.status >= 500 ? 'down' : 'up';
    } catch {
      status = 'down';
    }
    const certDaysLeft = url.startsWith('https://') ? await this.certDays(url) : null;
    return { status, statusCode, latencyMs, certDaysLeft, checkedAt };
  }

  /** Days until the TLS certificate at a URL expires, via a TLS handshake. */
  private certDays(url: string): Promise<number | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value: number | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      try {
        const u = new URL(url);
        const socket = tlsConnect(
          {
            host: u.hostname,
            port: Number(u.port) || 443,
            servername: u.hostname,
            timeout: PROBE_TIMEOUT_MS,
          },
          () => {
            const cert = socket.getPeerCertificate();
            socket.end();
            if (!cert || !cert.valid_to) return done(null);
            const days = Math.floor((Date.parse(cert.valid_to) - Date.now()) / DAY_MS);
            done(Number.isFinite(days) ? days : null);
          },
        );
        socket.on('error', () => done(null));
        socket.on('timeout', () => {
          socket.destroy();
          done(null);
        });
      } catch {
        done(null);
      }
    });
  }

  private async probeAll(): Promise<void> {
    const services = this.services();
    const at = new Date().toISOString();
    await Promise.all(
      services.map(async (svc) => {
        const result = await this.probe(svc.url);
        this.results.set(svc.url, result);

        // Up/down transitions are sourced from the incident table so they
        // survive orchestrator restarts (no double-notify on redeploy).
        if (result.status === 'down') {
          const created = this.store.openHostedIncident(
            { ...svc, statusCode: result.statusCode },
            at,
          );
          if (created) {
            this.bus.publish({
              type: 'hosted.status',
              name: svc.name,
              url: svc.url,
              projectName: svc.projectName,
              status: 'down',
              statusCode: result.statusCode,
              at,
            });
          }
        } else if (result.status === 'up') {
          const resolved = this.store.resolveHostedIncident(svc.url, at);
          if (resolved) {
            this.bus.publish({
              type: 'hosted.status',
              name: svc.name,
              url: svc.url,
              projectName: svc.projectName,
              status: 'up',
              statusCode: result.statusCode,
              at,
            });
          }
        }

        // Warn once (per process) when a certificate is near expiry.
        if (result.certDaysLeft != null && result.certDaysLeft <= CERT_WARN_DAYS) {
          if (!this.certWarned.has(svc.url)) {
            this.certWarned.add(svc.url);
            this.bus.publish({
              type: 'hosted.cert',
              name: svc.name,
              url: svc.url,
              projectName: svc.projectName,
              daysLeft: result.certDaysLeft,
              at,
            });
          }
        } else {
          this.certWarned.delete(svc.url);
        }
      }),
    );

    // Forget URLs no longer referenced by any project.
    const live = new Set(services.map((s) => s.url));
    for (const url of [...this.results.keys()]) if (!live.has(url)) this.results.delete(url);
    if (services.length) logger.debug({ count: services.length }, 'hosted services probed');
  }

  /** The hosted services that run on a given server, resolved with live status. */
  forServer(serverId: string): ServerHostedService[] {
    const out: ServerHostedService[] = [];
    const now = Date.now();
    for (const project of this.store.listProjects()) {
      for (const svc of project.sources.hostedServices) {
        if (svc.serverId !== serverId) continue;
        const url = svc.url.trim();
        const result = this.results.get(url);
        out.push({
          name: svc.name,
          url: svc.url,
          projectId: project.id,
          projectName: project.name,
          status: result?.status ?? 'unknown',
          statusCode: result?.statusCode ?? null,
          checkedAt: result?.checkedAt ?? null,
          latencyMs: result?.latencyMs ?? null,
          uptime24h: url ? this.store.hostedUptime(url, now - DAY_MS, now) : null,
          certDaysLeft: result?.certDaysLeft ?? null,
          lastChangeAt: url ? this.store.hostedLastChange(url) : null,
        });
      }
    }
    return out;
  }
}
