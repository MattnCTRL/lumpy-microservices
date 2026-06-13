import { randomBytes } from 'node:crypto';
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

export const config = {
  host: env('LUMPY_HOST', '127.0.0.1'),
  port: Number(env('LUMPY_PORT', '4317')),
  dataDir: resolve(expandHome(env('LUMPY_DATA_DIR', './data'))),
  logLevel: env('LUMPY_LOG_LEVEL', 'info'),
  tmuxPrefix: env('LUMPY_TMUX_PREFIX', 'lumpy'),
  defaultCommand: env('LUMPY_DEFAULT_COMMAND', 'claude'),
  // Run sessions as this OS user (non-root sandboxing). Empty = run as the
  // orchestrator's own user.
  sessionUser: env('LUMPY_SESSION_USER', ''),
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
  // Base URL the phone can reach (a Tailscale address) for notification links
  // and approve/deny action buttons. Optional.
  publicUrl: env('LUMPY_PUBLIC_URL', ''),
  // The web UI URL to return to after GitHub sign-in.
  webUrl: env('LUMPY_WEB_URL', ''),
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
};

/** Resolve a (possibly relative or ~-prefixed) workspace path against the root. */
export function resolveWorkspace(input: string | undefined): string {
  if (!input) return config.workspaceRoot;
  const expanded = expandHome(input);
  return isAbsolute(expanded) ? expanded : resolve(config.workspaceRoot, expanded);
}
