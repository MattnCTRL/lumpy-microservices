import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isClaudeCommand, resumeCommand } from './resume.js';

test('isClaudeCommand recognizes claude invocations', () => {
  assert.equal(isClaudeCommand('claude'), true);
  assert.equal(isClaudeCommand('claude --continue'), true);
  assert.equal(isClaudeCommand('  claude  '), true);
  assert.equal(isClaudeCommand('bash'), false);
  assert.equal(isClaudeCommand('claudette'), false);
});

test('resumeCommand continues claude and relaunches others verbatim', () => {
  assert.equal(resumeCommand('claude'), 'claude --continue');
  assert.equal(resumeCommand('bash'), 'bash');
});
