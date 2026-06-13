import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export interface SessionRecord {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  createdAt: string;
  lastActivityAt: string | null;
}

interface SessionRow {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string;
  created_at: string;
  last_activity_at: string | null;
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    name: row.name,
    workspace: row.workspace,
    command: row.command,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

/** Metadata store for sessions. tmux remains the source of truth for liveness. */
export class Store {
  private readonly db: Database.Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'lumpy.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace TEXT NOT NULL,
        command TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_activity_at TEXT
      );
    `);
  }

  createSession(record: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, name, workspace, command, tags, created_at, last_activity_at)
         VALUES (@id, @name, @workspace, @command, @tags, @created_at, @last_activity_at)`,
      )
      .run({
        id: record.id,
        name: record.name,
        workspace: record.workspace,
        command: record.command,
        tags: JSON.stringify(record.tags),
        created_at: record.createdAt,
        last_activity_at: record.lastActivityAt,
      });
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? toRecord(row) : null;
  }

  listSessions(): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all() as SessionRow[];
    return rows.map(toRecord);
  }

  touchSession(id: string, at: string): void {
    this.db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(at, id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
}
