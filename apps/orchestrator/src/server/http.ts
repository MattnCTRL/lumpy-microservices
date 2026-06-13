import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@lumpy/shared';
import { gateDecision, readUser } from '../auth/session.js';
import { config } from '../config.js';
import type { EventBus } from '../events/bus.js';
import { logger, loggerOptions } from '../logger.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { SessionManager } from '../sessions/manager.js';
import * as tmux from '../sessions/tmux.js';
import type { SettingsStore } from '../settings/store.js';
import { VERSION } from '../version.js';

export interface AppDependencies {
  sessions: SessionManager;
  registry: ModuleRegistry;
  bus: EventBus;
  settings: SettingsStore;
}

export async function createApp(deps: AppDependencies): Promise<FastifyInstance> {
  // forceCloseConnections makes app.close() terminate open WebSocket
  // connections immediately instead of waiting for them to drain, so the
  // process exits promptly on shutdown / dev-watch restart.
  const app = Fastify({ logger: loggerOptions, forceCloseConnections: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie, { secret: config.authSecret });
  await app.register(websocket);

  // Opt-in auth gate. Only enforced when sign-in is also configured, so setting
  // the flag without GitHub credentials can never lock everyone out of the box.
  const githubReady = Boolean(config.github.clientId && config.github.clientSecret);
  if (config.requireAuth && !githubReady) {
    logger.warn(
      'LUMPY_REQUIRE_AUTH is set but GitHub sign-in is not configured — auth gating is DISABLED to avoid lockout',
    );
  }
  if (config.requireAuth && githubReady) {
    logger.info('auth gating enabled (signed-in GitHub user required)');
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? request.url;
      const decision = gateDecision(readUser(request), request.method, path);
      if (decision === 'unauthenticated') {
        return reply.status(401).send({ error: 'authentication required' });
      }
      if (decision === 'forbidden') {
        return reply.status(403).send({ error: 'admin role required' });
      }
    });
  }

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
    settings: deps.settings,
  });

  return app;
}
