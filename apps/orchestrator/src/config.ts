import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

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
};

/** Resolve a (possibly relative or ~-prefixed) workspace path against the root. */
export function resolveWorkspace(input: string | undefined): string {
  if (!input) return config.workspaceRoot;
  const expanded = expandHome(input);
  return isAbsolute(expanded) ? expanded : resolve(config.workspaceRoot, expanded);
}
