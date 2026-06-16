import { config } from './config.js';
import { EventBus } from './events/bus.js';
import { activityModule } from './activity/module.js';
import { alertsModule } from './alerts/module.js';
import { authModule } from './auth/module.js';
import { backupModule } from './backup/module.js';
import { digestModule } from './digest/module.js';
import { fleetModule } from './fleet/module.js';
import { ledgerModule } from './ledger/module.js';
import { logger } from './logger.js';
import { ModuleRegistry } from './modules/registry.js';
import { sessionsModule } from './modules/sessions/module.js';
import { notifyModule } from './notify/module.js';
import { projectsModule } from './projects/module.js';
import { repoSyncModule } from './reposync/module.js';
import { schedulesModule } from './schedules/module.js';
import { secondOpinionModule } from './secondopinion/module.js';
import { servicesModule } from './services/module.js';
import { remediationModule } from './remediation/module.js';
import { ensureConductor } from './sessions/conductor.js';
import { SessionManager } from './sessions/manager.js';
import { syncCodexAuth, syncGithubToken, syncVercelToken } from './settings/credentials.js';
import { resolveRunAs } from './sessions/runas.js';
import * as tmux from './sessions/tmux.js';
import { createApp } from './server/http.js';
import { settingsModule } from './settings/module.js';
import { SettingsStore } from './settings/store.js';
import { Store } from './store/sqlite.js';

async function main(): Promise<void> {
  if (!(await tmux.isAvailable())) {
    logger.warn('tmux is not installed - sessions cannot be created until it is available');
  }

  const store = new Store(config.dataDir);
  syncVercelToken(store);
  syncGithubToken(store);
  syncCodexAuth(store);
  const bus = new EventBus();
  const settingsStore = new SettingsStore(config.dataDir, {
    remediationMode: config.remediationMode,
    remediationAutoSeverities: config.remediationAutoSeverities,
    secondOpinionMode: config.secondOpinionMode,
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
    .add(repoSyncModule)
    .add(sessionsModule)
    .add(fleetModule)
    .add(alertsModule)
    .add(remediationModule)
    .add(secondOpinionModule)
    .add(digestModule)
    .add(activityModule)
    .add(backupModule)
    .add(ledgerModule)
    .add(notifyModule);
  const app = await createApp({ sessions, registry, bus, settings: settingsStore, store });

  await app.listen({ host: config.host, port: config.port });

  // The locked Conductor (master orchestrator). Ensure it exists on boot, and
  // keep it alive on a timer. Opt-in via LUMPY_CONDUCTOR=true.
  await ensureConductor(sessions, store);
  const conductorKeeper = setInterval(() => void ensureConductor(sessions, store), 60_000);
  conductorKeeper.unref();

  // Retire finished one-shot tasks so the mission-control board drains itself
  // (their output persists in the project; the session artifact is cleared).
  const taskReaper = setInterval(
    () => void sessions.reapDoneTasks(config.taskReapGraceMs),
    30_000,
  );
  taskReaper.unref();

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
