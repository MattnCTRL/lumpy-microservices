import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LumpyEvent } from '@lumpy/shared';
import { buildNotification } from './notification.js';

const PUBLIC = 'https://lumpy.example.ts.net';

test('an awaiting-permission session produces an actionable notification', () => {
  const event: LumpyEvent = {
    type: 'session.activity',
    id: 'abc123',
    name: 'api refactor',
    activity: 'awaiting_permission',
    prompt: { question: 'Do you want to proceed?', options: [] },
    at: '2026-06-13T00:00:00.000Z',
  };
  const note = buildNotification(event, PUBLIC);
  assert.ok(note);
  assert.match(note.title, /api refactor/);
  assert.equal(note.message, 'Do you want to proceed?');
  assert.equal(note.actions?.length, 2);
  assert.equal(note.actions?.[0]?.url, `${PUBLIC}/api/sessions/abc123/input`);
});

test('without a public URL there are no action buttons', () => {
  const event: LumpyEvent = {
    type: 'session.activity',
    id: 'abc123',
    name: 'api refactor',
    activity: 'awaiting_permission',
    prompt: null,
    at: '2026-06-13T00:00:00.000Z',
  };
  const note = buildNotification(event, '');
  assert.ok(note);
  assert.equal(note.actions?.length, 0);
  assert.equal(note.click, undefined);
});

test('a working session does not notify', () => {
  const event: LumpyEvent = {
    type: 'session.activity',
    id: 'abc123',
    name: 'api refactor',
    activity: 'working',
    prompt: null,
    at: '2026-06-13T00:00:00.000Z',
  };
  assert.equal(buildNotification(event, PUBLIC), null);
});

test('a fired alert notifies with severity-based priority', () => {
  const event: LumpyEvent = {
    type: 'alert.fired',
    at: '2026-06-13T00:00:00.000Z',
    alert: {
      id: 'srv1:disk-critical',
      serverId: 'srv1',
      serverName: 'web-1',
      ruleId: 'disk-critical',
      label: 'Disk almost full',
      severity: 'critical',
      metric: 'diskPercent',
      value: 92,
      message: 'Disk almost full: disk at 92%',
      firedAt: '2026-06-13T00:00:00.000Z',
    },
  };
  const note = buildNotification(event, PUBLIC);
  assert.ok(note);
  assert.match(note.title, /web-1/);
  assert.equal(note.priority, 5);
  assert.equal(note.click, `${PUBLIC}/alerts`);
});

test('a resolved alert sends a low-priority notice', () => {
  const event: LumpyEvent = {
    type: 'alert.resolved',
    id: 'srv1:disk-critical',
    serverName: 'web-1',
    label: 'Disk almost full',
    at: '2026-06-13T00:00:00.000Z',
  };
  const note = buildNotification(event, PUBLIC);
  assert.ok(note);
  assert.equal(note.priority, 2);
});

test('a raw offline status no longer notifies directly (alerts handles it)', () => {
  const event: LumpyEvent = {
    type: 'fleet.server.status',
    id: 'srv1',
    name: 'web-1',
    status: 'offline',
    at: '2026-06-13T00:00:00.000Z',
  };
  assert.equal(buildNotification(event, PUBLIC), null);
});
