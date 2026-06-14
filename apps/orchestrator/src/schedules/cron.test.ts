import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cronMatches, cronValid, nextRun, parseCron } from './cron.js';

test('cronValid accepts well-formed expressions', () => {
  for (const expr of ['* * * * *', '0 9 * * *', '*/15 * * * *', '0 8 * * 1-5', '0 0 1 1 0']) {
    assert.equal(cronValid(expr), true, expr);
  }
});

test('cronValid rejects malformed expressions', () => {
  for (const expr of ['', '* * * *', '60 * * * *', '* 24 * * *', 'abc', '0 9 * * 7', '*/0 * * * *']) {
    assert.equal(cronValid(expr), false, expr);
  }
});

test('cronMatches respects minute and hour', () => {
  assert.equal(cronMatches('0 9 * * *', new Date('2026-06-14T09:00:00Z')), true);
  assert.equal(cronMatches('0 9 * * *', new Date('2026-06-14T09:01:00Z')), false);
  assert.equal(cronMatches('0 9 * * *', new Date('2026-06-14T10:00:00Z')), false);
});

test('step and range fields work', () => {
  const every15 = '*/15 * * * *';
  assert.equal(cronMatches(every15, new Date('2026-06-14T12:00:00Z')), true);
  assert.equal(cronMatches(every15, new Date('2026-06-14T12:15:00Z')), true);
  assert.equal(cronMatches(every15, new Date('2026-06-14T12:07:00Z')), false);
  // Weekdays only (Mon–Fri). 2026-06-14 is a Sunday.
  assert.equal(cronMatches('0 8 * * 1-5', new Date('2026-06-14T08:00:00Z')), false);
  assert.equal(cronMatches('0 8 * * 1-5', new Date('2026-06-15T08:00:00Z')), true);
});

test('nextRun finds the next firing minute', () => {
  const next = nextRun('0 9 * * *', new Date('2026-06-14T09:00:30Z'));
  assert.equal(next?.toISOString(), '2026-06-15T09:00:00.000Z');
  const soon = nextRun('*/15 * * * *', new Date('2026-06-14T12:01:00Z'));
  assert.equal(soon?.toISOString(), '2026-06-14T12:15:00.000Z');
});

test('parseCron expands lists', () => {
  const fields = parseCron('0,30 * * * *');
  assert.ok(fields);
  assert.deepEqual([...(fields?.[0] ?? [])].sort((a, b) => a - b), [0, 30]);
});
