import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLaunchCommand } from './launch.js';

test('autonomous claude gets skip-permissions', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: true }),
    'claude --dangerously-skip-permissions',
  );
});

test('the sandbox flag adds IS_SANDBOX (for running as root)', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: true, sandbox: true }),
    'env IS_SANDBOX=1 claude --dangerously-skip-permissions',
  );
});

test('interactive claude runs plainly', () => {
  assert.equal(buildLaunchCommand('claude', { autonomous: false }), 'claude');
});

test('a task is appended as a quoted prompt', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: true, task: 'fix the build' }),
    "claude --dangerously-skip-permissions 'fix the build'",
  );
});

test('a task containing a quote is escaped', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: false, task: "it's broken" }),
    "claude 'it'\\''s broken'",
  );
});

test('non-claude commands run verbatim', () => {
  assert.equal(buildLaunchCommand('bash', { autonomous: true, task: 'x' }), 'bash');
});

test('claude --continue (resume) still gets autonomous flags', () => {
  assert.equal(
    buildLaunchCommand('claude --continue', { autonomous: true }),
    'claude --continue --dangerously-skip-permissions',
  );
});
