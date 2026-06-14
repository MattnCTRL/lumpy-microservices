import type { LumpyEvent } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';

/** Map an event to a feed entry, or null if it's not worth recording. */
function describe(event: LumpyEvent): { kind: string; title: string } | null {
  switch (event.type) {
    case 'session.status':
      return {
        kind: 'session',
        title: `Session ${event.status === 'running' ? 'started' : 'stopped'}: ${event.name}`,
      };
    case 'alert.fired':
      return { kind: 'alert', title: `Alert: ${event.alert.serverName} — ${event.alert.label}` };
    case 'alert.resolved':
      return { kind: 'alert', title: `Resolved: ${event.serverName} — ${event.label}` };
    case 'remediation.started':
      return { kind: 'remediation', title: `Remediation (${event.mode}): ${event.serverName}` };
    case 'hosted.status':
      return {
        kind: 'hosted',
        title: `${event.status === 'down' ? 'DOWN' : 'Recovered'}: ${event.name}`,
      };
    case 'hosted.cert':
      return { kind: 'cert', title: `Cert expiring: ${event.name} (${event.daysLeft}d)` };
    default:
      return null;
  }
}

/**
 * Activity feed: subscribes to the event spine and records noteworthy events to
 * an append-only audit trail, surfaced on the dashboard and at /api/activity.
 */
export const activityModule: LumpyModule = {
  id: 'activity',
  name: 'Activity Feed',
  version: '0.1.0',
  description: 'Append-only audit trail of noteworthy platform events.',
  register(ctx: ModuleContext) {
    ctx.bus.subscribe((event) => {
      const entry = describe(event);
      if (entry) ctx.store.appendActivity(entry.kind, entry.title, event.at);
    });

    ctx.app.get('/api/activity', async () => ctx.store.listActivity(100));

    logger.info('activity module ready');
  },
};
