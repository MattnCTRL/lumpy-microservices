import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Alert, AlertSeverity, LumpyEvent } from '@lumpy/shared';
import { EventBus } from '../events/bus.js';
import type { ModuleContext } from '../modules/types.js';
import { remediationModule } from './module.js';

function sampleAlert(severity: AlertSeverity): Alert {
  return {
    id: `s1:${severity}`,
    serverId: 's1',
    serverName: 'web',
    ruleId: 'disk',
    label: 'Disk',
    severity,
    metric: 'diskPercent',
    value: 92,
    message: 'Disk almost full',
    firedAt: 't',
  };
}

type RouteHandler = (req: { params: unknown }, reply: unknown) => Promise<unknown>;

function harness(mode: 'off' | 'investigate' | 'auto', autoSeverities = ['warning']) {
  const bus = new EventBus();
  const created: Array<Record<string, unknown>> = [];
  const events: LumpyEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const routes: Record<string, RouteHandler> = {};
  const ctx = {
    bus,
    sessions: {
      create: async (args: Record<string, unknown>) => {
        created.push(args);
        return { id: 'sess1' };
      },
    },
    app: {
      post: (path: string, handler: RouteHandler) => {
        routes[path] = handler;
      },
    },
    config: {
      workspaceRoot: '/home/lumpy/projects',
      defaultCommand: 'claude',
    },
    settings: {
      get: () => ({ remediationMode: mode, remediationAutoSeverities: autoSeverities }),
      update: () => ({ remediationMode: mode, remediationAutoSeverities: autoSeverities }),
    },
    logger: {},
  } as unknown as ModuleContext;
  remediationModule.register(ctx);
  return { bus, created, events, routes };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const noopReply = { status: () => ({ send: () => undefined }) };

test('a warning auto-remediates immediately', async () => {
  const { bus, created } = harness('investigate');
  bus.publish({ type: 'alert.fired', alert: sampleAlert('warning'), at: 't' });
  await tick();
  assert.equal(created.length, 1);
});

test('a critical waits for approval, then runs when approved', async () => {
  const { bus, created, events, routes } = harness('investigate');
  bus.publish({ type: 'alert.fired', alert: sampleAlert('critical'), at: 't' });
  await tick();
  assert.equal(created.length, 0, 'no session before approval');
  assert.ok(events.some((e) => e.type === 'remediation.pending'));

  const approve = routes['/api/remediation/:id/approve'];
  assert.ok(approve, 'approve route registered');
  await approve({ params: { id: 's1:critical' } }, noopReply);
  await tick();
  assert.equal(created.length, 1, 'session created after approval');
});

test('off mode does nothing', async () => {
  const { bus, created } = harness('off');
  bus.publish({ type: 'alert.fired', alert: sampleAlert('warning'), at: 't' });
  await tick();
  assert.equal(created.length, 0);
});
