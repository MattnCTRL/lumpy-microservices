import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LumpyEvent, ServerMetrics } from '@lumpy/shared';
import { EventBus } from '../events/bus.js';
import { AlertsManager } from './manager.js';

function metrics(over: Partial<ServerMetrics>): ServerMetrics {
  return {
    at: 't',
    cpuPercent: 1,
    memPercent: 1,
    diskPercent: 1,
    load1: 0,
    uptimeSeconds: 1,
    ...over,
  };
}

function harness() {
  const bus = new EventBus();
  const manager = new AlertsManager(bus);
  const events: LumpyEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return { bus, events, manager };
}

function diskMetric(diskPercent: number) {
  return {
    type: 'fleet.metrics' as const,
    id: 's1',
    name: 'web',
    metrics: metrics({ diskPercent }),
    at: 't',
  };
}

test('fires a critical alert when disk crosses 90%', () => {
  const { bus, events } = harness();
  bus.publish({
    type: 'fleet.metrics',
    id: 's1',
    name: 'web',
    metrics: metrics({ diskPercent: 92 }),
    at: 't',
  });
  const fired = events.find((e) => e.type === 'alert.fired');
  assert.ok(fired && fired.type === 'alert.fired');
  assert.equal(fired.alert.severity, 'critical');
  assert.equal(fired.alert.serverName, 'web');
});

test('does not fire twice for a persisting condition', () => {
  const { bus, events } = harness();
  for (let i = 0; i < 4; i++) {
    bus.publish({
      type: 'fleet.metrics',
      id: 's1',
      name: 'web',
      metrics: metrics({ diskPercent: 92 }),
      at: 't',
    });
  }
  assert.equal(events.filter((e) => e.type === 'alert.fired').length, 1);
});

test('resolves after the metric stays normal (hysteresis: not on a single dip)', () => {
  const { bus, events } = harness();
  bus.publish(diskMetric(92)); // fire critical
  bus.publish(diskMetric(40)); // one dip - must NOT resolve yet
  assert.equal(
    events.some((e) => e.type === 'alert.resolved'),
    false,
    'a single below-threshold sample does not resolve',
  );
  bus.publish(diskMetric(40));
  bus.publish(diskMetric(40)); // sustained normal -> resolves
  assert.ok(events.some((e) => e.type === 'alert.resolved'));
});

test('a sustained CPU rule needs repeated samples', () => {
  const { bus, events } = harness();
  // cpu-warning requires 3 consecutive samples over 90
  bus.publish({
    type: 'fleet.metrics',
    id: 's1',
    name: 'web',
    metrics: metrics({ cpuPercent: 95 }),
    at: 't',
  });
  bus.publish({
    type: 'fleet.metrics',
    id: 's1',
    name: 'web',
    metrics: metrics({ cpuPercent: 95 }),
    at: 't',
  });
  assert.equal(
    events.some((e) => e.type === 'alert.fired'),
    false,
  );
  bus.publish({
    type: 'fleet.metrics',
    id: 's1',
    name: 'web',
    metrics: metrics({ cpuPercent: 95 }),
    at: 't',
  });
  assert.ok(events.some((e) => e.type === 'alert.fired'));
});

test('dismiss suppresses re-firing until the condition clears and recurs', () => {
  const { bus, events, manager } = harness();
  bus.publish(diskMetric(92));
  const fired = events.find((e) => e.type === 'alert.fired');
  assert.ok(fired && fired.type === 'alert.fired');
  manager.dismiss(fired.alert.id);

  events.length = 0;
  bus.publish(diskMetric(92));
  bus.publish(diskMetric(92));
  assert.equal(events.filter((e) => e.type === 'alert.fired').length, 0);

  // Sustained-normal re-arms (hysteresis), then a recurrence fires again.
  bus.publish(diskMetric(40));
  bus.publish(diskMetric(40));
  bus.publish(diskMetric(40));
  bus.publish(diskMetric(92));
  assert.ok(events.some((e) => e.type === 'alert.fired'));
});

test('removing a server clears its active alerts', () => {
  const { bus, manager } = harness();
  bus.publish(diskMetric(92));
  assert.equal(manager.activeAlerts().length, 1);
  bus.publish({ type: 'fleet.server.removed', id: 's1', name: 'web', at: 't' });
  assert.equal(manager.activeAlerts().length, 0);
});

test('an offline server fires a critical alert and resolves on return', () => {
  const { bus, events } = harness();
  bus.publish({ type: 'fleet.server.status', id: 's1', name: 'web', kind: 'server', status: 'offline', at: 't' });
  const fired = events.find((e) => e.type === 'alert.fired');
  assert.ok(fired && fired.type === 'alert.fired' && fired.alert.ruleId === 'offline');
  bus.publish({ type: 'fleet.server.status', id: 's1', name: 'web', kind: 'server', status: 'online', at: 't' });
  assert.ok(events.some((e) => e.type === 'alert.resolved'));
});

test('a remote going offline does NOT fire an alert (sleeping is normal)', () => {
  const { bus, manager, events } = harness();
  bus.publish({ type: 'fleet.server.status', id: 'p1', name: 'mattPhone', kind: 'remote', status: 'offline', at: 't' });
  assert.equal(manager.activeAlerts().length, 0);
  assert.ok(!events.some((e) => e.type === 'alert.fired'));
});
