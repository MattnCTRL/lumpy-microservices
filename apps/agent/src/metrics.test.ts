import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuPercent } from './metrics.js';

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
