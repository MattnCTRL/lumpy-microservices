import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from './sqlite.js';

function tempStore(): Store {
  return new Store(mkdtempSync(join(tmpdir(), 'lumpy-inc-')));
}

const svc = {
  url: 'https://app.example.com',
  name: 'App',
  projectId: 'p1',
  projectName: 'Proj',
  statusCode: 503,
};

test('opening an incident is idempotent while one is open', () => {
  const store = tempStore();
  assert.equal(store.openHostedIncident(svc, '2026-06-14T00:00:00.000Z'), true);
  assert.equal(store.openHostedIncident(svc, '2026-06-14T00:01:00.000Z'), false);
  assert.equal(store.listHostedIncidents().length, 1);
});

test('resolving closes the open incident and a new down opens another', () => {
  const store = tempStore();
  store.openHostedIncident(svc, '2026-06-14T00:00:00.000Z');
  assert.equal(store.resolveHostedIncident(svc.url, '2026-06-14T00:10:00.000Z'), true);
  // No open incident now → resolving again is a no-op.
  assert.equal(store.resolveHostedIncident(svc.url, '2026-06-14T00:11:00.000Z'), false);
  // A fresh down opens a second incident.
  assert.equal(store.openHostedIncident(svc, '2026-06-14T00:20:00.000Z'), true);
  assert.equal(store.listHostedIncidents().length, 2);
});

test('uptime reflects recorded downtime within the window', () => {
  const store = tempStore();
  const now = Date.parse('2026-06-14T12:00:00.000Z');
  const dayAgo = now - 86_400_000;
  // 100% when there are no incidents.
  assert.equal(store.hostedUptime(svc.url, dayAgo, now), 1);
  // A resolved 1h outage inside the last 24h → ~95.83% uptime.
  store.openHostedIncident(svc, new Date(now - 3 * 3_600_000).toISOString());
  store.resolveHostedIncident(svc.url, new Date(now - 2 * 3_600_000).toISOString());
  const uptime = store.hostedUptime(svc.url, dayAgo, now);
  assert.ok(Math.abs(uptime - 23 / 24) < 0.001, `expected ~0.9583, got ${uptime}`);
});

test('an unresolved incident counts downtime up to now', () => {
  const store = tempStore();
  const now = Date.parse('2026-06-14T12:00:00.000Z');
  const dayAgo = now - 86_400_000;
  // Down since 6h ago, still open → 6h of 24h is down → 75% uptime.
  store.openHostedIncident(svc, new Date(now - 6 * 3_600_000).toISOString());
  const uptime = store.hostedUptime(svc.url, dayAgo, now);
  assert.ok(Math.abs(uptime - 18 / 24) < 0.001, `expected ~0.75, got ${uptime}`);
});
