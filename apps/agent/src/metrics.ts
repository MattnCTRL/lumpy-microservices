import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, freemem, loadavg, platform, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';
import type { MetricsReport } from '@lumpy/shared';

const exec = promisify(execFile);

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export interface CpuSnapshot {
  idle: number;
  total: number;
}

/** Aggregate idle/total CPU ticks across all cores at this instant. */
export function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/** Busy percentage between two snapshots. */
export function cpuPercent(previous: CpuSnapshot, current: CpuSnapshot): number {
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

/** Linux: use MemAvailable (reclaimable cache counts as available, unlike MemFree). */
export function parseLinuxMemPercent(meminfo: string): number {
  const total = Number(/MemTotal:\s+(\d+)/.exec(meminfo)?.[1] ?? 0);
  const available = Number(/MemAvailable:\s+(\d+)/.exec(meminfo)?.[1] ?? 0);
  return total > 0 ? clampPercent(((total - available) / total) * 100) : 0;
}

/**
 * macOS: os.freemem() is misleading (most RAM is reclaimable cache/compressed),
 * so derive "used" from vm_stat as active + wired + compressed pages.
 */
export function parseMacMemPercent(vmStat: string, totalBytes: number): number {
  const pageSize = Number(/page size of (\d+)/.exec(vmStat)?.[1] ?? 4096);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vmStat)?.[1] ?? 0);
  const used =
    (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) *
    pageSize;
  return totalBytes > 0 ? clampPercent((used / totalBytes) * 100) : 0;
}

/** Accurate memory-used percentage, per platform. */
export async function memoryPercent(): Promise<number> {
  try {
    if (platform() === 'linux') return parseLinuxMemPercent(readFileSync('/proc/meminfo', 'utf8'));
    if (platform() === 'darwin') {
      const { stdout } = await exec('vm_stat');
      return parseMacMemPercent(stdout, totalmem());
    }
  } catch {
    // Fall back below.
  }
  const total = totalmem();
  return total > 0 ? clampPercent(((total - freemem()) / total) * 100) : 0;
}

/** Disk usage percentage for the filesystem containing `path`, via `df`. */
export async function diskPercent(path: string): Promise<number> {
  try {
    const { stdout } = await exec('df', ['-kP', path]);
    const lastLine = stdout.trim().split('\n').at(-1) ?? '';
    const capacity = lastLine.split(/\s+/).at(4) ?? '0%';
    return Number(capacity.replace('%', '')) || 0;
  } catch {
    return 0;
  }
}

export async function collect(
  previous: CpuSnapshot,
  current: CpuSnapshot,
  diskPath: string,
): Promise<MetricsReport> {
  return {
    cpuPercent: Number(cpuPercent(previous, current).toFixed(1)),
    memPercent: Number((await memoryPercent()).toFixed(1)),
    diskPercent: Number((await diskPercent(diskPath)).toFixed(1)),
    load1: Number((loadavg()[0] ?? 0).toFixed(2)),
    uptimeSeconds: Math.floor(uptime()),
  };
}
