import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { ClientMessage, ServerMessage } from '@lumpy/shared';
import { config, resolveWorkspace } from '../../config.js';
import * as tmux from '../../sessions/tmux.js';
import type { LumpyModule, ModuleContext } from '../types.js';

const createSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(),
  command: z.string().optional(),
  tags: z.array(z.string()).optional(),
  autonomous: z.boolean().optional(),
  task: z.string().optional(),
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function registerRest(ctx: ModuleContext): void {
  const { app, sessions } = ctx;

  app.get('/api/sessions', async () => sessions.list());

  app.post('/api/sessions', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    }
    if (!(await tmux.isAvailable())) {
      return reply.status(503).send({ error: 'tmux is not available on the orchestrator host' });
    }

    const input = parsed.data;
    const session = await sessions.create({
      name: input.name,
      workspace: resolveWorkspace(input.workspace),
      command: input.command || config.defaultCommand,
      tags: input.tags ?? [],
      autonomous: input.autonomous ?? true,
      task: input.task?.trim() || null,
    });
    return reply.status(201).send(session);
  });

  app.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await sessions.get(id);
    if (!session) return reply.status(404).send({ error: 'session not found' });
    return session;
  });

  app.post('/api/sessions/:id/input', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ data: z.string() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'data is required' });

    const broker = sessions.getBroker(id);
    if (!broker) return reply.status(404).send({ error: 'session not running' });
    broker.write(body.data.data);
    return reply.status(204).send();
  });

  app.post('/api/sessions/:id/stop', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stopped = await sessions.stop(id);
    if (!stopped) return reply.status(404).send({ error: 'session not found' });
    return reply.status(204).send();
  });

  const relaunch = async (
    request: { params: unknown },
    reply: import('fastify').FastifyReply,
    run: (id: string) => Promise<Awaited<ReturnType<typeof sessions.restart>>>,
  ) => {
    const { id } = request.params as { id: string };
    if (!(await tmux.isAvailable())) {
      return reply.status(503).send({ error: 'tmux is not available on the orchestrator host' });
    }
    try {
      const session = await run(id);
      if (!session) return reply.status(404).send({ error: 'session not found' });
      return session;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'failed to relaunch session',
      });
    }
  };

  app.post('/api/sessions/:id/restart', (request, reply) =>
    relaunch(request, reply, (id) => sessions.restart(id)),
  );

  app.post('/api/sessions/:id/resume', (request, reply) =>
    relaunch(request, reply, (id) => sessions.resume(id)),
  );

  app.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = await sessions.remove(id);
    if (!removed) return reply.status(404).send({ error: 'session not found' });
    return reply.status(204).send();
  });
}

function registerWebSocket(ctx: ModuleContext): void {
  ctx.app.get('/ws/session/:id', { websocket: true }, (socket: WebSocket, request) => {
    const { id } = request.params as { id: string };
    const broker = ctx.sessions.getBroker(id);
    if (!broker) {
      send(socket, { type: 'error', message: 'session not found' });
      socket.close();
      return;
    }

    const snapshot = broker.snapshot();
    if (snapshot.length > 0) socket.send(snapshot);
    send(socket, { type: 'snapshot-end' });

    const unsubscribeData = broker.onData((chunk) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk);
    });
    const unsubscribeExit = broker.onExit(() =>
      send(socket, { type: 'status', status: 'stopped' }),
    );

    socket.on('message', (raw: Buffer) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (message.type === 'input') broker.write(message.data);
      else if (message.type === 'resize') broker.resize(message.cols, message.rows);
    });

    socket.on('close', () => {
      unsubscribeData();
      unsubscribeExit();
    });
  });
}

function registerEventsWebSocket(ctx: ModuleContext): void {
  ctx.app.get('/ws/sessions', { websocket: true }, (socket: WebSocket) => {
    const unsubscribe = ctx.bus.subscribe((event) => {
      if (!event.type.startsWith('session.')) return;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.on('close', unsubscribe);
  });
}

export const sessionsModule: LumpyModule = {
  id: 'sessions',
  name: 'Session Orchestration',
  version: '0.1.0',
  description: 'Create, stream, and control tmux-backed Claude Code sessions.',
  register(ctx) {
    registerRest(ctx);
    registerWebSocket(ctx);
    registerEventsWebSocket(ctx);
  },
};
