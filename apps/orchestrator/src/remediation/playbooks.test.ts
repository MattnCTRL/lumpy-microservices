import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PLAYBOOKS, findPlaybook } from './playbooks.js';

test('findPlaybook matches an alert rule to its playbook', () => {
  assert.equal(findPlaybook('disk-critical')?.id, 'disk-cleanup');
  assert.equal(findPlaybook('disk-warning')?.id, 'disk-cleanup');
  assert.equal(findPlaybook('cpu-warning')?.id, 'cpu-triage');
  assert.equal(findPlaybook('offline')?.id, 'offline-check');
});

test('findPlaybook returns undefined for an unknown rule', () => {
  assert.equal(findPlaybook('nonexistent-rule'), undefined);
});

test('every playbook covers at least one rule and has a task', () => {
  for (const playbook of DEFAULT_PLAYBOOKS) {
    assert.ok(playbook.ruleIds.length > 0, `${playbook.id} has rules`);
    assert.ok(playbook.task.length > 0, `${playbook.id} has a task`);
  }
});
