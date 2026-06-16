import type { SessionActivity, SessionPrompt, SessionPromptOption } from '@lumpy/shared';

const WORKING_WINDOW_MS = 1200;
const TICK_MS = 1000;
const TAIL_LIMIT = 4096;
// On (re)attach, tmux redraws the pane, so a fresh tracker can see a PRE-EXISTING
// error from before a restart. We baseline (never fire) for this window after the
// tracker is created, so only errors that appear AFTERWARD trigger an auto-retry.
const WARMUP_MS = 4000;

// CSI sequences, OSC sequences, and stray carriage-return / bell bytes.
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\r\x07]/g;

/**
 * Signals that the session is asking the operator to approve an action. These
 * are intentionally tolerant - the terminal stream is the ground truth and the
 * operator can always act manually if a prompt is not recognized.
 */
const PERMISSION_PATTERNS = [
  /do you want to (proceed|continue|allow|make this|create|run)/i,
  /❯\s*1\.\s*yes/i,
  /\b1\.\s*yes\b[\s\S]{0,80}\b2\.\s*no\b/i,
  /\(y\/n\)/i,
  /allow this (action|command|tool)/i,
];

// Claude Code renders a failed turn as e.g. "API Error: 500 Internal server
// error ... try again". 5xx, 429 (rate) and "overloaded" are transient and worth
// an automatic retry; 4xx like 400 (bad request) are not, so we don't match them.
const TRANSIENT_ERROR = /api error:\s*(429|5\d\d|overloaded)/gi;

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

function looksLikePermissionPrompt(tail: string): boolean {
  const recent = tail.slice(-1024);
  return PERMISSION_PATTERNS.some((pattern) => pattern.test(recent));
}

const OPTION_PATTERN = /^[\s❯>*•◯●○-]*(\d+)\.\s+(.+?)\s*$/;
const QUESTION_HINT = /\?|do you want|allow|proceed|continue|overwrite|confirm/i;

function clip(text: string, max = 100): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Best-effort: pull the question and selectable options out of the (ANSI-
 * stripped) terminal tail so the UI can render a readable prompt. Tolerant by
 * design - when nothing recognizable is found it returns a generic question so
 * the operator still gets a clear "needs you" banner.
 */
export function extractPrompt(tail: string): SessionPrompt {
  const lines = tail.slice(-1500).split('\n');

  // Collect numbered options, keeping the most recent label per key.
  const byKey = new Map<string, string>();
  let firstOptionLine = -1;
  lines.forEach((line, index) => {
    const match = OPTION_PATTERN.exec(line);
    if (match) {
      if (firstOptionLine === -1) firstOptionLine = index;
      byKey.set(match[1]!, clip(match[2]!));
    }
  });
  const options: SessionPromptOption[] = [...byKey.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, label]) => ({ key, label }));

  // The question is the last meaningful line above the options (or above the
  // end if there are none) that reads like a prompt.
  const ceiling = firstOptionLine === -1 ? lines.length : firstOptionLine;
  let question = '';
  for (let i = ceiling - 1; i >= 0 && i >= ceiling - 8; i--) {
    const text = clip(lines[i] ?? '', 160);
    if (!text) continue;
    if (QUESTION_HINT.test(text)) {
      question = text;
      break;
    }
    if (!question) question = text; // fall back to the nearest non-empty line
  }

  if (options.length === 0 && /\(y\/n\)/i.test(tail.slice(-200))) {
    options.push({ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' });
  }

  return { question: question || 'Claude needs your input.', options };
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
  private currentPrompt: SessionPrompt | null = null;
  // Count of transient-error occurrences last seen in the tail. We fire only when
  // the count INCREASES (a genuinely new error), so an error lingering in the
  // rolling window after a successful retry never re-triggers.
  private lastTransientCount = 0;
  private warmedUp = false;
  private readonly createdAt = Date.now();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly onChange: (activity: SessionActivity, prompt: SessionPrompt | null) => void,
    private readonly onTransientError?: () => void,
    // Overridable so tests can disable the attach warm-up (default below).
    private readonly warmupMs: number = WARMUP_MS,
  ) {
    this.timer = setInterval(() => this.evaluate(), TICK_MS);
    this.timer.unref();
  }

  get activity(): SessionActivity {
    return this.current;
  }

  get prompt(): SessionPrompt | null {
    return this.currentPrompt;
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

    const nextPrompt = next === 'awaiting_permission' ? extractPrompt(this.tail) : null;
    const promptChanged =
      JSON.stringify(nextPrompt) !== JSON.stringify(this.currentPrompt);

    if (next !== this.current || promptChanged) {
      this.current = next;
      this.currentPrompt = nextPrompt;
      this.onChange(next, nextPrompt);
    }

    // A new transient API error means the turn failed; signal so the manager can
    // auto-retry. Count-based so a lingering error doesn't fire repeatedly. During
    // the attach warm-up we only baseline, so a stale error redrawn on (re)attach
    // never triggers a retry.
    const count = (this.tail.match(TRANSIENT_ERROR) ?? []).length;
    if (this.warmedUp || Date.now() - this.createdAt >= this.warmupMs) {
      this.warmedUp = true;
      if (count > this.lastTransientCount) this.onTransientError?.();
    }
    this.lastTransientCount = count;
  }
}
