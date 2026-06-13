import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuPercent, parseLinuxMemPercent, parseMacMemPercent } from './metrics.js';

test('cpuPercent computes busy share between snapshots', () => {
  // 50 idle ticks out of 100 total elapsed -> 50% busy.
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 }), 50);
});

test('cpuPercent reports fully busy when no idle elapsed', () => {
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 300 }), 100);
});

test('cpuPercent guards against a non-advancing total', () => {
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), 0);
});

test('linux memory uses MemAvailable, not MemFree', () => {
  const meminfo =
    'MemTotal:       1000000 kB\nMemFree:          50000 kB\nMemAvailable:    600000 kB\n';
  // used = (1,000,000 - 600,000) / 1,000,000 = 40%  (not 95% from MemFree)
  assert.equal(parseLinuxMemPercent(meminfo), 40);
});

test('mac memory counts active + wired + compressed pages', () => {
  const vmStat = [
    'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
    'Pages free:                          1000.',
    'Pages active:                        5000.',
    'Pages inactive:                      8000.',
    'Pages wired down:                    3000.',
    'Pages occupied by compressor:        2000.',
  ].join('\n');
  // used = (5000 + 3000 + 2000) * 4096 = 40,960,000 of 81,920,000 total = 50%
  assert.equal(parseMacMemPercent(vmStat, 81_920_000), 50);
});
