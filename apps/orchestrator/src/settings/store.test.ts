import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SettingsStore } from './store.js';

const seed = {
  remediationMode: 'off' as const,
  remediationAutoSeverities: ['warning'],
  secondOpinionMode: 'enforce' as const,
};

test('seeds from defaults and updates in memory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumpy-settings-'));
  try {
    const store = new SettingsStore(dir, seed);
    assert.equal(store.get().remediationMode, 'off');
    store.update({ remediationMode: 'auto' });
    assert.equal(store.get().remediationMode, 'auto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persists across instances (survives restart)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumpy-settings-'));
  try {
    new SettingsStore(dir, seed).update({ remediationMode: 'investigate' });
    const reloaded = new SettingsStore(dir, seed);
    assert.equal(reloaded.get().remediationMode, 'investigate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
