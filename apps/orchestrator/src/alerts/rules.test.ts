import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerMetrics } from '@lumpy/shared';
import { DEFAULT_RULES, formatAlertMessage, isOverThreshold } from './rules.js';

const base: ServerMetrics = {
  at: 't',
  cpuPercent: 0,
  memPercent: 0,
  diskPercent: 0,
  load1: 0,
  uptimeSeconds: 0,
};

test('isOverThreshold compares the rule metric', () => {
  const diskCritical = DEFAULT_RULES.find((r) => r.id === 'disk-critical')!;
  assert.equal(isOverThreshold(diskCritical, { ...base, diskPercent: 91 }), true);
  assert.equal(isOverThreshold(diskCritical, { ...base, diskPercent: 89 }), false);
});

test('formatAlertMessage renders a readable message', () => {
  const rule = DEFAULT_RULES.find((r) => r.id === 'disk-critical')!;
  assert.equal(formatAlertMessage(rule, 92), 'Disk almost full: disk at 92%');
});
