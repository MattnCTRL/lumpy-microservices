import type { WebSocket } from 'ws';
import { z } from 'zod';
import { FleetManager } from './manager.js';
import { FleetStore } from '../store/fleet.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';

const createServerSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  tags: z.array(z.string()).optional(),
  env: z.enum(['prod', 'staging', 'dev']).optional(),
  criticality: z.enum(['low', 'medium', 'high']).optional(),
});

const metricsSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memPercent: z.number().min(0).max(100),
  diskPercent: z.number().min(0).max(100),
  load1: z.number().min(0),
  uptimeSeconds: z.number().min(0),
});

function registerRest(ctx: ModuleContext, fleet: FleetManager): void {
  const { app } = ctx;

  app.get('/api/fleet/servers', async () => fleet.list());

  app.post('/api/fleet/servers', async (request, reply) => {
    const parsed = createServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    }
    const input = parsed.data;
    const server = fleet.register({
      name: input.name,
      address: input.address,
      tags: input.tags ?? [],
      env: input.env ?? 'prod',
      criticality: input.criticality ?? 'medium',
    });
    return reply.status(201).send(server);
  });

  app.get('/api/fleet/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = fleet.get(id);
    if (!server) return reply.status(404).send({ error: 'server not found' });
    return server;
  });

  app.delete('/api/fleet/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!fleet.remove(id)) return reply.status(404).send({ error: 'server not found' });
    return reply.status(204).send();
  });

  app.post('/api/fleet/servers/:id/metrics', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = metricsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    }
    if (!fleet.ingest(id, parsed.data)) {
      return reply.status(404).send({ error: 'server not found' });
    }
    return reply.status(204).send();
  });
}

function registerEventsWebSocket(ctx: ModuleContext): void {
  ctx.app.get('/ws/fleet', { websocket: true }, (socket: WebSocket) => {
    const unsubscribe = ctx.bus.subscribe((event) => {
      if (!event.type.startsWith('fleet.')) return;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.on('close', unsubscribe);
  });
}

export const fleetModule: LumpyModule = {
  id: 'fleet',
  name: 'Fleet Monitoring',
  version: '0.1.0',
  description: 'Register, monitor, and track the status of remote servers.',
  register(ctx) {
    const fleet = new FleetManager(new FleetStore(ctx.config.dataDir), ctx.bus);
    registerRest(ctx, fleet);
    registerEventsWebSocket(ctx);
  },
};
