import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeBase } from '@lumpy/shared';
import type { RunAs } from '../sessions/runas.js';

const KNOWLEDGE_DIR = '.lumpy/knowledge';
const DRAFT_FILE = '_draft.md';

/** Where the librarian writes its proposed manual, relative to the workspace. */
export const DRAFT_PATH = `${KNOWLEDGE_DIR}/${DRAFT_FILE}`;

function own(path: string, runAs: RunAs | null): void {
  if (!runAs) return;
  try {
    chownSync(path, runAs.uid, runAs.gid);
  } catch {
    // best-effort; orchestrator may not be root
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function ensureKnowledgeDir(workspace: string, runAs: RunAs | null): string {
  const dir = join(workspace, KNOWLEDGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    own(join(workspace, '.lumpy'), runAs);
    own(dir, runAs);
  }
  return dir;
}

/** Read a project's operating manual: CLAUDE.md, knowledge docs, and any draft. */
export function readKnowledge(workspace: string): KnowledgeBase {
  const claudeMd = safeRead(join(workspace, 'CLAUDE.md'));
  const dir = join(workspace, KNOWLEDGE_DIR);
  const docs = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md') && f !== DRAFT_FILE)
        .map((name) => ({ name, content: safeRead(join(dir, name)) }))
    : [];
  const draftPath = join(dir, DRAFT_FILE);
  const draft = existsSync(draftPath) ? safeRead(draftPath) : null;
  return { claudeMd, docs, draft };
}

/** Write the governing CLAUDE.md (creating the workspace if needed). */
export function writeClaudeMd(workspace: string, content: string, runAs: RunAs | null): void {
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
    own(workspace, runAs);
  }
  const path = join(workspace, 'CLAUDE.md');
  writeFileSync(path, content);
  own(path, runAs);
}

/** Promote the librarian's draft to the governing CLAUDE.md. Returns false if no draft. */
export function approveDraft(workspace: string, runAs: RunAs | null): boolean {
  const draftPath = join(workspace, DRAFT_PATH);
  if (!existsSync(draftPath)) return false;
  writeClaudeMd(workspace, readFileSync(draftPath, 'utf8'), runAs);
  rmSync(draftPath);
  return true;
}

/** Discard a pending draft. */
export function discardDraft(workspace: string): void {
  const draftPath = join(workspace, DRAFT_PATH);
  if (existsSync(draftPath)) rmSync(draftPath);
}

export { ensureKnowledgeDir };
