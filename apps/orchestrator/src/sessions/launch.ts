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
 * Appended to an autonomous session's task so it leaves a durable handoff. The
 * session auto-stops when idle; this note means a later resume/restart can pick
 * up from recorded progress instead of starting over.
 */
export const PROGRESS_NOTE =
  'As you work, keep a concise running log at .lumpy/PROGRESS.md — what you have done, ' +
  'the current state, and the next steps — and update it before you stop, so this work ' +
  'can be resumed later without losing context.';

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
  if (task) {
    // Autonomous sessions auto-stop when idle; ask them to leave a handoff.
    const full = options.autonomous ? `${task}\n\n${PROGRESS_NOTE}` : task;
    parts.push(shquote(full));
  }

  return parts.join(' ');
}
