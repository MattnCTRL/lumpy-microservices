import { join } from 'node:path';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import type { Service } from '@lumpy/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'service'
  );
}

const createSchema = z.object({
  name: z.string().min(1),
  speciality: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  speciality: z.string().optional(),
  description: z.string().nullable().optional(),
  instructions: z.string().min(1).optional(),
});

const improveSchema = z.object({
  note: z.string().min(1),
  instructions: z.string().min(1).optional(),
});

/** The prompt a deployed service runs, with a self-improvement hook. */
function buildDeployTask(service: Service, base: string): string {
  return [
    `You are the "${service.name}" micro service for Lumpy - speciality: ${service.speciality || 'general'}.`,
    '',
    'Your instructions:',
    service.instructions,
    '',
    `You act on the Lumpy platform via its API at ${base} with the header "x-lumpy-admin-token: $LUMPY_ADMIN_TOKEN".`,
    '',
    `Self-improvement: if while doing this work you find your own instructions were missing something, incomplete, or could be sharper, record the improvement by POSTing to ${base}/api/services/${service.id}/improve with header "x-lumpy-admin-token: $LUMPY_ADMIN_TOKEN" and a JSON body { "note": "<what was missing>", "instructions": "<optional improved full instructions>" }. Only do this when you have a concrete refinement.`,
  ].join('\n');
}

export const servicesModule: LumpyModule = {
  id: 'services',
  name: 'Micro Services',
  version: '0.1.0',
  description: 'A rolodex of deployable, self-improving specialist services for Lumpy.',
  register(ctx: ModuleContext) {
    const { app, store } = ctx;
    const base = config.publicUrl || `http://${config.host}:${config.port}`;

    app.get('/api/services', async () => store.listServices());

    app.get('/api/services/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const service = store.getService(id);
      if (!service) return reply.status(404).send({ error: 'service not found' });
      return service;
    });

    app.post('/api/services', async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const now = new Date().toISOString();
      const service: Service = {
        id: generateId(),
        name: parsed.data.name.trim(),
        speciality: parsed.data.speciality?.trim() ?? '',
        description: parsed.data.description?.trim() || null,
        instructions: parsed.data.instructions,
        version: 1,
        improvements: [],
        createdAt: now,
        updatedAt: now,
      };
      store.createService(service);
      logger.info({ id: service.id, name: service.name }, 'service created');
      return reply.status(201).send(service);
    });

    app.patch('/api/services/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getService(id)) return reply.status(404).send({ error: 'service not found' });
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      return store.updateService(id, parsed.data);
    });

    app.delete('/api/services/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getService(id)) return reply.status(404).send({ error: 'service not found' });
      store.deleteService(id);
      return reply.status(204).send();
    });

    // Deploy: spawn an autonomous session running the service, with admin access.
    app.post('/api/services/:id/deploy', async (request, reply) => {
      const { id } = request.params as { id: string };
      const service = store.getService(id);
      if (!service) return reply.status(404).send({ error: 'service not found' });
      const session = await ctx.sessions.create({
        name: `Service: ${service.name}`,
        workspace: join(config.workspaceRoot, '_services', slug(service.name)),
        command: config.defaultCommand,
        tags: ['service', service.id],
        autonomous: true,
        task: buildDeployTask(service, base),
        env: { LUMPY_URL: base, LUMPY_ADMIN_TOKEN: config.adminToken, LUMPY_SERVICE_ID: service.id },
      });
      logger.info({ service: id, session: session.id }, 'service deployed');
      return reply.status(202).send({ sessionId: session.id });
    });

    // Self-improvement: record a refinement, optionally update the definition.
    app.post('/api/services/:id/improve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const service = store.getService(id);
      if (!service) return reply.status(404).send({ error: 'service not found' });
      const parsed = improveSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'note is required' });

      const version = service.version + 1;
      const improvements = [
        ...service.improvements,
        { at: new Date().toISOString(), note: parsed.data.note, version },
      ];
      const updated = store.updateService(id, {
        instructions: parsed.data.instructions ?? service.instructions,
        version,
        improvements,
      });
      logger.info({ service: id, version }, 'service improved');
      return updated;
    });

    logger.info('services module ready');
  },
};
