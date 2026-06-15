import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Store } from '../store/sqlite.js';
import { secondOpinionGate } from './consult.js';

// A store with no OpenAI key: consultCodex short-circuits before ever invoking
// the Codex CLI, so these tests are hermetic.
const noKeyStore = { getSecret: () => null } as unknown as Store;

test('gate off proceeds without consulting', async () => {
  const result = await secondOpinionGate(noKeyStore, 'off', { subject: 's', prompt: 'p' });
  assert.equal(result.proceed, true);
  assert.equal(result.verdict.available, false);
});

test('gate fails open (proceeds) when no key is configured', async () => {
  for (const mode of ['advisory', 'enforce'] as const) {
    const result = await secondOpinionGate(noKeyStore, mode, { subject: 's', prompt: 'p' });
    assert.equal(result.proceed, true, `${mode} must fail open without a key`);
    assert.equal(result.verdict.available, false);
  }
});
