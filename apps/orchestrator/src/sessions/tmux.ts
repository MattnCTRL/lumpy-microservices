import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type RunAs, runAsEnv } from './runas.js';

const exec = promisify(execFile);

// When set, every tmux command runs as this user so sessions are owned by them
// (and share their tmux server socket). The orchestrator itself stays root.
let runAs: RunAs | null = null;

export function configureRunAs(user: RunAs | null): void {
  runAs = user;
}

function options(): { uid?: number; gid?: number; env?: NodeJS.ProcessEnv } {
  return runAs ? { uid: runAs.uid, gid: runAs.gid, env: runAsEnv(runAs) } : {};
}

export interface NewSessionOptions {
  name: string;
  cwd: string;
  command: string;
  cols: number;
  rows: number;
  /** Environment variables set on the session (via tmux -e), e.g. connector secrets. */
  env?: Record<string, string>;
}

/** Whether tmux is installed and runnable on this host. */
export async function isAvailable(): Promise<boolean> {
  try {
    await exec('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exit copy-mode (scrollback) on a session's active pane if it's in one. A mouse
 * scroll puts the pane into copy-mode, where keystrokes navigate history instead
 * of reaching the program - so typed input silently vanishes. Cancelling first
 * makes input land. No-op (and ignored) when the pane isn't in a mode.
 */
export async function cancelCopyMode(name: string): Promise<void> {
  try {
    await exec('tmux', ['send-keys', '-t', name, '-X', 'cancel'], options());
  } catch {
    // Not in copy-mode (or no such pane) - nothing to cancel.
  }
}

/** List the names of all live tmux sessions matching the given prefix. */
export async function listSessions(prefix: string): Promise<string[]> {
  try {
    const { stdout } = await exec('tmux', ['list-sessions', '-F', '#{session_name}'], options());
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name.startsWith(`${prefix}-`));
  } catch {
    // tmux exits non-zero when no server/sessions exist.
    return [];
  }
}

export async function sessionExists(name: string): Promise<boolean> {
  try {
    await exec('tmux', ['has-session', '-t', name], options());
    return true;
  } catch {
    return false;
  }
}

/**
 * Enable mouse mode on the tmux server (idempotent, global). Without it, the web
 * terminal's scroll wheel is translated to arrow keys inside Claude's full-screen
 * TUI - which recalls previous input instead of scrolling. With mouse on, tmux
 * forwards the wheel to the app (or scrolls its own buffer), so scrolling works
 * like a normal Claude Code session.
 */
export async function ensureMouse(): Promise<void> {
  try {
    await exec('tmux', ['set-option', '-g', 'mouse', 'on'], options());
  } catch {
    // No server yet, or already set; the next session create will retry.
  }
}

export async function newSession(opts: NewSessionOptions): Promise<void> {
  // Pass connector env via -e so secrets stay out of the command line (ps).
  const envArgs = Object.entries(opts.env ?? {}).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`,
  ]);
  await exec(
    'tmux',
    [
      'new-session',
      '-d',
      '-s',
      opts.name,
      '-x',
      String(opts.cols),
      '-y',
      String(opts.rows),
      '-c',
      opts.cwd,
      ...envArgs,
      opts.command,
    ],
    options(),
  );
  await ensureMouse();
}

export async function killSession(name: string): Promise<void> {
  try {
    await exec('tmux', ['kill-session', '-t', name], options());
  } catch {
    // Already gone; treat as success.
  }
}

/** Capture recent pane content (with escape sequences) to prime new viewers. */
export async function capturePane(name: string, lines = 2000): Promise<string> {
  try {
    const { stdout } = await exec(
      'tmux',
      ['capture-pane', '-e', '-p', '-t', name, '-S', `-${lines}`],
      options(),
    );
    return stdout;
  } catch {
    return '';
  }
}

/** Capture recent pane content as plain text (no escape sequences) for reading. */
export async function capturePlain(name: string, lines = 200): Promise<string> {
  try {
    const { stdout } = await exec(
      'tmux',
      ['capture-pane', '-p', '-t', name, '-S', `-${lines}`],
      options(),
    );
    return stdout;
  } catch {
    return '';
  }
}
