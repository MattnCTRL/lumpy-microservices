import { config } from './config.js';
import { EventBus } from './events/bus.js';
import { alertsModule } from './alerts/module.js';
import { authModule } from './auth/module.js';
import { fleetModule } from './fleet/module.js';
import { logger } from './logger.js';
import { ModuleRegistry } from './modules/registry.js';
import { sessionsModule } from './modules/sessions/module.js';
import { notifyModule } from './notify/module.js';
import { projectsModule } from './projects/module.js';
import { schedulesModule } from './schedules/module.js';
import { servicesModule } from './services/module.js';
import { remediationModule } from './remediation/module.js';
import { conductorTick, ensureConductor } from './sessions/conductor.js';
import { SessionManager } from './sessions/manager.js';
import { resolveRunAs } from './sessions/runas.js';
import * as tmux from './sessions/tmux.js';
import { createApp } from './server/http.js';
import { settingsModule } from './settings/module.js';
import { SettingsStore } from './settings/store.js';
import { Store } from './store/sqlite.js';

async function main(): Promise<void> {
  if (!(await tmux.isAvailable())) {
    logger.warn('tmux is not installed — sessions cannot be created until it is available');
  }

  const store = new Store(config.dataDir);
  const bus = new EventBus();
  const settingsStore = new SettingsStore(config.dataDir, {
    remediationMode: config.remediationMode,
    remediationAutoSeverities: config.remediationAutoSeverities,
  });

  let runAs = null;
  if (config.sessionUser) {
    try {
      runAs = resolveRunAs(config.sessionUser);
      logger.info({ user: runAs.user, uid: runAs.uid }, 'sessions run as dedicated user');
    } catch (error) {
      logger.error(
        { user: config.sessionUser, error },
        'could not resolve session user; running sessions as orchestrator user',
      );
    }
  }

  const sessions = new SessionManager(store, bus, config.tmuxPrefix, runAs);
  await sessions.recover();

  const registry = new ModuleRegistry()
    .add(authModule)
    .add(settingsModule)
    .add(projectsModule)
    .add(servicesModule)
    .add(schedulesModule)
    .add(sessionsModule)
    .add(fleetModule)
    .add(alertsModule)
    .add(remediationModule)
    .add(notifyModule);
  const app = await createApp({ sessions, registry, bus, settings: settingsStore, store });

  await app.listen({ host: config.host, port: config.port });

  // The locked Conductor (master orchestrator). Ensure it exists on boot, and
  // keep it alive on a timer. Opt-in via LUMPY_CONDUCTOR=true.
  await ensureConductor(sessions, store);
  const conductorKeeper = setInterval(() => void ensureConductor(sessions, store), 60_000);
  conductorKeeper.unref();
  // Proactively nudge the Conductor to find and act on improvements when idle.
  const conductorNudge = setInterval(() => void conductorTick(sessions), 15 * 60_000);
  conductorNudge.unref();

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
