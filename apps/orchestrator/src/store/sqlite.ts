import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ActivityEntry,
  Alert,
  HostedIncident,
  HostedService,
  LedgerCategory,
  LedgerEntry,
  LedgerScope,
  McpServerDef,
  Project,
  ProjectDatabase,
  ProjectSources,
  Schedule,
  ScheduleRunStatus,
  Service,
  ServiceImprovement,
  SessionConnectors,
} from '@lumpy/shared';
import { decryptSecret, encryptSecret, loadOrCreateKey } from '../crypto/secret.js';

interface LedgerRow {
  id: string;
  scope: string;
  project_id: string;
  category: string;
  statement: string;
  detail: string | null;
  count: number;
  adopted: number;
  source: string | null;
  first_at: string;
  last_at: string;
}

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    scope: row.scope as LedgerEntry['scope'],
    projectId: row.project_id || null,
    category: row.category as LedgerEntry['category'],
    statement: row.statement,
    detail: row.detail,
    count: row.count,
    adopted: row.adopted === 1,
    source: row.source,
    firstAt: row.first_at,
    lastAt: row.last_at,
  };
}

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
  hosted_services: string | null;
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
      hostedServices: row.hosted_services
        ? (JSON.parse(row.hosted_services) as HostedService[])
        : [],
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

