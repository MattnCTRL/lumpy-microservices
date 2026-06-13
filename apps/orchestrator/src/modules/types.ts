import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { config } from '../config.js';
import type { EventBus } from '../events/bus.js';
import type { SessionManager } from '../sessions/manager.js';

/**
 * Services exposed to every module at registration time. This is the seam
 * through which bespoke tools/modules integrate with the orchestrator.
 * Extend this as new shared capabilities (event bus, fleet, alerts) land.
 */
export interface ModuleContext {
  app: FastifyInstance;
  logger: Logger;
  config: typeof config;
  sessions: SessionManager;
  bus: EventBus;
}

/**
 * A self-contained unit of functionality. Each bespoke tool added downstream
 * ships as a module: it owns its routes and services and registers them here.
 */
export interface LumpyModule {
  /** Stable kebab-case identifier, e.g. "sessions", "fleet", "alerts". */
  id: string;
  name: string;
  version: string;
  description?: string;
  register(ctx: ModuleContext): void | Promise<void>;
}

export interface ModuleInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
}
