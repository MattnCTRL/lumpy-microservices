import { Client } from 'ssh2';
import type { MetricsReport } from '@lumpy/shared';

export interface SshTarget {
  host: string;
  port: number;
  user: string;
  privateKey?: string;
  password?: string;
}

// One round trip: identify the OS, then two CPU samples 1s apart, plus memory,
// load, uptime, disk. The /proc parsing below is Linux-only by design (macOS/BSD
// hosts run the cross-platform Lumpy agent instead).
const METRICS_COMMAND = [
  'echo OS; uname -s',
  "echo C1; grep '^cpu ' /proc/stat",
  'sleep 1',
  "echo C2; grep '^cpu ' /proc/stat",
  "echo MEM; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo",
  'echo LOAD; cat /proc/loadavg',
  'echo UP; cat /proc/uptime',
  'echo DISK; df -kP / | tail -1',
].join('; ');

function cpuTotals(line: string): { idle: number; total: number } {
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  const idle = (values[3] ?? 0) + (values[4] ?? 0); // idle + iowait
  return { idle, total };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

/** Parse the output of METRICS_COMMAND into a metrics report. */
export function parseMetrics(output: string): MetricsReport {
  const lines = output.split('\n');

  // SSH monitoring parses Linux /proc; on a Mac/BSD that yields all-zero metrics
  // that wrongly read as a healthy "online" host. Reject it with a clear message
  // so the add-server test surfaces it (and a poll never fakes zeros).
  const osIdx = lines.indexOf('OS');
  if (osIdx >= 0) {
    const os = (lines[osIdx + 1] ?? '').trim();
    if (os && !/linux/i.test(os)) {
      throw new Error(
        `SSH monitoring supports Linux only (this host is ${os}); install the Lumpy agent to monitor it instead`,
      );
    }
  }

  const cpuLines = lines.filter((line) => /^cpu\s+\d/.test(line));
  const memTotal = Number(/MemTotal:\s+(\d+)/.exec(output)?.[1] ?? 0);
  const memAvailable = Number(/MemAvailable:\s+(\d+)/.exec(output)?.[1] ?? 0);

  let cpuPercent = 0;
  if (cpuLines.length >= 2) {
    const a = cpuTotals(cpuLines[0]!);
    const b = cpuTotals(cpuLines[1]!);
    const totalDelta = b.total - a.total;
    if (totalDelta > 0) cpuPercent = clampPercent((1 - (b.idle - a.idle) / totalDelta) * 100);
  }

  const memPercent = memTotal > 0 ? clampPercent(((memTotal - memAvailable) / memTotal) * 100) : 0;

  const loadLine = lines[lines.indexOf('LOAD') + 1] ?? '';
  const load1 = Number(loadLine.trim().split(/\s+/)[0] ?? 0);

  const upLine = lines[lines.indexOf('UP') + 1] ?? '';
  const uptimeSeconds = Math.floor(Number(upLine.trim().split(/\s+/)[0] ?? 0));

  const diskLine = lines[lines.indexOf('DISK') + 1] ?? '';
  const diskPercent = Number((diskLine.trim().split(/\s+/)[4] ?? '0%').replace('%', '')) || 0;

  return {
    cpuPercent,
    memPercent,
    diskPercent: clampPercent(diskPercent),
    load1: Number.isFinite(load1) ? load1 : 0,
    uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : 0,
  };
}

/** Overall wall-clock budget for one SSH metrics collection (handshake + stream). */
const COLLECT_DEADLINE_MS = 20_000;

/** Connect to a host over SSH, collect a metrics sample, and disconnect. */
export function collectOverSsh(target: SshTarget): Promise<MetricsReport> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let deadline: ReturnType<typeof setTimeout>;

    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        client.end();
      } catch {
        // already closing
      }
      run();
    };
    const ok = (report: MetricsReport) => finish(() => resolve(report));
    const fail = (error: Error) => finish(() => reject(error));

    // readyTimeout only guards the handshake. A host that completes the handshake
    // then wedges mid-stream (slow/overloaded box, network stall) would otherwise
    // leave this promise pending forever - hanging the add/SSH HTTP handler and
    // permanently leaking the poller's in-flight slot for that host. This overall
    // deadline covers both phases so the promise always settles.
    deadline = setTimeout(() => fail(new Error('ssh metrics collection timed out')), COLLECT_DEADLINE_MS);

    client
      .on('ready', () => {
        client.exec(METRICS_COMMAND, (error, stream) => {
          if (error) return fail(error);
          let output = '';
          stream
            .on('data', (chunk: Buffer) => {
              output += chunk.toString('utf8');
            })
            .on('close', () => {
              try {
                ok(parseMetrics(output));
              } catch (parseError) {
                fail(parseError instanceof Error ? parseError : new Error('parse failed'));
              }
            });
        });
      })
      .on('error', fail)
      .connect({
        host: target.host,
        port: target.port,
        username: target.user,
        privateKey: target.privateKey,
        password: target.password,
        readyTimeout: 12_000,
      });
  });
}
