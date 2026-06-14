import { chownSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { customAlphabet } from 'nanoid';
import type {
  Session,
  SessionActivity,
  SessionConnectors,
  SessionConnectorsView,
  SessionPrompt,
  SessionStatus,
  UpdateConnectorsInput,
} from '@lumpy/shared';
import { config } from '../config.js';
import type { EventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import type { SessionRecord, Store } from '../store/sqlite.js';
import { ActivityTracker } from './activity.js';
import { Broker } from './broker.js';
import { buildLaunchCommand } from './launch.js';
import { isClaudeCommand, resumeCommand } from './resume.js';
import type { RunAs } from './runas.js';
import * as tmux from './tmux.js';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const TOUCH_INTERVAL_MS = 5000;

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'session'
  );
}

export interface CreateSessionArgs {
  name: string;
  /**
   * Explicit working directory. When omitted, each session gets its OWN
   * isolated directory so Claude's per-project state (history, todos,
   * background tasks — keyed by cwd) never collides across sessions.
   */
  workspace?: string;
  command: string;
  tags: string[];
  autonomous: boolean;
  task: string | null;
  /** The project this session belongs to, if any. */
  projectId?: string | null;
  /** Locked sessions (the Conductor) can't be stopped or removed. */
  locked?: boolean;
  /** Extra env injected at launch and on every relaunch (persisted as connectors). */
  env?: Record<string, string>;
}

