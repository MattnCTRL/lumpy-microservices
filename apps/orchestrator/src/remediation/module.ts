import type { Alert } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { secondOpinionGate } from '../secondopinion/consult.js';
import { SessionCapacityError } from '../sessions/manager.js';
import { DEFAULT_PLAYBOOKS, findPlaybook } from './playbooks.js';
import { buildRemediationTask } from './task.js';

/** Frame an impending auto-remediation for a Codex second opinion. */
function buildGatePrompt(alert: Alert, mode: 'investigate' | 'auto'): string {
  const playbook = findPlaybook(alert.ruleId);
  return [
    `Lumpy is about to AUTONOMOUSLY ${mode === 'auto' ? 'FIX' : 'investigate'} an alert by`,
    'launching an unattended agent, with no human in the loop.',
    '',
    `Server: ${alert.serverName}`,
    `Alert: ${alert.label} (severity: ${alert.severity}, rule: ${alert.ruleId})`,
    '',
    'The agent will be given this task:',
    '---',
    buildRemediationTask(alert, mode, playbook?.task),
    '---',
    '',
    mode === 'auto'
      ? 'Should this fix run automatically, without a human reviewing it first?'
      : 'Should this investigation run automatically?',
  ].join('\n');
}

/**
 * Closes the loop: when an alert fires, handle it with an autonomous Claude
 * session. Tiered by severity - auto-run for the configured severities, others
 * wait for one-tap approval. Mode/policy are read live from settings, so they can
 * be changed from the UI without a restart.
 */
export const remediationModule: LumpyModule = {
  id: 'remediation',
  name: 'Remediation',
  version: '0.1.0',
  description: 'Autonomous Claude sessions to investigate or fix alerts, tiered by severity.',
  register(ctx: ModuleContext) {
    // A pending hold older than this is treated as stale (e.g. orphaned by a
    // restart) and pruned so it can't suppress the alert forever.
    const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
    const pruneStale = (): void =>
      ctx.store.prunePendingRemediations(new Date(Date.now() - PENDING_TTL_MS).toISOString());
    pruneStale(); // reconcile on boot

    const handling = new Set<string>(); // already acted on (transient, in-memory)
    const inFlight = new Map<string, string>(); // alertId -> running remediation sessionId

    // Hold an alert for one-tap approval and announce it. Persisted via the store
    // so a restart can't orphan a push notification's already-delivered approve
    // link (the approve endpoint used to read an in-memory map a reboot wiped).
    const holdForApproval = (alert: Alert): void => {
      ctx.store.addPendingRemediation(alert, new Date().toISOString());
      ctx.bus.publish({
        type: 'remediation.pending',
        alertId: alert.id,
        serverName: alert.serverName,
        severity: alert.severity,
        label: alert.label,
        at: new Date().toISOString(),
      });
    };

    const start = async (alert: Alert, mode: 'investigate' | 'auto'): Promise<void> => {
      try {
        const session = await ctx.sessions.create({
          name: `${mode === 'auto' ? 'Fix' : 'Investigate'}: ${alert.serverName} - ${alert.label}`,
          // Omit workspace so each remediation session is isolated in its own dir.
          command: ctx.config.defaultCommand,
          tags: ['remediation'],
          autonomous: true,
          task: buildRemediationTask(alert, mode, findPlaybook(alert.ruleId)?.task),
        });
        inFlight.set(alert.id, session.id);
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
        if (error instanceof SessionCapacityError) {
          // No capacity to spawn right now: hold for one-tap approval / retry
          // rather than dropping the alert (and never pile onto a starved box).
          holdForApproval(alert);
          logger.warn({ alert: alert.id }, 'remediation deferred (at capacity); awaiting approval');
          return;
        }
        logger.error({ alert: alert.id, error }, 'remediation failed to start');
      }
    };

    // Before auto-running, get a Codex second opinion (per the configured mode).
    // On an explicit reject, hold the action for one-tap approval instead of
    // running it unattended. Always fails open if Codex can't be reached.
    const gateThenStart = async (alert: Alert, mode: 'investigate' | 'auto'): Promise<void> => {
      const subject = `${alert.serverName}: ${alert.label}`;
      const gate = await secondOpinionGate(ctx.store, ctx.settings.get().secondOpinionMode, {
        subject,
        prompt: buildGatePrompt(alert, mode),
      });
      if (gate.verdict.available) {
        ctx.bus.publish({
          type: 'secondopinion',
          subject,
          verdict: gate.verdict.verdict,
          summary: gate.verdict.summary,
          proceeded: gate.proceed,
          at: new Date().toISOString(),
        });
      }
      if (!gate.proceed) {
        handling.delete(alert.id);
        holdForApproval(alert);
        logger.warn(
          { alert: alert.id, summary: gate.verdict.summary },
          'second opinion held auto-remediation for approval',
        );
        return;
      }
      await start(alert, mode);
    };

    ctx.app.get('/api/playbooks', async () => DEFAULT_PLAYBOOKS);

    ctx.app.get('/api/remediation', async () =>
      ctx.store.listPendingRemediations().map(({ alert, createdAt }) => ({
        alertId: alert.id,
        serverName: alert.serverName,
        severity: alert.severity,
        label: alert.label,
        createdAt,
      })),
    );

    ctx.app.post('/api/remediation/:id/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const alert = ctx.store.getPendingRemediation(id);
      if (!alert) return reply.status(404).send({ error: 'no pending remediation for this alert' });
      ctx.store.removePendingRemediation(id);
      handling.add(id);
      await start(alert, ctx.settings.get().remediationMode === 'auto' ? 'auto' : 'investigate');
      return reply.status(202).send();
    });

    // Dismiss a pending remediation without running it.
    ctx.app.delete('/api/remediation/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!ctx.store.getPendingRemediation(id)) {
        return reply.status(404).send({ error: 'no pending remediation for this alert' });
      }
      ctx.store.removePendingRemediation(id);
      return reply.status(204).send();
    });

    ctx.bus.subscribe((event) => {
      if (event.type === 'session.status' && event.status === 'stopped') {
        // A remediation session finished: free its alert so a future recurrence
        // can be handled again (and stop tracking it as in-flight).
        for (const [alertId, sessionId] of inFlight) {
          if (sessionId === event.id) {
            inFlight.delete(alertId);
            handling.delete(alertId);
          }
        }
        return;
      }
      if (event.type === 'alert.resolved') {
        ctx.store.removePendingRemediation(event.id);
        // Keep `handling` while a remediation session is still running, so a brief
        // dip below threshold mid-fix can't let a duplicate spawn; the session's
        // stop event clears it. Otherwise the condition genuinely cleared.
        if (!inFlight.has(event.id)) handling.delete(event.id);
        return;
      }
      if (event.type !== 'alert.fired') return;

      const { remediationMode: mode, remediationAutoSeverities } = ctx.settings.get();
      if (mode === 'off') return;

      pruneStale(); // never let a stale hold permanently dedup an alert away
      const alert = event.alert;
      if (handling.has(alert.id) || ctx.store.getPendingRemediation(alert.id)) return;

      const playbook = findPlaybook(alert.ruleId);
      const autoOk =
        remediationAutoSeverities.includes(alert.severity) && !playbook?.requiresApproval;
      if (autoOk) {
        handling.add(alert.id);
        void gateThenStart(alert, mode);
      } else {
        holdForApproval(alert);
        logger.warn({ alert: alert.id, severity: alert.severity }, 'remediation awaiting approval');
      }
    });

    logger.info('remediation module ready (mode from settings)');
  },
};
