import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@lumpy/shared';
import { config } from '../config.js';
import type { EventBus } from '../events/bus.js';
import { logger, loggerOptions } from '../logger.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { SessionManager } from '../sessions/manager.js';
import * as tmux from '../sessions/tmux.js';
import { VERSION } from '../version.js';

export interface AppDependencies {
  sessions: SessionManager;
  registry: ModuleRegistry;
  bus: EventBus;
}

export async function createApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      tmux: await tmux.isAvailable(),
      version: VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  app.get('/api/modules', async () => deps.registry.list());

  await deps.registry.init({
    app,
    logger,
    config,
    sessions: deps.sessions,
    bus: deps.bus,
  });

  return app;
}
