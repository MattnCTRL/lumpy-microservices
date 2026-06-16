import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from './sqlite.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lumpy-ledger-'));
}

test('a ledger entry round-trips and survives a reopen of the DB', () => {
  const dir = tempDir();
  const store = new Store(dir);
  store.recordLedger(
    { scope: 'project', projectId: 'p1', category: 'fact', statement: 'uses pnpm', source: 'librarian' },
    '2026-06-15T00:00:00.000Z',
  );

  const reopened = new Store(dir); // simulate an orchestrator restart
  const rows = reopened.listLedger('project', 'p1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.statement, 'uses pnpm');
  assert.equal(rows[0]?.count, 1);
  assert.equal(rows[0]?.adopted, false);
  assert.equal(rows[0]?.source, 'librarian');
});

test('recording the same fact again dedups (bumps count + last_at, not a new row)', () => {
  const store = new Store(tempDir());
  store.recordLedger(
    { scope: 'project', projectId: 'p1', category: 'check', statement: 'disk check - no anomalies' },
    '2026-06-15T00:00:00.000Z',
  );
  store.recordLedger(
    { scope: 'project', projectId: 'p1', category: 'check', statement: 'disk check - no anomalies' },
    '2026-06-15T01:00:00.000Z',
  );

  const rows = store.listLedger('project', 'p1');
  assert.equal(rows.length, 1, 'deduped into a single row');
  assert.equal(rows[0]?.count, 2);
  assert.equal(rows[0]?.lastAt, '2026-06-15T01:00:00.000Z');
});

test('an access entry leaned on >= 3 times is adopted as cached truth', () => {
  const store = new Store(tempDir());
  const access = {
    scope: 'project' as const,
    projectId: 'p1',
    category: 'access' as const,
    statement: 'read Supabase prod URL',
  };
  store.recordLedger(access, '2026-06-15T00:00:00.000Z');
  store.recordLedger(access, '2026-06-15T00:01:00.000Z');
  assert.equal(store.listLedger('project', 'p1')[0]?.adopted, false, 'not yet adopted at 2 reads');

  store.recordLedger(access, '2026-06-15T00:02:00.000Z');
  assert.equal(store.listLedger('project', 'p1')[0]?.adopted, true, 'adopted at the 3rd read');
});

test('project and conductor scopes are isolated', () => {
  const store = new Store(tempDir());
  store.recordLedger(
    { scope: 'project', projectId: 'p1', category: 'fact', statement: 'project fact' },
    '2026-06-15T00:00:00.000Z',
  );
  store.recordLedger(
    { scope: 'conductor', category: 'playbook', statement: 'conductor rule' },
    '2026-06-15T00:00:00.000Z',
  );

  assert.equal(store.listLedger('project', 'p1').length, 1);
  assert.equal(store.listLedger('project', 'p1')[0]?.statement, 'project fact');
  assert.equal(store.listLedger('conductor', null).length, 1);
  assert.equal(store.listLedger('conductor', null)[0]?.statement, 'conductor rule');
});

test('the same statement in two projects stays separate', () => {
  const store = new Store(tempDir());
  const at = '2026-06-15T00:00:00.000Z';
  store.recordLedger({ scope: 'project', projectId: 'p1', category: 'fact', statement: 'shared name' }, at);
  store.recordLedger({ scope: 'project', projectId: 'p2', category: 'fact', statement: 'shared name' }, at);

  assert.equal(store.listLedger('project', 'p1').length, 1);
  assert.equal(store.listLedger('project', 'p2').length, 1);
  assert.equal(store.listLedger('project', 'p1')[0]?.count, 1, 'not merged across projects');
});

test('deleting a project clears only its ledger', () => {
  const store = new Store(tempDir());
  const at = '2026-06-15T00:00:00.000Z';
  store.recordLedger({ scope: 'project', projectId: 'p1', category: 'fact', statement: 'a' }, at);
  store.recordLedger({ scope: 'project', projectId: 'p2', category: 'fact', statement: 'b' }, at);
  store.recordLedger({ scope: 'conductor', category: 'playbook', statement: 'c' }, at);

  store.deleteLedgerForProject('p1');

  assert.equal(store.listLedger('project', 'p1').length, 0, "p1's ledger gone");
  assert.equal(store.listLedger('project', 'p2').length, 1, "p2's ledger untouched");
  assert.equal(store.listLedger('conductor', null).length, 1, 'conductor scope untouched');
});

test('an empty statement is ignored', () => {
  const store = new Store(tempDir());
  store.recordLedger(
    { scope: 'project', projectId: 'p1', category: 'fact', statement: '   ' },
    '2026-06-15T00:00:00.000Z',
  );
  assert.equal(store.listLedger('project', 'p1').length, 0);
});
