import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type {
  McpServerDef,
  Project,
  ProjectDatabase,
  ProjectSources,
  Service,
  ServiceImprovement,
  SessionConnectors,
} from '@lumpy/shared';
import { decryptSecret, encryptSecret, loadOrCreateKey } from '../crypto/secret.js';

export interface SessionRecord {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  autonomous: boolean;
  task: string | null;
  projectId: string | null;
  locked: boolean;
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
  project_id: string | null;
  locked: number | null;
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
    projectId: row.project_id ?? null,
    locked: row.locked === 1,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  workspace: string;
  description: string | null;
  origin: string | null;
  repo: string | null;
  repos: string | null;
  machine_id: string | null;
  source_paths: string;
  server_ids: string | null;
  use_connectors: number;
  supabase_url: string | null;
  databases: string | null;
  supabase_token: string | null;
  created_at: string;
}

function toProject(row: ProjectRow): Project {
  const repos = row.repos ? (JSON.parse(row.repos) as string[]) : [];
  // Back-fill from the old single-repo column for rows created before multi-repo.
  if (repos.length === 0 && row.repo) repos.push(row.repo);
  const databases = row.databases ? (JSON.parse(row.databases) as ProjectDatabase[]) : [];
  // Back-fill from the old single-URL column for rows created before multi-db.
  if (databases.length === 0 && row.supabase_url) databases.push({ label: 'main', url: row.supabase_url });
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    workspace: row.workspace,
    description: row.description,
    origin: row.origin === 'import' ? 'import' : 'new',
    sources: {
      repos,
      machineId: row.machine_id,
      sourcePaths: JSON.parse(row.source_paths) as string[],
      serverIds: row.server_ids ? (JSON.parse(row.server_ids) as string[]) : [],
      useConnectors: row.use_connectors === 1,
      databases,
    },
    supabaseConfigured: Boolean(row.supabase_token),
    createdAt: row.created_at,
  };
}

interface ConnectorsRow {
  session_id: string;
  env: string | null;
  mcp: string | null;
  repo: string | null;
}

