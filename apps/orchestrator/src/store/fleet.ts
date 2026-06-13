import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ServerCriticality, ServerEnv } from '@lumpy/shared';
import { decryptSecret, encryptSecret, loadOrCreateKey } from '../crypto/secret.js';

export interface SshCredentials {
  host: string;
  port: number;
  user: string;
  privateKey?: string;
  password?: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  address: string;
  tags: string[];
  env: ServerEnv;
  criticality: ServerCriticality;
  createdAt: string;
  lastSeenAt: string | null;
  ssh: SshCredentials | null;
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
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_user: string | null;
  ssh_private_key: string | null;
  ssh_password: string | null;
}

function toRecord(row: ServerRow, key: Buffer): ServerRecord {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    tags: JSON.parse(row.tags) as string[],
    env: row.env,
    criticality: row.criticality,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    ssh: row.ssh_host
      ? {
          host: row.ssh_host,
          port: row.ssh_port ?? 22,
          user: row.ssh_user ?? 'root',
          privateKey: row.ssh_private_key ? decryptSecret(row.ssh_private_key, key) : undefined,
          password: row.ssh_password ? decryptSecret(row.ssh_password, key) : undefined,
        }
      : null,
  };
}

/**
 * Persistent registry of monitored servers. SSH credentials are encrypted at
 * rest with a key kept in the data directory; keep the orchestrator host trusted
 * (see docs/security.md).
 */
export class FleetStore {
  private readonly db: Database.Database;
  private readonly key: Buffer;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.key = loadOrCreateKey(dataDir);
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
        last_seen_at TEXT,
        ssh_host TEXT,
        ssh_port INTEGER,
        ssh_user TEXT,
        ssh_private_key TEXT,
        ssh_password TEXT
      );
    `);
    // Migrate older databases that predate the SSH columns.
    for (const column of [
      'ssh_host TEXT',
      'ssh_port INTEGER',
      'ssh_user TEXT',
      'ssh_private_key TEXT',
      'ssh_password TEXT',
    ]) {
      try {
        this.db.exec(`ALTER TABLE servers ADD COLUMN ${column}`);
      } catch {
        // Column already exists.
      }
    }
  }

  createServer(record: ServerRecord): void {
    this.db
      .prepare(
        `INSERT INTO servers
           (id, name, address, tags, env, criticality, created_at, last_seen_at,
            ssh_host, ssh_port, ssh_user, ssh_private_key, ssh_password)
         VALUES
           (@id, @name, @address, @tags, @env, @criticality, @created_at, @last_seen_at,
            @ssh_host, @ssh_port, @ssh_user, @ssh_private_key, @ssh_password)`,
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
        ssh_host: record.ssh?.host ?? null,
        ssh_port: record.ssh?.port ?? null,
        ssh_user: record.ssh?.user ?? null,
        ssh_private_key: record.ssh?.privateKey
          ? encryptSecret(record.ssh.privateKey, this.key)
          : null,
        ssh_password: record.ssh?.password ? encryptSecret(record.ssh.password, this.key) : null,
      });
  }

  getServer(id: string): ServerRecord | null {
    const row = this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as
      | ServerRow
      | undefined;
    return row ? toRecord(row, this.key) : null;
  }

  listServers(): ServerRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM servers ORDER BY created_at DESC')
      .all() as ServerRow[];
    return rows.map((row) => toRecord(row, this.key));
  }

  markSeen(id: string, at: string): void {
    this.db.prepare('UPDATE servers SET last_seen_at = ? WHERE id = ?').run(at, id);
  }

  renameServer(id: string, name: string): boolean {
    return this.db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, id).changes > 0;
  }

  deleteServer(id: string): void {
    this.db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }
}
