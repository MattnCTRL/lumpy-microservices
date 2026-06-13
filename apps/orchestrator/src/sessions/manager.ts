import { customAlphabet } from 'nanoid';
import type { Session, SessionActivity, SessionStatus } from '@lumpy/shared';
import type { EventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import type { SessionRecord, Store } from '../store/sqlite.js';
import { ActivityTracker } from './activity.js';
import { Broker } from './broker.js';
import { buildLaunchCommand } from './launch.js';
import { resumeCommand } from './resume.js';
import type { RunAs } from './runas.js';
import * as tmux from './tmux.js';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const TOUCH_INTERVAL_MS = 5000;

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

export interface CreateSessionArgs {
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  autonomous: boolean;
  task: string | null;
}

export class SessionManager {
  private readonly brokers = new Map<string, Broker>();
  private readonly trackers = new Map<string, ActivityTracker>();
  private readonly activities = new Map<string, SessionActivity>();
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

  async create(args: CreateSessionArgs): Promise<Session> {
    const id = generateId();
    const name = this.tmuxName(id);

    await tmux.newSession({
      name,
      cwd: args.workspace,
      command: buildLaunchCommand(args.command, {
        autonomous: args.autonomous,
        task: args.task,
        sandbox: this.sandbox,
      }),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });

    const record: SessionRecord = {
      id,
      name: args.name,
      workspace: args.workspace,
      command: args.command,
      tags: args.tags,
      autonomous: args.autonomous,
      task: args.task,
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

    logger.info({ id, workspace: args.workspace, command: args.command }, 'session created');
    return this.toSession(record, true);
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

  /** Relaunch a stopped session with its original command and task. */
  async restart(id: string): Promise<Session | null> {
    const record = this.store.getSession(id);
    if (!record) return null;
    return this.relaunch(id, record.command, record.task);
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

    const command = buildLaunchCommand(base, {
      autonomous: record.autonomous,
      task,
      sandbox: this.sandbox,
    });
    await tmux.newSession({
      name: this.tmuxName(id),
      cwd: record.workspace,
      command,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
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
    const tracker = new ActivityTracker((activity) => this.setActivity(id, activity));

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
    tracker?.stop();
    broker?.dispose();
    return true;
  }

  private teardown(id: string): void {
    if (this.detach(id)) this.publishStatus(id, 'stopped');
  }

  private setActivity(id: string, activity: SessionActivity): void {
    this.activities.set(id, activity);
    const name = this.store.getSession(id)?.name ?? id;
    this.bus.publish({
      type: 'session.activity',
      id,
      name,
      activity,
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
      autonomous: record.autonomous,
      task: record.task,
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }
}
