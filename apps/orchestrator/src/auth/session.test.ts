import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GithubUser } from '@lumpy/shared';
import { gateDecision, roleFor } from './session.js';

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
