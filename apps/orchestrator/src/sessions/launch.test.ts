import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROGRESS_NOTE, buildLaunchCommand } from './launch.js';

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

test('an autonomous task runs headless via -p with a progress-handoff note', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: true, task: 'fix the build' }),
    `claude --dangerously-skip-permissions -p 'fix the build\n\n${PROGRESS_NOTE}'`,
  );
});

test('a non-autonomous task runs headless via -p (no progress note)', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: false, task: 'fix the build' }),
    "claude -p 'fix the build'",
  );
});

test('a task containing a quote is escaped', () => {
  assert.equal(
    buildLaunchCommand('claude', { autonomous: false, task: "it's broken" }),
    "claude -p 'it'\\''s broken'",
  );
});

test('the task is the value of -p so the variadic --mcp-config cannot swallow it', () => {
  const cmd = buildLaunchCommand('claude', {
    autonomous: true,
    task: 'do X',
    mcpConfig: '/w/.mcp.json',
  });
  // --mcp-config takes only the path; the prompt follows as -p's value.
  assert.match(cmd, /--mcp-config '\/w\/\.mcp\.json' -p '/);
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
