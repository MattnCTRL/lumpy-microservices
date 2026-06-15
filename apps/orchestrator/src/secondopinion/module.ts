import { z } from 'zod';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { consultCodex } from './consult.js';

const bodySchema = z.object({
  /** What Codex should weigh in on (an action, a diff, a question). */
  prompt: z.string().min(1, 'prompt is required'),
  /** Short label for logs/activity. */
  subject: z.string().optional(),
});

/**
 * On-demand cross-model second opinion: pipes a question to Codex (read-only)
 * and returns its structured verdict. The same engine backs the autonomous
 * remediation gate (see secondOpinionGate in consult.ts).
 */
export const secondOpinionModule: LumpyModule = {
  id: 'secondopinion',
  name: 'Second Opinion',
  version: '0.1.0',
  description: 'Read-only Codex consults: an on-demand endpoint and a gate on autonomous actions.',
  register(ctx: ModuleContext) {
    ctx.app.post('/api/secondopinion', async (request, reply) => {
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const subject = parsed.data.subject ?? 'on-demand consult';
      const verdict = await consultCodex(ctx.store, { subject, prompt: parsed.data.prompt });
      if (!verdict.available) {
        return reply.status(503).send({ error: verdict.error ?? 'second opinion unavailable' });
      }
      ctx.bus.publish({
        type: 'secondopinion',
        subject,
        verdict: verdict.verdict,
        summary: verdict.summary,
        proceeded: true,
        at: new Date().toISOString(),
      });
      return verdict;
    });

    logger.info('second-opinion module ready');
  },
};
