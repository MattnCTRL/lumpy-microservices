import { config } from './config.js';
import { EventBus } from './events/bus.js';
import { fleetModule } from './fleet/module.js';
import { logger } from './logger.js';
import { ModuleRegistry } from './modules/registry.js';
import { sessionsModule } from './modules/sessions/module.js';
import { notifyModule } from './notify/module.js';
import { SessionManager } from './sessions/manager.js';
import * as tmux from './sessions/tmux.js';
import { createApp } from './server/http.js';
import { Store } from './store/sqlite.js';

async function main(): Promise<void> {
  if (!(await tmux.isAvailable())) {
    logger.warn('tmux is not installed — sessions cannot be created until it is available');
  }

  const store = new Store(config.dataDir);
  const bus = new EventBus();
  const sessions = new SessionManager(store, bus, config.tmuxPrefix);
  await sessions.recover();

  const registry = new ModuleRegistry().add(sessionsModule).add(fleetModule).add(notifyModule);
  const app = await createApp({ sessions, registry, bus });

  await app.listen({ host: config.host, port: config.port });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    sessions.disposeAll();
    // Guarantee exit even if a graceful close stalls (e.g. an open socket).
    const force = setTimeout(() => process.exit(0), 2000);
    force.unref();
    try {
      await app.close();
    } catch {
      // Ignore; we exit regardless.
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error(error, 'failed to start orchestrator');
  process.exit(1);
});
