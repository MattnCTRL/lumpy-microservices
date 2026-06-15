import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Project } from '@lumpy/shared';
import { buildProjectMcpServers, hasScopedSupabaseDb, supabaseRef } from './mcp.js';

const REF = 'abcdefghij1234567890'; // 20-char ref

test('supabaseRef parses the common Supabase URL shapes', () => {
  assert.equal(supabaseRef(`https://${REF}.supabase.co`), REF);
  assert.equal(supabaseRef(`https://${REF}.supabase.co/rest/v1`), REF);
  assert.equal(supabaseRef(`postgres://postgres:pw@db.${REF}.supabase.co:5432/postgres`), REF);
  assert.equal(
    supabaseRef(`postgresql://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`),
    REF,
  );
  assert.equal(supabaseRef(`https://app.supabase.com/project/${REF}`), REF);
  assert.equal(supabaseRef(REF), REF); // bare ref
});

test('supabaseRef rejects what it cannot scope (fail closed, no bogus ref)', () => {
  // The old loose match returned "app" here, injecting an account-wide token.
  assert.equal(supabaseRef('https://app.supabase.com'), null);
  assert.equal(supabaseRef('postgres://user:pw@my-db.example.com:5432/app'), null);
  assert.equal(supabaseRef(''), null);
  assert.equal(supabaseRef('not-a-ref'), null);
});

function project(databases: { label: string; url: string }[]): Project {
  return {
    id: 'p1',
    name: 'Test',
    slug: 'test',
    workspace: '/tmp/test',
    description: null,
    origin: 'import',
    sources: {
      repos: [],
      machineId: null,
      sourcePaths: [],
      serverIds: [],
      hostedServices: [],
      useConnectors: true,
      databases,
    },
    supabaseConfigured: true,
    createdAt: '2026-06-15T00:00:00.000Z',
  };
}

test('buildProjectMcpServers pins every Supabase server to its own --project-ref', () => {
  const servers = buildProjectMcpServers(project([{ label: 'main', url: `https://${REF}.supabase.co` }]), true);
  const keys = Object.keys(servers);
  assert.equal(keys.length, 1);
  const def = servers[keys[0]!] as { args: string[] };
  assert.ok(def.args.includes(`--project-ref=${REF}`));
  assert.ok(def.args.includes('--read-only'));
});

test('buildProjectMcpServers writes nothing without a token or for non-Supabase dbs', () => {
  assert.deepEqual(buildProjectMcpServers(project([{ label: 'main', url: `https://${REF}.supabase.co` }]), false), {});
  assert.deepEqual(
    buildProjectMcpServers(project([{ label: 'pg', url: 'postgres://u:p@host:5432/db' }]), true),
    {},
  );
});

test('hasScopedSupabaseDb gates the token on a derivable ref (not a loose match)', () => {
  assert.equal(hasScopedSupabaseDb(project([{ label: 'main', url: `https://${REF}.supabase.co` }])), true);
  // a connection string that mentions "supabase" but yields no ref must NOT gate the token open
  assert.equal(hasScopedSupabaseDb(project([{ label: 'x', url: 'https://app.supabase.com' }])), false);
  assert.equal(hasScopedSupabaseDb(project([])), false);
});
