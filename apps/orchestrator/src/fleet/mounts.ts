import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const exec = promisify(execFile);

/** mounted = the SSHFS mount exists; healthy = it responds (not stalled). */
export interface MountState {
  mounted: boolean;
  healthy: boolean;
}

const NOT_MOUNTED: MountState = { mounted: false, healthy: false };

async function ok(cmd: string, args: string[]): Promise<boolean> {
  try {
    await exec(cmd, args, { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

function mountPath(address: string): string | null {
  if (!config.sessionUser) return null;
  return `/home/${config.sessionUser}/macs/${address.replace(/[.:]/g, '-')}`;
}

/**
 * Whether a machine's files are mounted on the orchestrator, and whether the
 * mount is responsive — a sleeping/unreachable host leaves a stalled FUSE
 * mount, so we probe with a short timeout (a stalled `ls` hangs).
 */
export async function mountState(address: string): Promise<MountState> {
  const path = mountPath(address);
  if (!path) return NOT_MOUNTED;
  if (!(await ok('mountpoint', ['-q', path]))) return NOT_MOUNTED;
  const healthy = await ok('timeout', ['3', 'ls', path]);
  return { mounted: true, healthy };
}

/** Mount state for many addresses, keyed by id, computed concurrently. */
export async function mountStates(
  items: { id: string; address: string }[],
): Promise<Record<string, MountState>> {
  const entries = await Promise.all(
    items.map(async (item) => [item.id, await mountState(item.address)] as const),
  );
  return Object.fromEntries(entries);
}
