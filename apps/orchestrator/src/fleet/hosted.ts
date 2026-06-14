import type { HostedServiceStatus, ServerHostedService } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { Store } from '../store/sqlite.js';

interface ProbeResult {
  status: HostedServiceStatus;
  statusCode: number | null;
  checkedAt: string;
}

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * Probes the URL of every project's hosted services and resolves them onto the
 * Fleet servers that run them, with live up/down status. Lives outside the
 * FleetManager because the project→server attribution is the projects' data.
 */
export class HostedServicesMonitor {
  private readonly results = new Map<string, ProbeResult>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: Store) {}

  start(): void {
    void this.probeAll();
    this.timer = setInterval(() => void this.probeAll(), PROBE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Distinct hosted-service URLs across all projects. */
  private urls(): string[] {
    const set = new Set<string>();
    for (const project of this.store.listProjects()) {
      for (const svc of project.sources.hostedServices) {
        const url = svc.url.trim();
        if (url) set.add(url);
      }
    }
    return [...set];
  }

  private async probe(url: string): Promise<ProbeResult> {
    const checkedAt = new Date().toISOString();
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return { status: res.status >= 500 ? 'down' : 'up', statusCode: res.status, checkedAt };
    } catch {
      return { status: 'down', statusCode: null, checkedAt };
    }
  }

  private async probeAll(): Promise<void> {
    const urls = this.urls();
    await Promise.all(
      urls.map(async (url) => {
        this.results.set(url, await this.probe(url));
      }),
    );
    // Forget URLs that are no longer referenced by any project.
    for (const url of [...this.results.keys()]) {
      if (!urls.includes(url)) this.results.delete(url);
    }
    if (urls.length) logger.debug({ count: urls.length }, 'hosted services probed');
  }

  /** The hosted services that run on a given server, resolved with live status. */
  forServer(serverId: string): ServerHostedService[] {
    const out: ServerHostedService[] = [];
    for (const project of this.store.listProjects()) {
      for (const svc of project.sources.hostedServices) {
        if (svc.serverId !== serverId) continue;
        const result = this.results.get(svc.url.trim());
        out.push({
          name: svc.name,
          url: svc.url,
          projectId: project.id,
          projectName: project.name,
          status: result?.status ?? 'unknown',
          statusCode: result?.statusCode ?? null,
          checkedAt: result?.checkedAt ?? null,
        });
      }
    }
    return out;
  }
}
