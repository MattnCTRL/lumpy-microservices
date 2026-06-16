import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load a .env from the monorepo root (and the current directory) if present, so
// configuration can live in a file. Real environment variables still win.
function loadEnvFiles(): void {
  // config.ts lives at <root>/apps/orchestrator/src, so the repo root is three up.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const candidate of [resolve(repoRoot, '.env'), resolve(process.cwd(), '.env')]) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // No file at this path; ignore.
    }
  }
}

loadEnvFiles();

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function expandHome(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2));
  return input;
}

const workspaceRoot = resolve(expandHome(env('LUMPY_WORKSPACE_ROOT', homedir())));
const dataDir = resolve(expandHome(env('LUMPY_DATA_DIR', './data')));

// A stable admin token (persisted) the Conductor uses to call the API as admin.
function loadOrCreateAdminToken(dir: string): string {
  const path = resolve(dir, '.admin-token');
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // not created yet
  }
  const token = randomBytes(24).toString('hex');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, token, { mode: 0o600 });
  } catch {
    // non-fatal; token just won't persist across restarts
  }
  return token;
}

export const config = {
  host: env('LUMPY_HOST', '127.0.0.1'),
  port: Number(env('LUMPY_PORT', '4317')),
  dataDir,
  logLevel: env('LUMPY_LOG_LEVEL', 'info'),
  tmuxPrefix: env('LUMPY_TMUX_PREFIX', 'lumpy'),
  defaultCommand: env('LUMPY_DEFAULT_COMMAND', 'claude'),
  // Run sessions as this OS user (non-root sandboxing). Empty = run as the
  // orchestrator's own user.
  sessionUser: env('LUMPY_SESSION_USER', ''),
  // Admission control: refuse to spawn a new session once this many are already
  // running, so a storm of alerts/schedules/derives can't fan out enough Claude
  // processes to OOM a small box. 0 disables the cap. The locked Conductor is
  // always exempt (it is the constant).
  maxConcurrentSessions: Number(env('LUMPY_MAX_SESSIONS', '8')),
  // How long a finished one-shot task lingers on the board before auto-retiring
  // (its output persists in the project; only the session artifact is cleared).
  taskReapGraceMs: Number(env('LUMPY_TASK_REAP_GRACE_MS', '90000')),
  // Admission control: refuse to spawn a new session when less than this much
  // memory is available (MemAvailable on Linux). 0 disables the check. Left off
  // by default because macOS free-memory reporting is misleading; the box sets
  // it (where /proc/meminfo is accurate) via the installer.
  minFreeMemoryMb: Number(env('LUMPY_MIN_FREE_MEMORY_MB', '0')),
  // Alert remediation: off | investigate (diagnose only) | auto (also fix).
  remediationMode: env('LUMPY_REMEDIATION_MODE', 'off') as 'off' | 'investigate' | 'auto',
  // Severities that remediate automatically; others require one-tap approval.
  remediationAutoSeverities: env('LUMPY_REMEDIATION_AUTO_SEVERITIES', 'warning')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  workspaceRoot,
  // Notifications (ntfy). Leave the topic empty to disable push notifications.
  ntfyUrl: env('LUMPY_NTFY_URL', 'https://ntfy.sh'),
  ntfyTopic: env('LUMPY_NTFY_TOPIC', ''),
  // Hour (UTC, 0-23) to push the daily platform digest. Empty/'off' disables.
  digestHour: env('LUMPY_DIGEST_HOUR', '13'),
  // Base URL the phone can reach (a Tailscale address) for notification links
  // and approve/deny action buttons. Optional.
  publicUrl: env('LUMPY_PUBLIC_URL', ''),
  // The web UI URL to return to after GitHub sign-in.
  webUrl: env('LUMPY_WEB_URL', ''),
  // Deployment label surfaced on /api/health (e.g. "box"). Empty = unlabeled.
  instanceLabel: env('LUMPY_INSTANCE', ''),
  // GitHub OAuth (Sign in with GitHub). Empty = sign-in disabled.
  github: {
    clientId: env('LUMPY_GITHUB_CLIENT_ID', ''),
    clientSecret: env('LUMPY_GITHUB_CLIENT_SECRET', ''),
  },
  // Secret for signing auth cookies; random per boot if unset (re-login on restart).
  authSecret: env('LUMPY_AUTH_SECRET', '') || randomBytes(32).toString('hex'),
  // Opt-in: require a signed-in GitHub user for the API. Off by default so the
  // live deployment is never locked out; only enforced when sign-in is also
  // configured (see server/http.ts).
  requireAuth: env('LUMPY_REQUIRE_AUTH', '') === 'true',
  // GitHub logins with the admin role (full access). Empty = everyone who signs
  // in is an admin, so enabling auth can't lock the owner out. When set, logins
  // not listed get the read-only viewer role.
  adminLogins: env('LUMPY_ADMIN_LOGINS', '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // Shared token agents send (x-lumpy-agent-token) to push metrics / register
  // while auth gating is on. Empty = agent telemetry is allowed on trust (the
  // tailnet is the boundary); set it to require the token from agents too.
  agentToken: env('LUMPY_AGENT_TOKEN', ''),
  // Admin token (x-lumpy-admin-token) the Conductor uses to call the full API.
  // Stable across restarts (persisted to data/.admin-token).
  adminToken: env('LUMPY_ADMIN_TOKEN', '') || loadOrCreateAdminToken(dataDir),
  // Opt-in: run the locked Conductor (master orchestrator) session.
  conductorEnabled: env('LUMPY_CONDUCTOR', '') === 'true',
  // Cross-model (Codex) second opinion on autonomous actions.
  // off | advisory (consult + record) | enforce (hold an auto-fix Codex rejects).
  // Only takes effect when an OpenAI API key is stored; otherwise it fails open.
  secondOpinionMode: env('LUMPY_SECOND_OPINION', 'enforce') as 'off' | 'advisory' | 'enforce',
  // Max wall-clock for a single Codex consult before it fails open.
  codexTimeoutMs: Number(env('LUMPY_CODEX_TIMEOUT_MS', '120000')),
  // Optional model override for Codex consults (empty = Codex default).
  codexModel: env('LUMPY_CODEX_MODEL', ''),
};

/** Resolve a (possibly relative or ~-prefixed) workspace path against the root. */
export function resolveWorkspace(input: string | undefined): string {
  if (!input) return config.workspaceRoot;
  const expanded = expandHome(input);
  return isAbsolute(expanded) ? expanded : resolve(config.workspaceRoot, expanded);
}
