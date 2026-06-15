import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMetrics } from './collect.js';

const SAMPLE = [
  'OS',
  'Linux',
  'C1',
  'cpu  100 0 50 1000 10 0 5 0 0 0',
  'C2',
  'cpu  140 0 60 1080 10 0 5 0 0 0',
  'MEM',
  'MemTotal:        2000000 kB',
  'MemAvailable:    1500000 kB',
  'LOAD',
  '0.42 0.30 0.25 1/200 1234',
  'UP',
  '123456.78 100000.00',
  'DISK',
  '/dev/sda1 40000000 8000000 32000000 20% /',
].join('\n');

test('parseMetrics extracts cpu/mem/disk/load/uptime from /proc output', () => {
  const metrics = parseMetrics(SAMPLE);
  // busy = (1 - idleDelta/totalDelta) * 100 = (1 - 80/130) * 100 ≈ 38.5
  assert.ok(metrics.cpuPercent > 37 && metrics.cpuPercent < 40, `cpu ${metrics.cpuPercent}`);
  assert.equal(metrics.memPercent, 25);
  assert.equal(metrics.diskPercent, 20);
  assert.equal(metrics.load1, 0.42);
  assert.equal(metrics.uptimeSeconds, 123456);
});

test('parseMetrics is resilient to empty output', () => {
  const metrics = parseMetrics('');
  assert.equal(metrics.cpuPercent, 0);
  assert.equal(metrics.memPercent, 0);
});

test('parseMetrics rejects a non-Linux host instead of reporting fake zeros', () => {
  const darwin = ['OS', 'Darwin', 'C1', 'cpu  1 0 1 1 0 0 0 0 0 0'].join('\n');
  assert.throws(() => parseMetrics(darwin), /Linux only/);
});
