import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { buildRemediationTask } from './task.js';

/**
 * Closes the loop: when an alert fires, spin up an autonomous Claude session to
 * investigate (and, in `auto` mode, remediate) it. One session per active alert;
 * cleared when the alert resolves. Controlled by LUMPY_REMEDIATION_MODE.
 */
export const remediationModule: LumpyModule = {
  id: 'remediation',
  name: 'Remediation',
  version: '0.1.0',
  description: 'Spawns autonomous Claude sessions to investigate or fix alerts.',
  register(ctx: ModuleContext) {
    const mode = ctx.config.remediationMode;
    if (mode === 'off') {
      logger.info('remediation disabled (set LUMPY_REMEDIATION_MODE to investigate or auto)');
      return;
    }

    const handling = new Set<string>();

    ctx.bus.subscribe((event) => {
      if (event.type === 'alert.resolved') {
        handling.delete(event.id);
        return;
      }
      if (event.type !== 'alert.fired') return;

      const alert = event.alert;
      if (handling.has(alert.id)) return;
      handling.add(alert.id);

      void (async () => {
        try {
          const session = await ctx.sessions.create({
            name: `${mode === 'auto' ? 'Fix' : 'Investigate'}: ${alert.serverName} — ${alert.label}`,
            workspace: ctx.config.workspaceRoot,
            command: ctx.config.defaultCommand,
            tags: ['remediation'],
            autonomous: true,
            task: buildRemediationTask(alert, mode),
          });
          ctx.bus.publish({
            type: 'remediation.started',
            alertId: alert.id,
            sessionId: session.id,
            serverName: alert.serverName,
            mode,
            at: new Date().toISOString(),
          });
          logger.warn(
            { alert: alert.id, session: session.id, mode },
            'remediation session started',
          );
        } catch (error) {
          handling.delete(alert.id);
          logger.error({ alert: alert.id, error }, 'remediation failed to start');
        }
      })();
    });

    logger.info({ mode }, 'remediation enabled');
  },
};
