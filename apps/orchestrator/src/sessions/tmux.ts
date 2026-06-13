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

export async function newSession(opts: NewSessionOptions): Promise<void> {
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
      opts.command,
    ],
    options(),
  );
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
