import { join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { writeClaudeMd } from '../projects/knowledge.js';
import type { Store } from '../store/sqlite.js';
import type { SessionManager } from './manager.js';
import { resolveRunAs, type RunAs } from './runas.js';

export const CONDUCTOR_NAME = 'Conductor';

const MANUAL = `# Lumpy Conductor — operating manual

You are the **Conductor**, the single highest-level orchestrator of the Lumpy
platform. You sit above every other session and project. Your job is to keep
Lumpy clean, healthy, running, and maintained — and to coordinate all the
sub-sessions, projects, and micro services.

## Your powers

You hold an admin token. Call the Lumpy API at the base URL in \`LUMPY_URL\`
with the header \`x-lumpy-admin-token: $LUMPY_ADMIN_TOKEN\` to see and manage
everything:

- Platform health: \`GET /api/health\`
- Sessions (all agents): \`GET /api/sessions\`
- Projects: \`GET /api/projects\`
- Fleet (servers/machines/remotes): \`GET /api/fleet/servers\`
- Alerts: \`GET /api/alerts\`

## Your responsibilities

1. Keep an eye on platform health and the fleet; surface and triage problems.
2. Make sure projects are coherent and their sessions are doing useful work.
3. Keep things tidy — flag stale or stuck sessions.
4. Maintain a running log of platform state and actions in \`.lumpy/PROGRESS.md\`.

## Boundaries (for now)

- Do **not** modify the Lumpy codebase or restart the platform yet. A safe,
  self-healing deploy pipeline is being added; until it exists, never run a
  command that could take the orchestrator down. Propose code fixes in your log
  instead.
- You cannot be stopped or removed — you are the constant.

Work autonomously. When you have nothing pressing to do, summarize current
platform state to your log and wait.`;

function conductorWorkspace(): string {
  return join(config.workspaceRoot, '_conductor');
}

function runAs(): RunAs | null {
  if (!config.sessionUser) return null;
  try {
    return resolveRunAs(config.sessionUser);
  } catch {
    return null;
  }
}

/**
 * Ensure the locked Conductor session exists and is running. Opt-in via
 * LUMPY_CONDUCTOR=true so it never spawns unexpectedly in a dev environment.
 * Safe to call repeatedly (on boot and on a timer) — it acts as a keeper.
 */
export async function ensureConductor(sessions: SessionManager, store: Store): Promise<void> {
  if (!config.conductorEnabled) return;

  const existing = store.listSessions().find((s) => s.locked);
  if (existing) {
    const live = await sessions.get(existing.id);
    if (live && live.status !== 'running') {
      await sessions.resume(existing.id).catch((error) => {
        logger.warn({ error }, 'could not resume the Conductor');
      });
    }
    return;
  }

  const workspace = conductorWorkspace();
  try {
    writeClaudeMd(workspace, MANUAL, runAs());
  } catch (error) {
    logger.warn({ error }, 'could not write the Conductor manual');
  }

  const base = config.publicUrl || `http://${config.host}:${config.port}`;
  try {
    const session = await sessions.create({
      name: CONDUCTOR_NAME,
      workspace,
      command: config.defaultCommand,
      tags: ['conductor'],
      autonomous: true,
      locked: true,
      task:
        'You are the Lumpy Conductor. Review your operating manual (CLAUDE.md), then check platform health and all sessions, projects, fleet, and alerts via the API. Summarize the current state of the platform to .lumpy/PROGRESS.md.',
      env: { LUMPY_URL: base, LUMPY_ADMIN_TOKEN: config.adminToken },
    });
    logger.info({ id: session.id }, 'Conductor session created (locked master orchestrator)');
  } catch (error) {
    logger.error({ error }, 'could not create the Conductor');
  }
}
