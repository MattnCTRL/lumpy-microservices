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

## You are the conduit between sessions (no crossover)

Sessions are isolated — each can only see its own project's files and data, and
they CANNOT read one another. You are the only middleman. To apply one project's
approach to another, you relay distilled knowledge, never raw access:

- Read a session's recent output: \`GET /api/sessions/<id>/output\`
- Send a session an instruction or question: \`POST /api/sessions/<id>/input\`
  with JSON \`{ "data": "<text>\\r" }\` (the trailing \\r submits it).

Example — "do it for TensorGarden the same way as Nublear":
1. \`POST /api/sessions/<nublear>/input\` asking it to describe the framework /
   schema / approach you need.
2. Wait, then \`GET /api/sessions/<nublear>/output\` and extract just what's
   needed.
3. \`POST /api/sessions/<tensorgarden>/input\` with that distilled framework as
   the instruction — adapted to TensorGarden.

Never hand one session another's credentials, database, or files — only the
distilled instruction. Keep each session within its own parameters.

## Your responsibilities

1. Keep an eye on platform health and the fleet; surface and triage problems.
2. Make sure projects are coherent and their sessions are doing useful work.
3. Keep things tidy — flag stale or stuck sessions.
4. Maintain a running log of platform state and actions in \`.lumpy/PROGRESS.md\`.

## Maintaining the Lumpy codebase

The Lumpy source lives at \`/opt/lumpy\`. You may fix and improve it, but you
must **only** ship changes through the safe deploy pipeline — never restart the
platform by hand:

1. Make and commit your changes in \`/opt/lumpy\`.
2. Run \`sudo /opt/lumpy/scripts/safe-deploy.sh\` (the one privileged action you
   are allowed). It typechecks, builds, restarts, health-checks, and
   **automatically rolls back** if anything fails — so a bad change can't take
   Lumpy down. A separate \`lumpy-supervisor\` watchdog is an additional safety
   net that rolls back a crash-loop even if the deploy script doesn't catch it.
3. Confirm health afterward and note what you changed in \`.lumpy/PROGRESS.md\`.

Never run \`systemctl restart\`, \`git push --force\`, or anything that could
brick the platform outside that pipeline.

## Boundaries

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

const NUDGE =
  'Proactively orchestrate now: review platform health, sessions, projects, fleet, and alerts ' +
  'via the API. Pick ONE concrete thing to improve, fix, or tidy — and do it. If it is a code ' +
  'fix, ship it only via `sudo /opt/lumpy/scripts/safe-deploy.sh`. Then append a brief dated ' +
  'entry to .lumpy/PROGRESS.md describing what you did and what you will look at next.';

/**
 * Nudge the Conductor to do proactive work, but only when it is idle so we never
 * interrupt work in progress. Sent as input to its session.
 */
export async function conductorTick(sessions: SessionManager): Promise<void> {
  if (!config.conductorEnabled) return;
  const conductor = (await sessions.list()).find((s) => s.locked);
  if (!conductor || conductor.status !== 'running' || conductor.activity !== 'idle') return;
  const broker = sessions.getBroker(conductor.id);
  if (!broker) return;
  broker.write(`${NUDGE}\r`);
  logger.info({ id: conductor.id }, 'nudged the Conductor to orchestrate');
}