interface ServiceRow {
  id: string;
  name: string;
  speciality: string;
  description: string | null;
  instructions: string;
  version: number;
  improvements: string;
  created_at: string;
  updated_at: string;
}

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name,
    speciality: row.speciality,
    description: row.description,
    instructions: row.instructions,
    version: row.version,
    improvements: JSON.parse(row.improvements) as ServiceImprovement[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    for (const column of [
      'autonomous INTEGER NOT NULL DEFAULT 1',
      'task TEXT',
      'project_id TEXT',
      'locked INTEGER NOT NULL DEFAULT 0',
    ]) {
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
    // Account-level encrypted secrets (e.g. the Supabase Personal Access Token
    // shared across all projects — scoped per-project at launch via --project-ref).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // First-class projects (governed workspaces with a knowledge base).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        workspace TEXT NOT NULL,
        description TEXT,
        origin TEXT NOT NULL DEFAULT 'new',
        repo TEXT,
        machine_id TEXT,
        source_paths TEXT NOT NULL DEFAULT '[]',
        use_connectors INTEGER NOT NULL DEFAULT 0,
        supabase_url TEXT,
        supabase_token TEXT,
        created_at TEXT NOT NULL
      );
    `);
    for (const column of [
      "origin TEXT NOT NULL DEFAULT 'new'",
      'supabase_url TEXT',
      'supabase_token TEXT',
      "repos TEXT NOT NULL DEFAULT '[]'",
      "databases TEXT NOT NULL DEFAULT '[]'",
      "server_ids TEXT NOT NULL DEFAULT '[]'",
    ]) {
      try {
        this.db.exec(`ALTER TABLE projects ADD COLUMN ${column}`);
      } catch {
        // Column already exists.
      }
    }
    // Micro services: deployable, self-improving specialist functions.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        speciality TEXT NOT NULL DEFAULT '',
        description TEXT,
        instructions TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        improvements TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  createService(service: Service): void {
    this.db
      .prepare(
        `INSERT INTO services (id, name, speciality, description, instructions, version, improvements, created_at, updated_at)
         VALUES (@id, @name, @speciality, @description, @instructions, @version, @improvements, @created_at, @updated_at)`,
      )
      .run({
        id: service.id,
        name: service.name,
        speciality: service.speciality,
        description: service.description,
        instructions: service.instructions,
        version: service.version,
        improvements: JSON.stringify(service.improvements),
        created_at: service.createdAt,
        updated_at: service.updatedAt,
      });
  }

  getService(id: string): Service | null {
    const row = this.db.prepare('SELECT * FROM services WHERE id = ?').get(id) as
      | ServiceRow
      | undefined;
    return row ? toService(row) : null;
  }

  listServices(): Service[] {
    return (
      this.db.prepare('SELECT * FROM services ORDER BY created_at DESC').all() as ServiceRow[]
    ).map(toService);
  }

  updateService(
    id: string,
    patch: {
      name?: string;
      speciality?: string;
      description?: string | null;
      instructions?: string;
      version?: number;
      improvements?: ServiceImprovement[];
    },
  ): Service | null {
    const cur = this.getService(id);
    if (!cur) return null;
    const next: Service = {
      ...cur,
      name: patch.name ?? cur.name,
      speciality: patch.speciality ?? cur.speciality,
      description: patch.description !== undefined ? patch.description : cur.description,
      instructions: patch.instructions ?? cur.instructions,
      version: patch.version ?? cur.version,
      improvements: patch.improvements ?? cur.improvements,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE services SET name=@name, speciality=@speciality, description=@description,
           instructions=@instructions, version=@version, improvements=@improvements, updated_at=@updated_at
         WHERE id=@id`,
      )
      .run({
        id,
        name: next.name,
        speciality: next.speciality,
        description: next.description,
        instructions: next.instructions,
        version: next.version,
        improvements: JSON.stringify(next.improvements),
        updated_at: next.updatedAt,
      });
    return next;
  }

  deleteService(id: string): void {
    this.db.prepare('DELETE FROM services WHERE id = ?').run(id);
  }

  createProject(project: Project): void {
    this.db
      .prepare(
        `INSERT INTO projects
           (id, name, slug, workspace, description, origin, repo, repos, machine_id, source_paths, server_ids, use_connectors, supabase_url, databases, created_at)
         VALUES
           (@id, @name, @slug, @workspace, @description, @origin, @repo, @repos, @machine_id, @source_paths, @server_ids, @use_connectors, @supabase_url, @databases, @created_at)`,
      )
      .run({
        id: project.id,
        name: project.name,
        slug: project.slug,
        workspace: project.workspace,
        description: project.description,
        origin: project.origin,
        repo: project.sources.repos[0] ?? null,
        repos: JSON.stringify(project.sources.repos),
        machine_id: project.sources.machineId,
        source_paths: JSON.stringify(project.sources.sourcePaths),
        server_ids: JSON.stringify(project.sources.serverIds),
        use_connectors: project.sources.useConnectors ? 1 : 0,
        supabase_url: project.sources.databases[0]?.url ?? null,
        databases: JSON.stringify(project.sources.databases),
        created_at: project.createdAt,
      });
  }

  /** Store (encrypted) or clear a project's Supabase access token. */
  setProjectSupabaseToken(id: string, token: string | null): void {
    const value = token ? encryptSecret(token, this.key) : null;
    this.db.prepare('UPDATE projects SET supabase_token = ? WHERE id = ?').run(value, id);
  }

  /** The decrypted Supabase token for a project, or null. */
  getProjectSupabaseToken(id: string): string | null {
    const row = this.db.prepare('SELECT supabase_token FROM projects WHERE id = ?').get(id) as
      | { supabase_token: string | null }
      | undefined;
    return row?.supabase_token ? decryptSecret(row.supabase_token, this.key) : null;
  }

  /** Account-level secret accessors (AES-256-GCM at rest). */
  setSecret(key: string, value: string | null): void {
    if (value) {
      this.db
        .prepare(
          'INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, encryptSecret(value, this.key));
    } else {
      this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key);
    }
  }

  getSecret(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM secrets WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? decryptSecret(row.value, this.key) : null;
  }

  hasSecret(key: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM secrets WHERE key = ?').get(key));
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined;
    return row ? toProject(row) : null;
  }

  listProjects(): Project[] {
    return (
      this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[]
    ).map(toProject);
  }

  updateProject(id: string, patch: { name?: string; description?: string | null; sources?: ProjectSources }): Project | null {
    const current = this.getProject(id);
    if (!current) return null;
    const name = patch.name ?? current.name;
    const description = patch.description !== undefined ? patch.description : current.description;
    const sources = patch.sources ?? current.sources;
    this.db
      .prepare(
        `UPDATE projects SET name=@name, description=@description, repo=@repo, repos=@repos,
           machine_id=@machine_id, source_paths=@source_paths, server_ids=@server_ids,
           use_connectors=@use_connectors, supabase_url=@supabase_url, databases=@databases
         WHERE id=@id`,
      )
      .run({
        id,
        name,
        description,
        repo: sources.repos[0] ?? null,
        repos: JSON.stringify(sources.repos),
        machine_id: sources.machineId,
        source_paths: JSON.stringify(sources.sourcePaths),
        server_ids: JSON.stringify(sources.serverIds),
        use_connectors: sources.useConnectors ? 1 : 0,
        supabase_url: sources.databases[0]?.url ?? null,
        databases: JSON.stringify(sources.databases),
      });
    return this.getProject(id);
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
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
        `INSERT INTO sessions (id, name, workspace, command, tags, autonomous, task, project_id, locked, created_at, last_activity_at)
         VALUES (@id, @name, @workspace, @command, @tags, @autonomous, @task, @project_id, @locked, @created_at, @last_activity_at)`,
      )
      .run({
        id: record.id,
        name: record.name,
        workspace: record.workspace,
        command: record.command,
        tags: JSON.stringify(record.tags),
        autonomous: record.autonomous ? 1 : 0,
        task: record.task,
        project_id: record.projectId,
        locked: record.locked ? 1 : 0,
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
