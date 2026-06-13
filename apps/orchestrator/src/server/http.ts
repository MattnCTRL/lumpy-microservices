import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@lumpy/shared';
import { gateDecision, readUser } from '../auth/session.js';
import { config } from '../config.js';
import { enrollScript } from './enroll.js';

const agentBundlePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/agent/dist/agent.mjs',
);
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
      // Agents are authorized when no token is configured (tailnet trust) or
      // when they present the matching token.
      const agentAuthorized = config.agentToken
        ? request.headers['x-lumpy-agent-token'] === config.agentToken
        : true;
      const decision = gateDecision(readUser(request), request.method, path, agentAuthorized);
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

  // One-line machine enrollment: `curl -fsSL <box>/enroll | sh` downloads the
  // self-contained agent below and registers it. Public (a new machine has no
  // identity yet); it only reaches the box over the private tailnet.
  const enrollBase = config.publicUrl || `http://${config.host}:${config.port}`;
  app.get('/enroll', async (_request, reply) => {
    return reply.type('text/x-shellscript').send(enrollScript(enrollBase));
  });
  app.get('/agent.mjs', async (_request, reply) => {
    try {
      return reply.type('application/javascript').send(readFileSync(agentBundlePath, 'utf8'));
    } catch {
      return reply.status(404).send('agent bundle not built');
    }
  });

  // Authorize the orchestrator's mount key on a machine so it can SSHFS-mount
  // that machine's files. Run on the target: `curl -fsSL <box>/authorize-mount | sh`.
  app.get('/authorize-mount', async (_request, reply) => {
    let pubkey = '';
    try {
      pubkey = readFileSync('/root/.ssh/lumpy_mac_mount.pub', 'utf8').trim();
    } catch {
      return reply.status(404).send('# orchestrator mount key not found');
    }
    const script = `#!/bin/sh
set -e
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qF 'lumpy-mac-mount@box' "$HOME/.ssh/authorized_keys"; then
  printf '%s\\n' '${pubkey}' >> "$HOME/.ssh/authorized_keys"
fi
echo "Lumpy: this machine now allows the orchestrator to mount its files."
`;
    return reply.type('text/x-shellscript').send(script);
  });

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
