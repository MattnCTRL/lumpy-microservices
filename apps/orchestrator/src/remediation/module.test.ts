import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Alert } from '@lumpy/shared';
import { EventBus } from '../events/bus.js';
import type { ModuleContext } from '../modules/types.js';
import { remediationModule } from './module.js';

function sampleAlert(): Alert {
  return {
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
}

function harness(mode: 'off' | 'investigate' | 'auto') {
  const bus = new EventBus();
  const created: Array<Record<string, unknown>> = [];
  const sessions = {
    create: async (args: Record<string, unknown>) => {
      created.push(args);
      return { id: 'sess1' };
    },
  };
  const ctx = {
    bus,
    sessions,
    config: {
      remediationMode: mode,
      workspaceRoot: '/home/lumpy/projects',
      defaultCommand: 'claude',
    },
    app: {},
    logger: {},
  } as unknown as ModuleContext;
  remediationModule.register(ctx);
  return { bus, created };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('investigate mode starts an autonomous session on alert.fired', async () => {
  const { bus, created } = harness('investigate');
  bus.publish({ type: 'alert.fired', alert: sampleAlert(), at: 't' });
  await tick();
  assert.equal(created.length, 1);
  assert.equal(created[0]!.autonomous, true);
  assert.match(String(created[0]!.task), /Disk almost full/);
});

test('does not start twice for the same active alert', async () => {
  const { bus, created } = harness('auto');
  bus.publish({ type: 'alert.fired', alert: sampleAlert(), at: 't' });
  bus.publish({ type: 'alert.fired', alert: sampleAlert(), at: 't' });
  await tick();
  assert.equal(created.length, 1);
});

test('off mode does nothing', async () => {
  const { bus, created } = harness('off');
  bus.publish({ type: 'alert.fired', alert: sampleAlert(), at: 't' });
  await tick();
  assert.equal(created.length, 0);
});