export class SessionManager {
  private readonly brokers = new Map<string, Broker>();
  private readonly trackers = new Map<string, ActivityTracker>();
  private readonly activities = new Map<string, SessionActivity>();
  private readonly prompts = new Map<string, SessionPrompt | null>();
  private readonly lastTouch = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly prefix: string,
    private readonly runAs: RunAs | null = null,
  ) {
    tmux.configureRunAs(runAs);
  }

  // IS_SANDBOX is only needed to allow skip-permissions when sessions run as
  // root; when they run as a dedicated user it is not required.
  private get sandbox(): boolean {
    return !this.runAs && (process.getuid?.() ?? 0) === 0;
  }

  private tmuxName(id: string): string {
    return `${this.prefix}-${id}`;
  }

  private idFromTmuxName(name: string): string {
    return name.slice(this.prefix.length + 1);
  }

  getBroker(id: string): Broker | undefined {
    return this.brokers.get(id);
  }

  /** Recent terminal output of a running session as plain text (for the Conductor to read). */
  async output(id: string, lines = 200): Promise<string | null> {
    if (!(await tmux.sessionExists(this.tmuxName(id)))) return null;
    return tmux.capturePlain(this.tmuxName(id), lines);
  }

  async create(args: CreateSessionArgs): Promise<Session> {
    const id = generateId();
    const name = this.tmuxName(id);

    // Without an explicit workspace, isolate each session in its own directory
    // so two concurrent Claude sessions never share project state via the cwd.
    const workspace = args.workspace ?? join(config.workspaceRoot, `${slug(args.name)}-${id}`);
    this.ensureWorkspace(workspace);

    // Persist any launch env as connectors so it is re-injected on every relaunch.
    if (args.env && Object.keys(args.env).length > 0) {
      this.store.setConnectors(id, { env: args.env, mcpServers: {}, repo: null });
    }

    const env = { ...this.applyConnectors(id, workspace), ...this.projectEnv(args.projectId) };
    await tmux.newSession({
      name,
      cwd: workspace,
      command: buildLaunchCommand(args.command, {
        autonomous: args.autonomous,
        task: args.task,
        sandbox: this.sandbox,
        mcpConfig: join(workspace, '.mcp.json'),
      }),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env,
    });

    const record: SessionRecord = {
      id,
      name: args.name,
      workspace,
      command: args.command,
      tags: args.tags,
      autonomous: args.autonomous,
      task: args.task,
      projectId: args.projectId ?? null,
      locked: args.locked ?? false,
      createdAt: new Date().toISOString(),
      lastActivityAt: null,
    };
    this.store.createSession(record);
    try {
      this.attachBroker(id);
    } catch (error) {
      await tmux.killSession(name);
      this.store.deleteSession(id);
      throw error;
    }
    this.publishStatus(id, 'running');

    logger.info({ id, workspace, command: args.command }, 'session created');
    return this.toSession(record, true);
  }

  /**
   * Write the session's MCP servers to `<workspace>/.mcp.json` so Claude loads
   * them, and return its secret env to inject into the session at launch. The
   * file holds only ${VAR} references, never secret values.
   */
  applyConnectors(id: string, workspace: string): Record<string, string> {
    const connectors = this.store.getConnectors(id);
    const path = join(workspace, '.mcp.json');
    try {
      if (Object.keys(connectors.mcpServers).length > 0) {
        // The session has its own MCP servers — write them.
        this.writeMcp(path, connectors.mcpServers);
      } else if (!existsSync(path)) {
        // Ensure a config file always exists so --strict-mcp-config has an
        // explicit, empty source (no servers) — never falls back to user/global
        // config. An existing file (e.g. a project's own .mcp.json) is left alone.
        this.writeMcp(path, {});
      }
    } catch (error) {
      logger.warn({ id, error }, 'could not write .mcp.json');
    }
    return connectors.env;
  }

  /**
   * Supabase token injected so a project's MCP can reach ITS OWN DB. Only when the
   * project declares a Supabase URL; uses the account-level token (shared across
   * projects, scoped per-project via --project-ref), or a per-project override.
   */
  private projectEnv(projectId: string | null | undefined): Record<string, string> {
    if (!projectId) return {};
    const project = this.store.getProject(projectId);
    const hasSupabaseDb = project?.sources.databases.some((d) => /supabase/i.test(d.url));
    if (!hasSupabaseDb) return {};
    const token = this.store.getProjectSupabaseToken(projectId) ?? this.store.getSecret('supabase_pat');
    return token ? { SUPABASE_ACCESS_TOKEN: token } : {};
  }

  private writeMcp(path: string, mcpServers: Record<string, unknown>): void {
    writeFileSync(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
    if (this.runAs) {
      try {
        chownSync(path, this.runAs.uid, this.runAs.gid);
      } catch {
        // best-effort
      }
    }
  }

  /** A session's connectors with env values masked (keys only) for the client. */
  connectorsView(id: string): SessionConnectorsView {
    const c = this.store.getConnectors(id);
    return { envKeys: Object.keys(c.env), mcpServers: c.mcpServers, repo: c.repo };
  }

  /** Merge a connectors update, persist it, and refresh `.mcp.json` immediately. */
  updateConnectors(id: string, input: UpdateConnectorsInput): SessionConnectorsView {
    const current = this.store.getConnectors(id);
    const env = { ...current.env };
    for (const [key, value] of Object.entries(input.setEnv ?? {})) env[key] = value;
    for (const key of input.removeEnv ?? []) delete env[key];
    const next: SessionConnectors = {
      env,
      mcpServers: input.mcpServers ?? current.mcpServers,
      repo: input.repo !== undefined ? input.repo : current.repo,
    };
    this.store.setConnectors(id, next);
    const record = this.store.getSession(id);
    if (record?.workspace) this.applyConnectors(id, record.workspace);
    return { envKeys: Object.keys(next.env), mcpServers: next.mcpServers, repo: next.repo };
  }

  /**
   * Make sure a session's working directory exists. When WE create it (it didn't
   * exist), chown it to the run-as user so the non-root session can write into
   * it — including explicit workspaces (services, new projects), not just
   * auto-isolated ones. Pre-existing directories are left untouched.
   */
  private ensureWorkspace(dir: string): void {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    if (this.runAs) {
      try {
        chownSync(dir, this.runAs.uid, this.runAs.gid);
      } catch (error) {
        logger.warn({ dir, error }, 'could not chown session workspace');
      }
    }
  }

  async list(): Promise<Session[]> {
    const live = new Set(
      (await tmux.listSessions(this.prefix)).map((name) => this.idFromTmuxName(name)),
    );
    return this.store.listSessions().map((record) => this.toSession(record, live.has(record.id)));
  }

  async get(id: string): Promise<Session | null> {
    const record = this.store.getSession(id);
    if (!record) return null;
    const live = await tmux.sessionExists(this.tmuxName(id));
    return this.toSession(record, live);
  }

  async stop(id: string): Promise<boolean> {
    const record = this.store.getSession(id);
    if (!record) return false;
    await tmux.killSession(this.tmuxName(id));
    this.teardown(id);
    logger.info({ id }, 'session stopped');
    return true;
  }

  /**
   * Relaunch a stopped session. For Claude sessions with a recorded task, the
   * task is wrapped so the session first reviews prior progress and continues
   * from it rather than starting over. (Use resume() for pure continuation.)
   */
  async restart(id: string): Promise<Session | null> {
    const record = this.store.getSession(id);
    if (!record) return null;
    const task =
      record.task && isClaudeCommand(record.command)
        ? `First read .lumpy/PROGRESS.md (if it exists) to see what prior work was done, then continue from there.\n\nOriginal task: ${record.task}`
        : record.task;
    return this.relaunch(id, record.command, task);
  }

  /** Relaunch a stopped session, continuing its prior context (no re-injected task). */
  async resume(id: string): Promise<Session | null> {
    const record = this.store.getSession(id);
    if (!record) return null;
    return this.relaunch(id, resumeCommand(record.command), null);
  }

  /** Permanently remove a session: kill it if alive, then drop its metadata. */
  async remove(id: string): Promise<boolean> {
    const record = this.store.getSession(id);
    if (!record) return false;
    this.detach(id);
    await tmux.killSession(this.tmuxName(id));
    this.store.deleteSession(id);
    this.lastTouch.delete(id);
    logger.info({ id }, 'session removed');
    return true;
  }

  private async relaunch(id: string, base: string, task: string | null): Promise<Session | null> {
    const record = this.store.getSession(id);
    if (!record) return null;
    if (await tmux.sessionExists(this.tmuxName(id))) {
      return this.toSession(record, true); // already running
    }
    if (!record.workspace) {
      throw new Error('cannot relaunch a session with no recorded workspace');
    }

    const env = {
      ...this.applyConnectors(id, record.workspace),
      ...this.projectEnv(record.projectId),
    };
    const command = buildLaunchCommand(base, {
      autonomous: record.autonomous,
      task,
      sandbox: this.sandbox,
      mcpConfig: join(record.workspace, '.mcp.json'),
    });
    await tmux.newSession({
      name: this.tmuxName(id),
      cwd: record.workspace,
      command,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env,
    });
    try {
      this.attachBroker(id);
    } catch (error) {
      await tmux.killSession(this.tmuxName(id));
      throw error;
    }
    this.publishStatus(id, 'running');
    logger.info({ id, command }, 'session relaunched');
    return this.toSession(record, true);
  }

  /** Re-discover sessions still running in tmux after an orchestrator restart. */
  async recover(): Promise<void> {
    const names = await tmux.listSessions(this.prefix);
    for (const name of names) {
      const id = this.idFromTmuxName(name);
      if (this.brokers.has(id)) continue;

      try {
        if (!this.store.getSession(id)) {
          this.store.createSession({
            id,
            name: `recovered ${id}`,
            workspace: '',
            command: '',
            tags: ['recovered'],
            autonomous: false,
            task: null,
            projectId: null,
            locked: false,
            createdAt: new Date().toISOString(),
            lastActivityAt: null,
          });
        }

        const broker = this.attachBroker(id);
        broker.prime(await tmux.capturePane(name));
        logger.info({ id }, 'session recovered');
      } catch (error) {
        // One unrecoverable session must not abort recovery of the rest.
        logger.error({ id, error }, 'failed to recover session');
      }
    }
  }

  disposeAll(): void {
    // Detach without emitting "stopped": the tmux sessions intentionally
    // survive an orchestrator shutdown.
    for (const id of [...this.brokers.keys()]) this.detach(id);
  }

  private attachBroker(id: string): Broker {
    const broker = new Broker(this.tmuxName(id), DEFAULT_COLS, DEFAULT_ROWS, this.runAs);
    const tracker = new ActivityTracker((activity, prompt) =>
      this.setActivity(id, activity, prompt),
    );

    broker.onData((chunk) => {
      tracker.feed(chunk);
      this.touch(id);
    });
    broker.onExit(() => this.teardown(id));

    this.brokers.set(id, broker);
    this.trackers.set(id, tracker);
    return broker;
  }

  /** Remove and dispose a session's broker and tracker. Idempotent. */
  private detach(id: string): boolean {
    const broker = this.brokers.get(id);
    const tracker = this.trackers.get(id);
    if (!broker && !tracker) return false;
    this.brokers.delete(id);
    this.trackers.delete(id);
    this.activities.delete(id);
    this.prompts.delete(id);
    tracker?.stop();
    broker?.dispose();
    return true;
  }

  private teardown(id: string): void {
    if (this.detach(id)) this.publishStatus(id, 'stopped');
  }

  private setActivity(id: string, activity: SessionActivity, prompt: SessionPrompt | null): void {
    this.activities.set(id, activity);
    this.prompts.set(id, prompt);
    const name = this.store.getSession(id)?.name ?? id;
    this.bus.publish({
      type: 'session.activity',
      id,
      name,
      activity,
      prompt,
      at: new Date().toISOString(),
    });
  }

  private publishStatus(id: string, status: SessionStatus): void {
    const name = this.store.getSession(id)?.name ?? id;
    this.bus.publish({ type: 'session.status', id, name, status, at: new Date().toISOString() });
  }

  private touch(id: string): void {
    const now = Date.now();
    const last = this.lastTouch.get(id) ?? 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(id, now);
    this.store.touchSession(id, new Date(now).toISOString());
  }

  private toSession(record: SessionRecord, live: boolean): Session {
    return {
      id: record.id,
      name: record.name,
      workspace: record.workspace,
      command: record.command,
      tags: record.tags,
      status: live ? 'running' : 'stopped',
      activity: live ? (this.activities.get(record.id) ?? 'unknown') : 'unknown',
      projectId: record.projectId,
      locked: record.locked,
      prompt: live ? (this.prompts.get(record.id) ?? null) : null,
      autonomous: record.autonomous,
      task: record.task,
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }
}
