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
    at: '2026-06-13T00:00:00.000Z',
  };
  const note = buildNotification(event, PUBLIC);
  assert.ok(note);
  assert.match(note.title, /api refactor/);
  assert.equal(note.actions?.length, 2);
  assert.equal(note.actions?.[0]?.url, `${PUBLIC}/api/sessions/abc123/input`);
});

test('without a public URL there are no action buttons', () => {
  const event: LumpyEvent = {
    type: 'session.activity',
    id: 'abc123',
    name: 'api refactor',
    activity: 'awaiting_permission',
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
    at: '2026-06-13T00:00:00.000Z',
  };
  assert.equal(buildNotification(event, PUBLIC), null);
});

test('a server going offline notifies', () => {
  const event: LumpyEvent = {
    type: 'fleet.server.status',
    id: 'srv1',
    name: 'web-1',
    status: 'offline',
    at: '2026-06-13T00:00:00.000Z',
  };
  const note = buildNotification(event, PUBLIC);
  assert.ok(note);
  assert.match(note.title, /web-1/);
  assert.equal(note.click, `${PUBLIC}/fleet`);
});

test('a server coming online does not notify', () => {
  const event: LumpyEvent = {
    type: 'fleet.server.status',
    id: 'srv1',
    name: 'web-1',
    status: 'online',
    at: '2026-06-13T00:00:00.000Z',
  };
  assert.equal(buildNotification(event, PUBLIC), null);
});
