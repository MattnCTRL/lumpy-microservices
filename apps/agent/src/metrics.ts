import { execFile } from 'node:child_process';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';
import type { MetricsReport } from '@lumpy/shared';

const exec = promisify(execFile);

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

export function memoryPercent(): number {
  const total = totalmem();
  if (total <= 0) return 0;
  return ((total - freemem()) / total) * 100;
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
    memPercent: Number(memoryPercent().toFixed(1)),
    diskPercent: Number((await diskPercent(diskPath)).toFixed(1)),
    load1: Number((loadavg()[0] ?? 0).toFixed(2)),
    uptimeSeconds: Math.floor(uptime()),
  };
}
