import cookie from '@fastify/cookie';
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
  // forceCloseConnections makes app.close() terminate open WebSocket
  // connections immediately instead of waiting for them to drain, so the
  // process exits promptly on shutdown / dev-watch restart.
  const app = Fastify({ logger: loggerOptions, forceCloseConnections: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie, { secret: config.authSecret });
  await app.register(websocket);

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      tmux: await tmux.isAvailable(),
      version: VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      publicUrl: config.publicUrl,
      workspaceRoot: config.workspaceRoot,
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
