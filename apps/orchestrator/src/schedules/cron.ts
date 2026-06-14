/**
 * Minimal 5-field cron, evaluated in UTC: minute hour day-of-month month day-of-week.
 * Each field supports a wildcard, step values (e.g. every-15), ranges (a-b),
 * stepped ranges (a-b step n), and comma-separated lists. Day-of-week is 0-6
 * with Sunday = 0. Day-of-month and day-of-week are ANDed (keep one a wildcard
 * for the common case).
 */

const RANGES: readonly [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1;
    let range = part;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      step = Number(part.slice(slash + 1));
      range = part.slice(0, slash);
      if (!Number.isInteger(step) || step < 1) return null;
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Set<number>[] | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const range = RANGES[i];
    const part = parts[i];
    if (range === undefined || part === undefined) return null;
    const set = parseField(part, range[0], range[1]);
    if (!set) return null;
    fields.push(set);
  }
  return fields;
}

export function cronValid(expr: string): boolean {
  return parseCron(expr) !== null;
}

function matchesFields(fields: Set<number>[], date: Date): boolean {
  return (
    (fields[0]?.has(date.getUTCMinutes()) ?? false) &&
    (fields[1]?.has(date.getUTCHours()) ?? false) &&
    (fields[2]?.has(date.getUTCDate()) ?? false) &&
    (fields[3]?.has(date.getUTCMonth() + 1) ?? false) &&
    (fields[4]?.has(date.getUTCDay()) ?? false)
  );
}

export function cronMatches(expr: string, date: Date): boolean {
  const fields = parseCron(expr);
  return fields ? matchesFields(fields, date) : false;
}

/** The next minute (after `from`) at which the expression fires, or null. */
export function nextRun(expr: string, from: Date): Date | null {
  const fields = parseCron(expr);
  if (!fields) return null;
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  // A valid cron always fires within a year; cap the scan as a safety net.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchesFields(fields, d)) return new Date(d.getTime());
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}
