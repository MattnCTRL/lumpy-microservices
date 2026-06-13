import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { McpServerDef, SessionConnectors } from '@lumpy/shared';
import { decryptSecret, encryptSecret, loadOrCreateKey } from '../crypto/secret.js';

export interface SessionRecord {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  autonomous: boolean;
  task: string | null;
  createdAt: string;
  lastActivityAt: string | null;
}

interface SessionRow {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string;
  autonomous: number;
  task: string | null;
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
    autonomous: row.autonomous === 1,
    task: row.task,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

interface ConnectorsRow {
  session_id: string;
  env: string | null;
  mcp: string | null;
  repo: string | null;
}

/** Metadata store for sessions. tmux remains the source of truth for liveness. */
export class Store {
  private readonly db: Database.Database;
  private readonly key: Buffer;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.key = loadOrCreateKey(dataDir);
    this.db = new Database(join(dataDir, 'lumpy.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace TEXT NOT NULL,
        command TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        autonomous INTEGER NOT NULL DEFAULT 1,
        task TEXT,
        created_at TEXT NOT NULL,
        last_activity_at TEXT
      );
    `);
    for (const column of ['autonomous INTEGER NOT NULL DEFAULT 1', 'task TEXT']) {
      try {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${column}`);
      } catch {
        // Column already exists.
      }
    }
    // Per-session connectors: secret env (encrypted), MCP servers, and repo.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_connectors (
        session_id TEXT PRIMARY KEY,
        env TEXT,
        mcp TEXT,
        repo TEXT
      );
    `);
  }

  /** A session's connectors with decrypted env, or empty defaults if none. */
  getConnectors(sessionId: string): SessionConnectors {
    const row = this.db
      .prepare('SELECT * FROM session_connectors WHERE session_id = ?')
      .get(sessionId) as ConnectorsRow | undefined;
    if (!row) return { env: {}, mcpServers: {}, repo: null };
    return {
      env: row.env ? (JSON.parse(decryptSecret(row.env, this.key)) as Record<string, string>) : {},
      mcpServers: row.mcp ? (JSON.parse(row.mcp) as Record<string, McpServerDef>) : {},
      repo: row.repo,
    };
  }

  setConnectors(sessionId: string, connectors: SessionConnectors): void {
    const env = Object.keys(connectors.env).length
      ? encryptSecret(JSON.stringify(connectors.env), this.key)
      : null;
    this.db
      .prepare(
        `INSERT INTO session_connectors (session_id, env, mcp, repo)
         VALUES (@session_id, @env, @mcp, @repo)
         ON CONFLICT(session_id) DO UPDATE SET env = @env, mcp = @mcp, repo = @repo`,
      )
      .run({
        session_id: sessionId,
        env,
        mcp: JSON.stringify(connectors.mcpServers),
        repo: connectors.repo,
      });
  }

  createSession(record: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, name, workspace, command, tags, autonomous, task, created_at, last_activity_at)
         VALUES (@id, @name, @workspace, @command, @tags, @autonomous, @task, @created_at, @last_activity_at)`,
      )
      .run({
        id: record.id,
        name: record.name,
        workspace: record.workspace,
        command: record.command,
        tags: JSON.stringify(record.tags),
        autonomous: record.autonomous ? 1 : 0,
        task: record.task,
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
    this.db.prepare('DELETE FROM session_connectors WHERE session_id = ?').run(id);
  }
}
