import { isClaudeCommand } from './resume.js';

export interface LaunchOptions {
  autonomous: boolean;
  task?: string | null;
}

function shquote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the shell command to run inside tmux from a base command.
 *
 * For Claude sessions, autonomous mode adds --dangerously-skip-permissions so it
 * executes without prompting, and IS_SANDBOX lets that run as root on the
 * orchestrator host. An optional task is passed as the initial prompt. Non-Claude
 * commands are returned verbatim.
 */
export function buildLaunchCommand(base: string, options: LaunchOptions): string {
  if (!isClaudeCommand(base)) return base;

  const parts: string[] = [];
  if (options.autonomous) {
    parts.push('env', 'IS_SANDBOX=1', base, '--dangerously-skip-permissions');
  } else {
    parts.push(base);
  }

  const task = options.task?.trim();
  if (task) parts.push(shquote(task));

  return parts.join(' ');
}
