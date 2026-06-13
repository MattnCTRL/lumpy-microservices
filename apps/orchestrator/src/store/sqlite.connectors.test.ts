import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from './sqlite.js';

function tempStore(): Store {
  return new Store(mkdtempSync(join(tmpdir(), 'lumpy-conn-')));
}

test('connectors default to empty', () => {
  const store = tempStore();
  assert.deepEqual(store.getConnectors('s1'), { env: {}, mcpServers: {}, repo: null });
});

test('connectors round-trip env, mcp servers, and repo', () => {
  const store = tempStore();
  store.setConnectors('s1', {
    env: { SUPABASE_ACCESS_TOKEN: 'secret-token' },
    mcpServers: {
      supabase: { command: 'npx', args: ['-y', '@supabase/mcp-server-supabase@latest'] },
    },
    repo: 'github.com/me/app',
  });
  const got = store.getConnectors('s1');
  assert.equal(got.env.SUPABASE_ACCESS_TOKEN, 'secret-token');
  assert.equal(got.mcpServers.supabase?.command, 'npx');
  assert.equal(got.repo, 'github.com/me/app');
});

test('env values are encrypted at rest (not stored in plaintext)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumpy-conn-'));
  const store = new Store(dir);
  store.setConnectors('s1', { env: { TOKEN: 'plaintext-secret' }, mcpServers: {}, repo: null });
  // The secret must not appear verbatim anywhere in the database file.
  const dbFile = readdirSync(dir).find((f) => f.endsWith('lumpy.db'));
  assert.ok(dbFile);
  const raw = readFileSync(join(dir, dbFile), 'latin1');
  assert.ok(!raw.includes('plaintext-secret'), 'secret should be encrypted in the db');
});

test('deleting a session also drops its connectors', () => {
  const store = tempStore();
  store.setConnectors('s1', { env: { K: 'v' }, mcpServers: {}, repo: 'r' });
  store.deleteSession('s1');
  assert.deepEqual(store.getConnectors('s1'), { env: {}, mcpServers: {}, repo: null });
});
