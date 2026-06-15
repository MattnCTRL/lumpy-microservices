import { chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Alert, Server } from '@lumpy/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { conductorWorkspacePath } from '../sessions/conductor.js';
import { resolveRunAs } from '../sessions/runas.js';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;
const SWEEP_INTERVAL_MS = 30 * 60_000;
const SWEEP_MAX_CHARS = 40_000;

interface Digest {
  title: string;
  message: string;
  priority: number;
}

/**
 * Daily digest: a once-a-day platform summary pushed to the phone - fleet
 * health, hosted-service uptime, sessions needing input, active alerts, and
 * upcoming schedules. Composed from the fully-resolved API so it sees the same
 * state the UI does.
 */
export const digestModule: LumpyModule = {
  id: 'digest',
  name: 'Daily Digest',
  version: '0.1.0',
  description: 'Pushes a once-a-day platform health summary.',
  register(ctx: ModuleContext) {
    const { app, store, bus } = ctx;

    const base = config.publicUrl || `http://${config.host}:${config.port}`;
    const apiGet = async <T>(path: string): Promise<T | null> => {
      try {
        const res = await fetch(`${base}${path}`, {
          headers: { 'x-lumpy-admin-token': config.adminToken },
        });
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };

    const compose = async (): Promise<Digest> => {
      const now = Date.now();
      const servers = (await apiGet<Server[]>('/api/fleet/servers')) ?? [];
      const alerts = (await apiGet<Alert[]>('/api/alerts')) ?? [];
      const sessions = await ctx.sessions.list();
      const schedules = store.listSchedules();
      const incidents = store.listHostedIncidents(200);

      // Cloud servers only - machines/remotes are personal devices that sleep.
      const nodes = servers.filter((s) => s.kind === 'server');
      const offline = nodes.filter((s) => s.status === 'offline');
      const onlineCount = nodes.filter((s) => s.status === 'online').length;

      // Hosted services (resolved with live status onto their servers).
      const services = servers.flatMap((s) => s.hostedServices);
      const down = services.filter((s) => s.status === 'down');
      const upCount = services.filter((s) => s.status === 'up').length;
      const inc24 = incidents.filter((i) => Date.parse(i.startedAt) >= now - DAY_MS).length;

      // Sessions.
      const running = sessions.filter((s) => s.status === 'running');
      const needsYou = running.filter((s) => s.activity === 'awaiting_permission');

      // Alerts.
      const critical = alerts.filter((a) => a.severity === 'critical').length;

      // Schedules.
      const enabled = schedules.filter((s) => s.enabled);
      const upcoming = enabled
        .map((s) => s.nextRunAt)
        .filter((x): x is string => Boolean(x))
        .sort()[0];
      const nextTime = upcoming
        ? new Date(upcoming).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

      const lines = [
        `🖥 Servers: ${onlineCount}/${nodes.length} online${
          offline.length ? ` · down: ${offline.map((s) => s.name).join(', ')}` : ''
        }`,
        `🌐 Services: ${upCount} up, ${down.length} down${
          down.length ? ` (${down.map((s) => s.name).join(', ')})` : ''
        } · ${inc24} incident${inc24 === 1 ? '' : 's'}/24h`,
        `⌨ Sessions: ${running.length} running${needsYou.length ? ` · ${needsYou.length} need you` : ''}`,
        `🔔 Alerts: ${alerts.length} active${critical ? ` (${critical} critical)` : ''}`,
        `⏰ Schedules: ${enabled.length} on${nextTime ? ` · next ${nextTime}` : ''}`,
      ];

      const attention =
        offline.length + down.length + alerts.length + needsYou.length;
      return {
        title: attention > 0 ? `Lumpy - ${attention} need attention` : 'Lumpy - all clear ✅',
        message: lines.join('\n'),
        priority: attention > 0 ? 4 : 3,
      };
    };

    const send = async (): Promise<Digest> => {
      const digest = await compose();
      bus.publish({ type: 'digest', ...digest, at: new Date().toISOString() });
      return digest;
    };

    // Silent periodic sweep: write a health snapshot to a report file and stay
    // out of the way. Real problems already raise their own alerts; this is the
    // quiet audit trail, not chat noise.
    let runAs: ReturnType<typeof resolveRunAs> | null = null;
    try {
      if (config.sessionUser) runAs = resolveRunAs(config.sessionUser);
    } catch {
      runAs = null;
    }
    const reportDir = join(conductorWorkspacePath(), '.lumpy');
    const reportPath = join(reportDir, 'SWEEPS.md');

    const sweep = async (): Promise<void> => {
      const digest = await compose();
      const stamp = `${new Date().toISOString().slice(0, 16)}Z`;
      const entry = `\n## ${stamp} - ${digest.title}\n${digest.message}\n`;
      try {
        mkdirSync(reportDir, { recursive: true });
        let content = existsSync(reportPath)
          ? readFileSync(reportPath, 'utf8')
          : '# Lumpy platform sweeps\n';
        content += entry;
        if (content.length > SWEEP_MAX_CHARS) {
          const cut = content.indexOf('\n## ', content.length - SWEEP_MAX_CHARS);
          content = `# Lumpy platform sweeps\n${cut >= 0 ? content.slice(cut) : content.slice(-SWEEP_MAX_CHARS)}`;
        }
        writeFileSync(reportPath, content);
        if (runAs) {
          try {
            chownSync(reportDir, runAs.uid, runAs.gid);
            chownSync(reportPath, runAs.uid, runAs.gid);
          } catch {
            // best-effort
          }
        }
      } catch (error) {
        logger.warn({ error }, 'could not write sweep report');
      }
    };
    // Delay the first sweep so the HTTP server is listening before we read it.
    const firstSweep = setTimeout(() => void sweep(), 30_000);
    firstSweep.unref();
    const sweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
    sweepTimer.unref();

    app.get('/api/sweeps', async () => ({
      report: existsSync(reportPath) ? readFileSync(reportPath, 'utf8').slice(-SWEEP_MAX_CHARS) : '',
    }));

    // Fire once a day at the configured UTC hour.
    const hour = Number.parseInt(config.digestHour, 10);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      let lastSentDay = '';
      const tick = (): void => {
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        if (now.getUTCHours() === hour && now.getUTCMinutes() === 0 && lastSentDay !== day) {
          lastSentDay = day;
          logger.info({ hour }, 'pushing daily digest');
          void send();
        }
      };
      const timer = setInterval(tick, TICK_MS);
      timer.unref();
      logger.info({ hour }, 'daily digest scheduled');
    }

    // Preview without sending.
    app.get('/api/digest', async () => compose());
    // Compose and push now.
    app.post('/api/digest/send', async () => send());

    logger.info('digest module ready');
  },
};
