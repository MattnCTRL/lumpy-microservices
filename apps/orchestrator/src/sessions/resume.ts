/** Whether a session command launches the Claude Code CLI. */
export function isClaudeCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === 'claude' || trimmed.startsWith('claude ');
}

/**
 * The command to use when resuming a session. For Claude Code sessions this
 * continues the previous conversation in the workspace; for anything else it
 * is just a relaunch of the original command.
 */
export function resumeCommand(command: string): string {
  return isClaudeCommand(command) ? 'claude --continue' : command;
}
