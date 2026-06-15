import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Alert } from '@lumpy/shared';
import { Store } from './sqlite.js';

function tempStore(): Store {
  return new Store(mkdtempSync(join(tmpdir(), 'lumpy-rem-')));
}

const alert: Alert = {
  id: 'srv1:disk-critical',
  serverId: 'srv1',
  serverName: 'web-1',
  ruleId: 'disk-critical',
  label: 'Disk almost full',
  severity: 'critical',
  metric: 'diskPercent',
  value: 96,
  message: 'Disk almost full: disk at 96%',
  firedAt: '2026-06-15T00:00:00.000Z',
};

test('a pending remediation round-trips and survives a reopen of the DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumpy-rem-'));
  const store = new Store(dir);
  store.addPendingRemediation(alert, '2026-06-15T00:00:01.000Z');

  const reopened = new Store(dir); // simulate an orchestrator restart
  const got = reopened.getPendingRemediation(alert.id);
  assert.ok(got, 'pending remediation persisted across restart');
  assert.equal(got.serverName, 'web-1');
  assert.equal(reopened.listPendingRemediations().length, 1);
  assert.equal(reopened.listPendingRemediations()[0]?.createdAt, '2026-06-15T00:00:01.000Z');
});

test('approving/dismissing removes the pending remediation', () => {
  const store = tempStore();
  store.addPendingRemediation(alert, '2026-06-15T00:00:01.000Z');
  store.removePendingRemediation(alert.id);
  assert.equal(store.getPendingRemediation(alert.id), null);
  assert.equal(store.listPendingRemediations().length, 0);
});

test('adding the same alert twice keeps a single pending row', () => {
  const store = tempStore();
  store.addPendingRemediation(alert, '2026-06-15T00:00:01.000Z');
  store.addPendingRemediation(alert, '2026-06-15T00:05:00.000Z');
  assert.equal(store.listPendingRemediations().length, 1);
});
