import { customAlphabet } from 'nanoid';
import type { Session } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { SessionRecord, Store } from '../store/sqlite.js';
import { Broker } from './broker.js';
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
}

export class SessionManager {
  private readonly brokers = new Map<string, Broker>();
  private readonly lastTouch = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly prefix: string,
  ) {}

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
      command: args.command,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });

    const record: SessionRecord = {
      id,
      name: args.name,
      workspace: args.workspace,
      command: args.command,
      tags: args.tags,
      createdAt: new Date().toISOString(),
      lastActivityAt: null,
    };
    this.store.createSession(record);
    this.attachBroker(id);

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
    this.brokers.get(id)?.dispose();
    this.brokers.delete(id);
    logger.info({ id }, 'session stopped');
    return true;
  }

  /** Re-discover sessions still running in tmux after an orchestrator restart. */
  async recover(): Promise<void> {
    const names = await tmux.listSessions(this.prefix);
    for (const name of names) {
      const id = this.idFromTmuxName(name);
      if (this.brokers.has(id)) continue;

      if (!this.store.getSession(id)) {
        this.store.createSession({
          id,
          name: `recovered ${id}`,
          workspace: '',
          command: '',
          tags: ['recovered'],
          createdAt: new Date().toISOString(),
          lastActivityAt: null,
        });
      }

      const broker = this.attachBroker(id);
      broker.prime(await tmux.capturePane(name));
      logger.info({ id }, 'session recovered');
    }
  }

  disposeAll(): void {
    for (const broker of this.brokers.values()) broker.dispose();
    this.brokers.clear();
  }

  private attachBroker(id: string): Broker {
    const broker = new Broker(this.tmuxName(id), DEFAULT_COLS, DEFAULT_ROWS);
    broker.onData(() => this.touch(id));
    broker.onExit(() => this.brokers.delete(id));
    this.brokers.set(id, broker);
    return broker;
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
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }
}
