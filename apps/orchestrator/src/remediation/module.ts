import type { Alert } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { DEFAULT_PLAYBOOKS, findPlaybook } from './playbooks.js';
import { buildRemediationTask } from './task.js';

/**
 * Closes the loop: when an alert fires, handle it with an autonomous Claude
 * session. Tiered by severity — auto-run for the configured severities, others
 * wait for one-tap approval. Mode/policy are read live from settings, so they can
 * be changed from the UI without a restart.
 */
export const remediationModule: LumpyModule = {
  id: 'remediation',
  name: 'Remediation',
  version: '0.1.0',
  description: 'Autonomous Claude sessions to investigate or fix alerts, tiered by severity.',
  register(ctx: ModuleContext) {
    const handling = new Set<string>(); // already acted on
    const pending = new Map<string, Alert>(); // awaiting approval

    const start = async (alert: Alert, mode: 'investigate' | 'auto'): Promise<void> => {
      try {
        const session = await ctx.sessions.create({
          name: `${mode === 'auto' ? 'Fix' : 'Investigate'}: ${alert.serverName} — ${alert.label}`,
          // Omit workspace so each remediation session is isolated in its own dir.
          command: ctx.config.defaultCommand,
          tags: ['remediation'],
          autonomous: true,
          task: buildRemediationTask(alert, mode, findPlaybook(alert.ruleId)?.task),
        });
        ctx.bus.publish({
          type: 'remediation.started',
          alertId: alert.id,
          sessionId: session.id,
          serverName: alert.serverName,
          mode,
          at: new Date().toISOString(),
        });
        logger.warn({ alert: alert.id, session: session.id, mode }, 'remediation session started');
      } catch (error) {
        handling.delete(alert.id);
        logger.error({ alert: alert.id, error }, 'remediation failed to start');
      }
    };

    ctx.app.get('/api/playbooks', async () => DEFAULT_PLAYBOOKS);

    ctx.app.post('/api/remediation/:id/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const alert = pending.get(id);
      if (!alert) return reply.status(404).send({ error: 'no pending remediation for this alert' });
      pending.delete(id);
      handling.add(id);
      await start(alert, ctx.settings.get().remediationMode === 'auto' ? 'auto' : 'investigate');
      return reply.status(202).send();
    });

    ctx.bus.subscribe((event) => {
      if (event.type === 'alert.resolved') {
        handling.delete(event.id);
        pending.delete(event.id);
        return;
      }
      if (event.type !== 'alert.fired') return;

      const { remediationMode: mode, remediationAutoSeverities } = ctx.settings.get();
      if (mode === 'off') return;

      const alert = event.alert;
      if (handling.has(alert.id) || pending.has(alert.id)) return;

      const playbook = findPlaybook(alert.ruleId);
      const autoOk =
        remediationAutoSeverities.includes(alert.severity) && !playbook?.requiresApproval;
      if (autoOk) {
        handling.add(alert.id);
        void start(alert, mode);
      } else {
        pending.set(alert.id, alert);
        ctx.bus.publish({
          type: 'remediation.pending',
          alertId: alert.id,
          serverName: alert.serverName,
          severity: alert.severity,
          label: alert.label,
          at: new Date().toISOString(),
        });
        logger.warn({ alert: alert.id, severity: alert.severity }, 'remediation awaiting approval');
      }
    });

    logger.info('remediation module ready (mode from settings)');
  },
};
