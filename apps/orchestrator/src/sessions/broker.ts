import { spawn, type IPty } from 'node-pty';

const MAX_RING_BYTES = 256 * 1024;

type DataListener = (chunk: Buffer) => void;
type ExitListener = () => void;

/**
 * Owns the single PTY attached to a tmux session and fans its output out to
 * every connected viewer. A bounded ring buffer lets a newly connected viewer
 * be painted with recent output before live streaming begins.
 */
export class Broker {
  private readonly pty: IPty;
  private readonly ring: Buffer[] = [];
  private ringBytes = 0;
  private readonly dataListeners = new Set<DataListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private alive = true;

  constructor(
    readonly tmuxName: string,
    cols: number,
    rows: number,
  ) {
    this.pty = spawn('tmux', ['attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols,
      rows,
      env: process.env as Record<string, string>,
    });

    this.pty.onData((data) => {
      const chunk = Buffer.from(data, 'utf8');
      this.append(chunk);
      for (const listener of this.dataListeners) listener(chunk);
    });

    this.pty.onExit(() => {
      this.alive = false;
      for (const listener of this.exitListeners) listener();
    });
  }

  get isAlive(): boolean {
    return this.alive;
  }

  /** Seed the ring buffer with previously captured pane content. */
  prime(text: string): void {
    if (text) this.append(Buffer.from(text, 'utf8'));
  }

  snapshot(): Buffer {
    return Buffer.concat(this.ring);
  }

  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  write(data: string): void {
    if (this.alive) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return;
    try {
      this.pty.resize(cols, rows);
    } catch {
      // Resizing a detaching PTY can race; ignore.
    }
  }

  dispose(): void {
    this.alive = false;
    try {
      this.pty.kill();
    } catch {
      // Already dead.
    }
  }

  private append(chunk: Buffer): void {
    this.ring.push(chunk);
    this.ringBytes += chunk.length;
    while (this.ringBytes > MAX_RING_BYTES && this.ring.length > 1) {
      const removed = this.ring.shift();
      if (removed) this.ringBytes -= removed.length;
    }
  }
}
