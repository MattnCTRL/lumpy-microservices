import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GithubUser } from '@lumpy/shared';
import { gateDecision, roleFor, wsSessionAccess } from './session.js';

const admin: GithubUser = { login: 'matt', name: 'Matt', avatarUrl: '', role: 'admin' };
const viewer: GithubUser = { login: 'guest', name: null, avatarUrl: '', role: 'viewer' };

test('no admin list means everyone is admin (cannot lock out the owner)', () => {
  assert.equal(roleFor('matt', []), 'admin');
  assert.equal(roleFor('anyone', []), 'admin');
});

test('admin list grants admin to listed logins, viewer to the rest', () => {
  assert.equal(roleFor('Matt', ['matt']), 'admin'); // case-insensitive
  assert.equal(roleFor('someone-else', ['matt']), 'viewer');
});

test('health and auth routes are always allowed, even unauthenticated', () => {
  assert.equal(gateDecision(null, 'GET', '/api/health'), 'allow');
  assert.equal(gateDecision(null, 'GET', '/api/auth/github/login'), 'allow');
});

test('protected routes require a signed-in user', () => {
  assert.equal(gateDecision(null, 'GET', '/api/sessions'), 'unauthenticated');
  assert.equal(gateDecision(viewer, 'GET', '/api/sessions'), 'allow');
});

test('viewers are read-only; admins may mutate', () => {
  assert.equal(gateDecision(viewer, 'GET', '/api/fleet/servers'), 'allow');
  assert.equal(gateDecision(viewer, 'POST', '/api/fleet/servers'), 'forbidden');
  assert.equal(gateDecision(admin, 'POST', '/api/fleet/servers'), 'allow');
  assert.equal(gateDecision(admin, 'DELETE', '/api/alerts/x'), 'allow');
});

test('session WebSocket: gating off means full control for everyone', () => {
  assert.equal(wsSessionAccess(null, false, false), 'full');
  assert.equal(wsSessionAccess(viewer, false, true), 'full');
});

test('session WebSocket: viewers are read-only and cannot attach to locked sessions', () => {
  assert.equal(wsSessionAccess(null, true, false), 'deny-unauthenticated');
  assert.equal(wsSessionAccess(viewer, true, false), 'read-only');
  assert.equal(wsSessionAccess(viewer, true, true), 'deny-forbidden'); // the Conductor
  assert.equal(wsSessionAccess(admin, true, true), 'full');
  assert.equal(wsSessionAccess(admin, true, false), 'full');
});

test('authorized agents may push telemetry without a user', () => {
  // metric push and self-registration, agent authorized
  assert.equal(gateDecision(null, 'POST', '/api/fleet/servers/abc/metrics', true), 'allow');
  assert.equal(gateDecision(null, 'POST', '/api/fleet/servers', true), 'allow');
  // unauthorized agent (wrong/missing token) still needs a user
  assert.equal(gateDecision(null, 'POST', '/api/fleet/servers/abc/metrics', false), 'unauthenticated');
  // the exemption is scoped to ingestion only - not arbitrary writes
  assert.equal(gateDecision(null, 'DELETE', '/api/fleet/servers/abc', true), 'unauthenticated');
  assert.equal(gateDecision(null, 'POST', '/api/sessions', true), 'unauthenticated');
});
