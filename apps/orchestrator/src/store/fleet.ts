import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ServerCriticality, ServerEnv } from '@lumpy/shared';

export interface ServerRecord {
  id: string;
  name: string;
  address: string;
  tags: string[];
  env: ServerEnv;
  criticality: ServerCriticality;
  createdAt: string;
  lastSeenAt: string | null;
}

interface ServerRow {
  id: string;
  name: string;
  address: string;
  tags: string;
  env: ServerEnv;
  criticality: ServerCriticality;
  created_at: string;
  last_seen_at: string | null;
}

function toRecord(row: ServerRow): ServerRecord {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    tags: JSON.parse(row.tags) as string[],
    env: row.env,
    criticality: row.criticality,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Persistent registry of monitored servers. Metrics history is held in memory. */
export class FleetStore {
  private readonly db: Database.Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'fleet.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT 'prod',
        criticality TEXT NOT NULL DEFAULT 'medium',
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );
    `);
  }

  createServer(record: ServerRecord): void {
    this.db
      .prepare(
        `INSERT INTO servers (id, name, address, tags, env, criticality, created_at, last_seen_at)
         VALUES (@id, @name, @address, @tags, @env, @criticality, @created_at, @last_seen_at)`,
      )
      .run({
        id: record.id,
        name: record.name,
        address: record.address,
        tags: JSON.stringify(record.tags),
        env: record.env,
        criticality: record.criticality,
        created_at: record.createdAt,
        last_seen_at: record.lastSeenAt,
      });
  }

  getServer(id: string): ServerRecord | null {
    const row = this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as
      | ServerRow
      | undefined;
    return row ? toRecord(row) : null;
  }

  listServers(): ServerRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM servers ORDER BY created_at DESC')
      .all() as ServerRow[];
    return rows.map(toRecord);
  }

  markSeen(id: string, at: string): void {
    this.db.prepare('UPDATE servers SET last_seen_at = ? WHERE id = ?').run(at, id);
  }

  deleteServer(id: string): void {
    this.db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }
}