interface ScheduleRow {
  id: string;
  name: string;
  cron: string;
  task: string;
  project_id: string | null;
  enabled: number;
  last_run_at: string | null;
  last_session_id: string | null;
  last_status: string | null;
  next_run_at: string | null;
  created_at: string;
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    task: row.task,
    projectId: row.project_id,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastSessionId: row.last_session_id,
    lastStatus: (row.last_status as ScheduleRunStatus) ?? null,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
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
    // shared across all projects - scoped per-project at launch via --project-ref).
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
      "hosted_services TEXT NOT NULL DEFAULT '[]'",
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
    // Uptime tracking: one row per continuous down period of a hosted service.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hosted_incidents (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        name TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        resolved_at TEXT,
        last_status_code INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_hosted_incidents_url ON hosted_incidents(url);
    `);
    // Scheduled tasks: recurring autonomous Claude jobs driven by a cron expr.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        task TEXT NOT NULL,
        project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        last_session_id TEXT,
        last_status TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
    // Activity feed: an append-only audit trail of noteworthy platform events.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
    `);
    // Remediations held for one-tap approval. Persisted so an already-delivered
    // push notification's "Approve fix" link still works after a restart (the
    // approve endpoint used to read an in-memory map that a reboot wiped).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_remediations (
        alert_id TEXT PRIMARY KEY,
        alert TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    // The two-tier memory ledger. project_id is '' for conductor scope so the
    // UNIQUE dedup key works (SQLite treats NULLs as distinct). Re-recording the
    // same (scope, project, category, statement) bumps count/last_at, never dupes.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        statement TEXT NOT NULL,
        detail TEXT,
        count INTEGER NOT NULL DEFAULT 1,
        adopted INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        first_at TEXT NOT NULL,
        last_at TEXT NOT NULL,
        UNIQUE(scope, project_id, category, statement)
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_scope ON ledger(scope, project_id, last_at);
    `);
  }

  /** Record a ledger entry, deduped on (scope, project, category, statement). A
   *  repeat bumps count/last_at; an 'access' entry leaned on repeatedly is adopted. */
  recordLedger(
    e: {
      scope: LedgerScope;
      projectId?: string | null;
      category: LedgerCategory;
      statement: string;
      detail?: string | null;
      source?: string | null;
    },
    at: string,
  ): void {
    const pid = e.projectId ?? '';
    const statement = e.statement.trim().slice(0, 300);
    if (!statement) return;
    this.db
      .prepare(
        `INSERT INTO ledger (id, scope, project_id, category, statement, detail, count, adopted, source, first_at, last_at)
         VALUES (@id, @scope, @pid, @category, @statement, @detail, 1, 0, @source, @at, @at)
         ON CONFLICT(scope, project_id, category, statement) DO UPDATE SET
           count = count + 1,
           last_at = @at,
           detail = COALESCE(@detail, ledger.detail),
           source = COALESCE(@source, ledger.source)`,
      )
      .run({
        id: randomUUID(),
        scope: e.scope,
        pid,
        category: e.category,
        statement,
        detail: e.detail?.trim().slice(0, 600) ?? null,
        source: e.source ?? null,
        at,
      });
    // Learning behaviour: data accessed repeatedly is adopted as cached truth.
    if (e.category === 'access') {
      this.db
        .prepare(
          `UPDATE ledger SET adopted = 1
           WHERE scope=@scope AND project_id=@pid AND category='access' AND statement=@statement AND count >= 3`,
        )
        .run({ scope: e.scope, pid, statement });
    }
  }

  listLedger(scope: LedgerScope, projectId: string | null, limit = 200): LedgerEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM ledger WHERE scope = ? AND project_id = ? ORDER BY last_at DESC LIMIT ?')
      .all(scope, projectId ?? '', limit) as LedgerRow[];
    return rows.map(toLedgerEntry);
  }

  /** Remove a project's ledger (called when the project is deleted). */
  deleteLedgerForProject(projectId: string): void {
    this.db.prepare("DELETE FROM ledger WHERE scope = 'project' AND project_id = ?").run(projectId);
  }

  addPendingRemediation(alert: Alert, at: string): void {
    // Preserve the original created_at on a re-fire (only refresh the alert
    // payload) so the hold age - which drives TTL pruning - stays truthful.
    this.db
      .prepare(
        `INSERT INTO pending_remediations (alert_id, alert, created_at)
         VALUES (@alert_id, @alert, @created_at)
         ON CONFLICT(alert_id) DO UPDATE SET alert = excluded.alert`,
      )
      .run({ alert_id: alert.id, alert: JSON.stringify(alert), created_at: at });
  }

  /**
   * Drop pending remediations created before the cutoff. A hold orphaned by a
   * restart (the alert resolved while the in-memory alerts manager was empty, so
   * no alert.resolved cleared it) would otherwise linger and make the dedup
   * suppress that alert id forever; aging it out lets the alert be handled again.
   */
  prunePendingRemediations(cutoffIso: string): void {
    this.db.prepare('DELETE FROM pending_remediations WHERE created_at < ?').run(cutoffIso);
  }

  getPendingRemediation(alertId: string): Alert | null {
    const row = this.db
      .prepare('SELECT alert FROM pending_remediations WHERE alert_id = ?')
      .get(alertId) as { alert: string } | undefined;
    return row ? (JSON.parse(row.alert) as Alert) : null;
  }

  listPendingRemediations(): { alert: Alert; createdAt: string }[] {
    const rows = this.db
      .prepare('SELECT alert, created_at FROM pending_remediations ORDER BY created_at ASC')
      .all() as { alert: string; created_at: string }[];
    return rows.map((r) => ({ alert: JSON.parse(r.alert) as Alert, createdAt: r.created_at }));
  }

  removePendingRemediation(alertId: string): void {
    this.db.prepare('DELETE FROM pending_remediations WHERE alert_id = ?').run(alertId);
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
           (id, name, slug, workspace, description, origin, repo, repos, machine_id, source_paths, server_ids, hosted_services, use_connectors, supabase_url, databases, created_at)
         VALUES
           (@id, @name, @slug, @workspace, @description, @origin, @repo, @repos, @machine_id, @source_paths, @server_ids, @hosted_services, @use_connectors, @supabase_url, @databases, @created_at)`,
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
        hosted_services: JSON.stringify(project.sources.hostedServices),
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
           hosted_services=@hosted_services, use_connectors=@use_connectors,
           supabase_url=@supabase_url, databases=@databases
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
        hosted_services: JSON.stringify(sources.hostedServices),
        use_connectors: sources.useConnectors ? 1 : 0,
        supabase_url: sources.databases[0]?.url ?? null,
        databases: JSON.stringify(sources.databases),
      });
    return this.getProject(id);
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  /**
   * Drop a project's hosted-service incident rows. Called on project delete: once
   * a project (and its hosted services) is gone the URLs are no longer probed, so
   * any open incident would otherwise stay open forever and skew uptime stats.
   */
  deleteHostedIncidentsForProject(projectId: string): void {
    this.db.prepare('DELETE FROM hosted_incidents WHERE project_id = ?').run(projectId);
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

  // --- Hosted-service uptime incidents ---

  /** Open a down incident for a URL if none is open. Returns true if one was created. */
  openHostedIncident(
    svc: { url: string; name: string; projectId: string; projectName: string; statusCode: number | null },
    at: string,
  ): boolean {
    const open = this.db
      .prepare('SELECT id FROM hosted_incidents WHERE url = ? AND resolved_at IS NULL LIMIT 1')
      .get(svc.url) as { id: string } | undefined;
    if (open) {
      this.db
        .prepare('UPDATE hosted_incidents SET last_status_code = ? WHERE id = ?')
        .run(svc.statusCode, open.id);
      return false;
    }
    this.db
      .prepare(
        `INSERT INTO hosted_incidents (id, url, name, project_id, project_name, started_at, resolved_at, last_status_code)
         VALUES (@id, @url, @name, @projectId, @projectName, @startedAt, NULL, @statusCode)`,
      )
      .run({
        id: randomUUID(),
        url: svc.url,
        name: svc.name,
        projectId: svc.projectId,
        projectName: svc.projectName,
        startedAt: at,
        statusCode: svc.statusCode,
      });
    return true;
  }

  /** Resolve the open incident for a URL. Returns true if one was resolved. */
  resolveHostedIncident(url: string, at: string): boolean {
    return (
      this.db
        .prepare('UPDATE hosted_incidents SET resolved_at = ? WHERE url = ? AND resolved_at IS NULL')
        .run(at, url).changes > 0
    );
  }

  /** Uptime fraction (0-1) for a URL over the window [sinceMs, nowMs]. */
  hostedUptime(url: string, sinceMs: number, nowMs: number): number {
    const windowMs = Math.max(1, nowMs - sinceMs);
    const rows = this.db
      .prepare('SELECT started_at, resolved_at FROM hosted_incidents WHERE url = ?')
      .all(url) as { started_at: string; resolved_at: string | null }[];
    let downMs = 0;
    for (const row of rows) {
      const start = Date.parse(row.started_at);
      const end = row.resolved_at ? Date.parse(row.resolved_at) : nowMs;
      const overlapStart = Math.max(start, sinceMs);
      const overlapEnd = Math.min(end, nowMs);
      if (overlapEnd > overlapStart) downMs += overlapEnd - overlapStart;
    }
    return Math.max(0, Math.min(1, 1 - downMs / windowMs));
  }

  /** When the up/down status of a URL last changed (most recent incident boundary). */
  hostedLastChange(url: string): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(t) AS last FROM (
           SELECT started_at AS t FROM hosted_incidents WHERE url = @url
           UNION ALL
           SELECT resolved_at AS t FROM hosted_incidents WHERE url = @url AND resolved_at IS NOT NULL
         )`,
      )
      .get({ url }) as { last: string | null } | undefined;
    return row?.last ?? null;
  }

  // --- Activity feed ---

  appendActivity(kind: string, title: string, at: string): void {
    this.db
      .prepare('INSERT INTO activity (id, kind, title, at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), kind, title, at);
    // Keep the feed bounded.
    this.db.exec(
      'DELETE FROM activity WHERE at < (SELECT at FROM activity ORDER BY at DESC LIMIT 1 OFFSET 1000)',
    );
  }

  listActivity(limit = 100): ActivityEntry[] {
    return this.db
      .prepare('SELECT id, kind, title, at FROM activity ORDER BY at DESC LIMIT ?')
      .all(limit) as ActivityEntry[];
  }

  // --- Scheduled tasks ---

  createSchedule(s: Schedule): void {
    this.db
      .prepare(
        `INSERT INTO schedules (id, name, cron, task, project_id, enabled, last_run_at, last_session_id, last_status, next_run_at, created_at)
         VALUES (@id, @name, @cron, @task, @projectId, @enabled, @lastRunAt, @lastSessionId, @lastStatus, @nextRunAt, @createdAt)`,
      )
      .run({
        id: s.id,
        name: s.name,
        cron: s.cron,
        task: s.task,
        projectId: s.projectId,
        enabled: s.enabled ? 1 : 0,
        lastRunAt: s.lastRunAt,
        lastSessionId: s.lastSessionId,
        lastStatus: s.lastStatus,
        nextRunAt: s.nextRunAt,
        createdAt: s.createdAt,
      });
  }

  listSchedules(): Schedule[] {
    return (
      this.db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all() as ScheduleRow[]
    ).map(toSchedule);
  }

  getSchedule(id: string): Schedule | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as
      | ScheduleRow
      | undefined;
    return row ? toSchedule(row) : null;
  }

  updateSchedule(
    id: string,
    patch: {
      name?: string;
      cron?: string;
      task?: string;
      projectId?: string | null;
      enabled?: boolean;
      nextRunAt?: string | null;
    },
  ): Schedule | null {
    const current = this.getSchedule(id);
    if (!current) return null;
    const next: Schedule = {
      ...current,
      name: patch.name ?? current.name,
      cron: patch.cron ?? current.cron,
      task: patch.task ?? current.task,
      projectId: patch.projectId !== undefined ? patch.projectId : current.projectId,
      enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
      nextRunAt: patch.nextRunAt !== undefined ? patch.nextRunAt : current.nextRunAt,
    };
    this.db
      .prepare(
        `UPDATE schedules SET name=@name, cron=@cron, task=@task, project_id=@projectId,
           enabled=@enabled, next_run_at=@nextRunAt WHERE id=@id`,
      )
      .run({
        id,
        name: next.name,
        cron: next.cron,
        task: next.task,
        projectId: next.projectId,
        enabled: next.enabled ? 1 : 0,
        nextRunAt: next.nextRunAt,
      });
    return next;
  }

  markScheduleRun(
    id: string,
    fields: {
      lastRunAt: string;
      lastSessionId: string | null;
      lastStatus: ScheduleRunStatus;
      nextRunAt: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE schedules SET last_run_at=@lastRunAt, last_session_id=@lastSessionId,
           last_status=@lastStatus, next_run_at=@nextRunAt WHERE id=@id`,
      )
      .run({ id, ...fields });
  }

  deleteSchedule(id: string): void {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  /** Recent incidents across all hosted services (newest first). */
  listHostedIncidents(limit = 50): HostedIncident[] {
    const rows = this.db
      .prepare('SELECT * FROM hosted_incidents ORDER BY started_at DESC LIMIT ?')
      .all(limit) as {
      id: string;
      url: string;
      name: string;
      project_id: string;
      project_name: string;
      started_at: string;
      resolved_at: string | null;
      last_status_code: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      name: r.name,
      projectId: r.project_id,
      projectName: r.project_name,
      startedAt: r.started_at,
      resolvedAt: r.resolved_at,
      lastStatusCode: r.last_status_code,
    }));
  }
}
