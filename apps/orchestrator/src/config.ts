import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load a .env from the monorepo root (and the current directory) if present, so
// configuration can live in a file. Real environment variables still win.
function loadEnvFiles(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
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
  workspaceRoot,
  // Notifications (ntfy). Leave the topic empty to disable push notifications.
  ntfyUrl: env('LUMPY_NTFY_URL', 'https://ntfy.sh'),
  ntfyTopic: env('LUMPY_NTFY_TOPIC', ''),
  // Base URL the phone can reach (a Tailscale address) for notification links
  // and approve/deny action buttons. Optional.
  publicUrl: env('LUMPY_PUBLIC_URL', ''),
};

/** Resolve a (possibly relative or ~-prefixed) workspace path against the root. */
export function resolveWorkspace(input: string | undefined): string {
  if (!input) return config.workspaceRoot;
  const expanded = expandHome(input);
  return isAbsolute(expanded) ? expanded : resolve(config.workspaceRoot, expanded);
}
