import { logger } from '../logger.js';
import { collectOverSsh } from '../ssh/collect.js';
import type { FleetManager } from './manager.js';

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls every SSH-configured server on a schedule and feeds the samples into the
 * fleet manager. A failed poll simply produces no sample, so the manager's
 * heartbeat checker marks the server offline on its own.
 */
export class SshMonitor {
  private readonly timer: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();

  constructor(private readonly fleet: FleetManager) {
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private poll(): void {
    for (const { id, target } of this.fleet.sshTargets()) {
      if (this.inFlight.has(id)) continue; // skip a host that's still responding
      this.inFlight.add(id);
      collectOverSsh(target)
        .then((report) => this.fleet.ingest(id, report))
        .catch((error) =>
          logger.warn(
            { id, error: error instanceof Error ? error.message : error },
            'ssh poll failed',
          ),
        )
        .finally(() => this.inFlight.delete(id));
    }
  }
}
