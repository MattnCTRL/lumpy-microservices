import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

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
    const { stdout } = await exec('tmux', ['list-sessions', '-F', '#{session_name}']);
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
    await exec('tmux', ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}

export async function newSession(options: NewSessionOptions): Promise<void> {
  await exec('tmux', [
    'new-session',
    '-d',
    '-s',
    options.name,
    '-x',
    String(options.cols),
    '-y',
    String(options.rows),
    '-c',
    options.cwd,
    options.command,
  ]);
}

export async function killSession(name: string): Promise<void> {
  try {
    await exec('tmux', ['kill-session', '-t', name]);
  } catch {
    // Already gone; treat as success.
  }
}

/** Capture recent pane content (with escape sequences) to prime new viewers. */
export async function capturePane(name: string, lines = 2000): Promise<string> {
  try {
    const { stdout } = await exec('tmux', [
      'capture-pane',
      '-e',
      '-p',
      '-t',
      name,
      '-S',
      `-${lines}`,
    ]);
    return stdout;
  } catch {
    return '';
  }
}
