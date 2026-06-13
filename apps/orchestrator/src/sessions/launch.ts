import { isClaudeCommand } from './resume.js';

export interface LaunchOptions {
  autonomous: boolean;
  task?: string | null;
  /** Set IS_SANDBOX so skip-permissions is allowed when running as root. */
  sandbox?: boolean;
}

function shquote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the shell command to run inside tmux from a base command.
 *
 * For Claude sessions, autonomous mode adds --dangerously-skip-permissions so it
 * executes without prompting. When the session runs as root, `sandbox` sets
 * IS_SANDBOX so that is permitted; non-root sessions don't need it. An optional
 * task is passed as the initial prompt. Non-Claude commands run verbatim.
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

  const task = options.task?.trim();
  if (task) parts.push(shquote(task));

  return parts.join(' ');
}
