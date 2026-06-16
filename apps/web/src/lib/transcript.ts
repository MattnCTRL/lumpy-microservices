// Turn a tmux capture of a Claude Code TUI session into readable transcript
// lines. The capture is the visible pane: an ASCII-art banner, the recent turns
// (❯ user, ● assistant/tool, ✻ status), and the input-box chrome at the bottom.
// We keep the meaningful turns and drop the decoration so it reads like a chat.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const BANNER = /[█▛▜▝▘▐▌▄▀]/; // Claude ASCII-art logo glyphs
const RULE = /^[─—_]{4,}$/; // box-border rules

function isNoise(s: string): boolean {
  return (
    s === '❯' || // empty input prompt
    s.startsWith('⏵⏵') ||
    s.includes('bypass permissions') ||
    s.includes('shift+tab to cycle') ||
    s.includes('for agents') ||
    BANNER.test(s) ||
    RULE.test(s)
  );
}

/** Cleaned, ordered transcript lines (oldest first) from a raw pane capture. */
export function parseSessionFeed(raw: string): string[] {
  const lines: string[] = [];
  for (const rawLine of raw.replace(ANSI, '').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const s = line.trim();
    if (!s || isNoise(s)) continue;
    lines.push(s);
  }
  return lines;
}

export type FeedRole = 'user' | 'assistant' | 'status' | 'error' | 'plain';

export function feedRole(line: string): FeedRole {
  if (/error|failed|cannot/i.test(line)) return 'error';
  if (line.startsWith('❯')) return 'user';
  if (line.startsWith('●')) return 'assistant';
  if (line.startsWith('✻') || /^(Cogitat|Thinking|Pondering|Working|Running)/i.test(line)) {
    return 'status';
  }
  return 'plain';
}
