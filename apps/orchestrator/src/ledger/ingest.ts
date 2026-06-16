import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerCategory, LedgerScope } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { Store } from '../store/sqlite.js';

// A finished task records compact outcomes here (one JSON object per line); the
// orchestrator ingests them into the ledger on completion, then clears the file.
const OUTCOME_REL = '.lumpy/outcome.jsonl';

const VALID: ReadonlySet<string> = new Set<LedgerCategory>([
  'fact',
  'decision',
  'check',
  'gotcha',
  'source',
  'access',
  'playbook',
  'pointer',
  'rule',
  'maintenance',
]);

/**
 * Ingest a finished task's compact outcomes into the ledger (deduped by the store),
 * then clear the file so the same outcomes aren't re-counted. Each line is a JSON
 * object: { category, statement, detail? }. Returns how many were recorded.
 */
export function ingestOutcomes(
  store: Store,
  workspace: string,
  scope: LedgerScope,
  projectId: string | null,
  source: string,
  at: string,
): number {
  if (!workspace) return 0;
  const path = join(workspace, OUTCOME_REL);
  if (!existsSync(path)) return 0;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as { category?: string; statement?: string; detail?: string };
      const category = (o.category ?? '').trim();
      if (!o.statement || !VALID.has(category)) continue;
      store.recordLedger(
        { scope, projectId, category: category as LedgerCategory, statement: o.statement, detail: o.detail ?? null, source },
        at,
      );
      n += 1;
    } catch {
      // skip malformed line
    }
  }
  try {
    writeFileSync(path, '');
  } catch {
    // best-effort clear
  }
  if (n) logger.info({ workspace, n }, 'ingested task outcomes into the ledger');
  return n;
}

/**
 * A compact digest of a project's ledger, seeded into a new task's prompt so it
 * builds on prior knowledge and skips redundant work (checks already run, decisions
 * already made, where the data/keys live). Kept terse - signal, not transcripts.
 */
export function ledgerDigest(store: Store, projectId: string | null, limit = 60): string {
  const entries = store.listLedger('project', projectId, limit);
  if (!entries.length) return '';
  const byCat = new Map<string, string[]>();
  for (const e of entries) {
    const label = e.count > 1 ? `${e.statement} (x${e.count})` : e.statement;
    const list = byCat.get(e.category) ?? [];
    list.push(label);
    byCat.set(e.category, list);
  }
  const order = ['fact', 'decision', 'source', 'gotcha', 'check', 'access'];
  const lines: string[] = [];
  for (const cat of order) {
    const list = byCat.get(cat);
    if (list?.length) lines.push(`- ${cat}: ${list.slice(0, 12).join('; ')}`);
  }
  return lines.join('\n');
}
