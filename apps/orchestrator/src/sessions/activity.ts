import type { SessionActivity } from '@lumpy/shared';

const WORKING_WINDOW_MS = 1200;
const TICK_MS = 1000;
const TAIL_LIMIT = 4096;

// CSI sequences, OSC sequences, and stray carriage-return / bell bytes.
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\r\x07]/g;

/**
 * Signals that the session is asking the operator to approve an action. These
 * are intentionally tolerant — the terminal stream is the ground truth and the
 * operator can always act manually if a prompt is not recognized.
 */
const PERMISSION_PATTERNS = [
  /do you want to (proceed|continue|allow|make this|create|run)/i,
  /❯\s*1\.\s*yes/i,
  /\b1\.\s*yes\b[\s\S]{0,80}\b2\.\s*no\b/i,
  /\(y\/n\)/i,
  /allow this (action|command|tool)/i,
];

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

function looksLikePermissionPrompt(tail: string): boolean {
  const recent = tail.slice(-1024);
  return PERMISSION_PATTERNS.some((pattern) => pattern.test(recent));
}

/**
 * Infers a session's activity from its terminal output. Fed raw PTY chunks; it
 * re-evaluates on each chunk and on a timer so idle transitions are detected
 * even when output stops.
 */
export class ActivityTracker {
  private tail = '';
  private lastDataAt = 0;
  private current: SessionActivity = 'unknown';
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly onChange: (activity: SessionActivity) => void) {
    this.timer = setInterval(() => this.evaluate(), TICK_MS);
    this.timer.unref();
  }

  get activity(): SessionActivity {
    return this.current;
  }

  feed(chunk: Buffer): void {
    this.tail = (this.tail + stripAnsi(chunk.toString('utf8'))).slice(-TAIL_LIMIT);
    this.lastDataAt = Date.now();
    this.evaluate();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private evaluate(): void {
    let next: SessionActivity;
    if (looksLikePermissionPrompt(this.tail)) {
      next = 'awaiting_permission';
    } else if (Date.now() - this.lastDataAt < WORKING_WINDOW_MS) {
      next = 'working';
    } else {
      next = 'idle';
    }

    if (next !== this.current) {
      this.current = next;
      this.onChange(next);
    }
  }
}
