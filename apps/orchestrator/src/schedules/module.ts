import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import type { Schedule } from '@lumpy/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { cronMatches, cronValid, nextRun } from './cron.js';

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);
const TICK_MS = 60_000;

const createSchema = z.object({
  name: z.string().min(1),
  cron: z.string().refine(cronValid, 'invalid cron expression (5 fields, evaluated in UTC)'),
  task: z.string().min(1),
  projectId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  cron: z.string().refine(cronValid, 'invalid cron expression').optional(),
  task: z.string().min(1).optional(),
  projectId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

/**
 * Scheduled tasks: recurring autonomous Claude jobs. A 5-field cron expression
 * (UTC) fires an autonomous session running the task - optionally scoped to a
 * project's workspace, manual, and connectors.
 */
export const schedulesModule: LumpyModule = {
  id: 'schedules',
  name: 'Schedules',
  version: '0.1.0',
  description: 'Recurring autonomous Claude jobs driven by cron expressions.',
  register(ctx: ModuleContext) {
    const { app, store } = ctx;

    const runSchedule = async (id: string): Promise<string | null> => {
      const schedule = store.getSchedule(id);
      if (!schedule) return null;
      const at = new Date();
      let sessionId: string | null = null;
      let status: 'ok' | 'error' = 'ok';
      try {
        let workspace: string | undefined;
        if (schedule.projectId) workspace = store.getProject(schedule.projectId)?.workspace;
        const session = await ctx.sessions.create({
          name: `Scheduled: ${schedule.name}`,
          workspace,
          command: config.defaultCommand,
          tags: ['scheduled'],
          autonomous: true,
          task: schedule.task,
          projectId: schedule.projectId ?? undefined,
        });
        sessionId = session.id;
      } catch (error) {
        status = 'error';
        logger.error({ schedule: id, error }, 'scheduled run failed to start');
      }
      store.markScheduleRun(id, {
        lastRunAt: at.toISOString(),
        lastSessionId: sessionId,
        lastStatus: status,
        nextRunAt: nextRun(schedule.cron, at)?.toISOString() ?? null,
      });
      return sessionId;
    };

    // Each minute, fire schedules whose cron matches now (UTC), at most once
    // per minute (guarded by lastRunAt so a late/overlapping tick can't double-run).
    const tick = (): void => {
      const now = new Date();
      const minuteKey = now.toISOString().slice(0, 16);
      for (const schedule of store.listSchedules()) {
        if (!schedule.enabled) continue;
        if (!cronMatches(schedule.cron, now)) continue;
        if (schedule.lastRunAt && schedule.lastRunAt.slice(0, 16) === minuteKey) continue;
        logger.info({ schedule: schedule.id, name: schedule.name }, 'running scheduled task');
        void runSchedule(schedule.id);
      }
    };
    const timer = setInterval(tick, TICK_MS);
    timer.unref();

    app.get('/api/schedules', async () => store.listSchedules());

    app.post('/api/schedules', async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const input = parsed.data;
      const now = new Date();
      const schedule: Schedule = {
        id: generateId(),
        name: input.name.trim(),
        cron: input.cron.trim(),
        task: input.task.trim(),
        projectId: input.projectId ?? null,
        enabled: input.enabled ?? true,
        lastRunAt: null,
        lastSessionId: null,
        lastStatus: null,
        nextRunAt: nextRun(input.cron, now)?.toISOString() ?? null,
        createdAt: now.toISOString(),
      };
      store.createSchedule(schedule);
      return reply.status(201).send(store.getSchedule(schedule.id));
    });

    app.patch('/api/schedules/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getSchedule(id)) return reply.status(404).send({ error: 'schedule not found' });
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const nextRunAt = parsed.data.cron
        ? (nextRun(parsed.data.cron, new Date())?.toISOString() ?? null)
        : undefined;
      return store.updateSchedule(id, { ...parsed.data, nextRunAt });
    });

    app.post('/api/schedules/:id/run', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getSchedule(id)) return reply.status(404).send({ error: 'schedule not found' });
      const sessionId = await runSchedule(id);
      return reply.status(202).send({ sessionId });
    });

    app.delete('/api/schedules/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getSchedule(id)) return reply.status(404).send({ error: 'schedule not found' });
      store.deleteSchedule(id);
      return reply.status(204).send();
    });

    logger.info('schedules module ready');
  },
};
