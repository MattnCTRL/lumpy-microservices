import { isClaudeCommand } from './resume.js';

export interface LaunchOptions {
  autonomous: boolean;
  task?: string | null;
  /** Set IS_SANDBOX so skip-permissions is allowed when running as root. */
  sandbox?: boolean;
  /**
   * Path to the workspace's .mcp.json. When set, the session uses ONLY this
   * config (--strict-mcp-config) so it can never inherit another project's or
   * the user's MCP servers - critical for keeping each project's data isolated.
   */
  mcpConfig?: string;
}

function shquote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Appended to an autonomous session's task so it leaves a durable handoff. The
 * session auto-stops when idle; this note means a later resume/restart can pick
 * up from recorded progress instead of starting over.
 */
export const PROGRESS_NOTE =
  'As you work, keep a concise running log at .lumpy/PROGRESS.md - what you have done, ' +
  'the current state, and the next steps - and update it before you stop, so this work ' +
  'can be resumed later without losing context.';

/**
 * Build the shell command to run inside tmux from a base command.
 *
 * For Claude sessions, autonomous mode adds --dangerously-skip-permissions so it
 * executes without prompting. When the session runs as root, `sandbox` sets
 * IS_SANDBOX so that is permitted; non-root sessions don't need it. An optional
 * task runs headless via -p (a run-to-completion job that exits when done).
 * Non-Claude commands run verbatim.
 */
export function buildLaunchCommand(base: string, options: LaunchOptions): string {
  if (!isClaudeCommand(base)) return base;

  const parts: string[] = [];
  if (options.autonomous) {
    if (options.sandbox) parts.push('env', 'IS_SANDBOX=1');
    parts.push(base, '--dangerously-skip-permissions');
  } else {
    parts.push(base);
  }

  // Isolate MCP: use ONLY this workspace's config, never user/global servers.
  if (options.mcpConfig) {
    parts.push('--strict-mcp-config', '--mcp-config', shquote(options.mcpConfig));
  }

  const task = options.task?.trim();
  if (task) {
    // A task is a headless one-shot job: run it to completion and exit (-p print
    // mode). It MUST be the value of -p, not a trailing positional - `--mcp-config`
    // is variadic and would otherwise swallow the prompt as another config-file
    // path, which silently killed every task session on startup.
    const full = options.autonomous ? `${task}\n\n${PROGRESS_NOTE}` : task;
    parts.push('-p', shquote(full));
  }

  return parts.join(' ');
}
