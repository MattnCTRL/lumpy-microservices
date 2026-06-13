import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Alert } from '@lumpy/shared';
import { buildRemediationTask } from './task.js';

const alert: Alert = {
  id: 's1:disk-critical',
  serverId: 's1',
  serverName: 'web',
  ruleId: 'disk-critical',
  label: 'Disk almost full',
  severity: 'critical',
  metric: 'diskPercent',
  value: 92,
  message: 'Disk almost full: disk at 92%',
  firedAt: 't',
};

test('investigate task includes context and forbids changes', () => {
  const task = buildRemediationTask(alert, 'investigate');
  assert.match(task, /web/);
  assert.match(task, /Disk almost full: disk at 92%/);
  assert.match(task, /Do NOT make any changes/);
});

test('auto task permits safe, non-destructive remediation', () => {
  const task = buildRemediationTask(alert, 'auto');
  assert.match(task, /remediate/);
  assert.match(task, /non-destructive/);
});

test('playbook guidance replaces the generic body but keeps the mode constraint', () => {
  const task = buildRemediationTask(alert, 'investigate', 'Clear safe disk space only.');
  assert.match(task, /Clear safe disk space only\./);
  assert.match(task, /Do NOT make any changes/);
});
