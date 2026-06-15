import { readFileSync } from 'node:fs';
import { config } from '../config.js';

/** mounted = the SSHFS mount exists; healthy = it is usable (not a dead mount). */
export interface MountState {
  mounted: boolean;
  healthy: boolean;
}

const NOT_MOUNTED: MountState = { mounted: false, healthy: false };

function mountPath(address: string): string | null {
  if (!config.sessionUser) return null;
  return `/home/${config.sessionUser}/macs/${address.replace(/[.:]/g, '-')}`;
}

/** /proc/mounts octal-escapes spaces/tabs/newlines in the target path; decode them. */
function unescapeMount(target: string): string {
  return target.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * The set of currently-mounted target paths, read from /proc/mounts.
 *
 * /proc/mounts is a kernel virtual file: reading it never blocks, even when a
 * FUSE mount's host is unreachable. We deliberately never stat the mount path
 * itself (no `mountpoint`, `ls`, or `stat`): touching a mount whose host is gone
 * hangs in uninterruptible I/O (D state) that cannot be killed - not even by
 * SIGKILL or an exec timeout - which previously wedged orchestrator shutdown for
 * the full stop timeout and took the whole platform offline during a deploy.
 */
function mountedTargets(): Set<string> {
  const targets = new Set<string>();
  try {
    for (const line of readFileSync('/proc/mounts', 'utf8').split('\n')) {
      const target = line.split(' ')[1];
      if (target) targets.add(unescapeMount(target));
    }
  } catch {
    // /proc unreadable: report nothing mounted rather than risk a hang.
  }
  return targets;
}

/**
 * Whether a machine's files are mounted on the orchestrator. Derived purely from
 * /proc/mounts so it can never hang. We do not probe the mount for liveness (that
 * would risk the D-state hang described above), so a present mount is reported as
 * healthy; an unreachable host shows up as offline in the fleet regardless.
 */
export async function mountState(address: string): Promise<MountState> {
  const path = mountPath(address);
  if (!path) return NOT_MOUNTED;
  const mounted = mountedTargets().has(path);
  return { mounted, healthy: mounted };
}

/** Mount state for many addresses, keyed by id (one /proc/mounts read). */
export async function mountStates(
  items: { id: string; address: string }[],
): Promise<Record<string, MountState>> {
  const targets = mountedTargets();
  const entries = items.map((item) => {
    const path = mountPath(item.address);
    const mounted = path !== null && targets.has(path);
    return [item.id, { mounted, healthy: mounted }] as const;
  });
  return Object.fromEntries(entries);
}
