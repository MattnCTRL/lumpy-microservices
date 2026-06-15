import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import type { LumpyEvent, MetricsReport } from '@lumpy/shared';
import { EventBus } from '../events/bus.js';
import { FleetStore } from '../store/fleet.js';
import { FleetManager } from './manager.js';

const SAMPLE: MetricsReport = {
  cpuPercent: 12,
  memPercent: 40,
  diskPercent: 55,
  load1: 0.3,
  uptimeSeconds: 1000,
};

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'lumpy-fleet-'));
  const events: LumpyEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((event) => events.push(event));
  const fleet = new FleetManager(new FleetStore(dir), bus);
  return {
    dir,
    events,
    fleet,
    cleanup: () => (fleet.stop(), rmSync(dir, { recursive: true, force: true })),
  };
}

test('a newly registered server is unknown with no metrics', () => {
  const { fleet, cleanup } = harness();
  try {
    const server = fleet.register({
      name: 'web',
      address: '10.0.0.1',
      tags: [],
      kind: 'server',
      env: 'prod',
      criticality: 'high',
    });
    assert.equal(server.status, 'unknown');
    assert.equal(server.metrics, null);
    assert.equal(fleet.list().length, 1);
  } finally {
    cleanup();
  }
});

test('ingesting metrics marks a server online and emits events', () => {
  const { fleet, events, cleanup } = harness();
  try {
    const server = fleet.register({
      name: 'web',
      address: '10.0.0.1',
      tags: [],
      kind: 'server',
      env: 'prod',
      criticality: 'high',
    });
    assert.equal(fleet.ingest(server.id, SAMPLE), true);

    const current = fleet.list().find((s) => s.id === server.id);
    assert.equal(current?.status, 'online');
    assert.equal(current?.metrics?.cpuPercent, 12);

    assert.ok(events.some((e) => e.type === 'fleet.metrics' && e.id === server.id));
    assert.ok(
      events.some((e) => e.type === 'fleet.server.status' && e.status === 'online'),
      'an online status event is published',
    );
  } finally {
    cleanup();
  }
});

test('ingesting for an unknown server is rejected', () => {
  const { fleet, cleanup } = harness();
  try {
    assert.equal(fleet.ingest('nope123', SAMPLE), false);
  } finally {
    cleanup();
  }
});

test('an SSH-monitored node is driven by polling, not Tailscale presence (no flap)', () => {
  const { fleet, cleanup } = harness();
  try {
    const m = fleet.register({
      name: 'mac',
      address: '100.64.0.5',
      tags: [],
      kind: 'machine',
      env: 'prod',
      criticality: 'low',
      ssh: { host: '100.64.0.5', port: 22, user: 'x', privateKey: 'k' },
    });
    fleet.ingest(m.id, SAMPLE); // a successful poll -> online
    assert.equal(fleet.list().find((s) => s.id === m.id)?.status, 'online');
    // Presence reports it absent from the tailnet; an SSH-polled node must ignore
    // that (else it flips offline every presence tick while polls say online).
    fleet.setPresence(new Set());
    assert.equal(
      fleet.list().find((s) => s.id === m.id)?.status,
      'online',
      'SSH node status is not overwritten by presence',
    );
  } finally {
    cleanup();
  }
});

test('an agentless machine/remote is driven by Tailscale presence', () => {
  const { fleet, cleanup } = harness();
  try {
    const m = fleet.register({
      name: 'phone',
      address: '100.64.0.9',
      tags: [],
      kind: 'remote',
      env: 'prod',
      criticality: 'low',
    });
    fleet.setPresence(new Set(['100.64.0.9']));
    assert.equal(fleet.list().find((s) => s.id === m.id)?.status, 'online');
    fleet.setPresence(new Set());
    assert.equal(fleet.list().find((s) => s.id === m.id)?.status, 'offline');
  } finally {
    cleanup();
  }
});

test('a server goes offline once its heartbeat is stale', () => {
  mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const dir = mkdtempSync(join(tmpdir(), 'lumpy-fleet-'));
  const events: LumpyEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((event) => events.push(event));
  const fleet = new FleetManager(new FleetStore(dir), bus);
  try {
    const server = fleet.register({
      name: 'web',
      address: '10.0.0.1',
      tags: [],
      kind: 'server',
      env: 'prod',
      criticality: 'high',
    });
    fleet.ingest(server.id, SAMPLE);
    assert.equal(fleet.list().find((s) => s.id === server.id)?.status, 'online');

    // Advance well past the heartbeat timeout; the interval checker runs.
    mock.timers.tick(41_000);

    assert.equal(fleet.list().find((s) => s.id === server.id)?.status, 'offline');
    assert.ok(events.some((e) => e.type === 'fleet.server.status' && e.status === 'offline'));
  } finally {
    fleet.stop();
    mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});
