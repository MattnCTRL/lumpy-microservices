import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ActivityTracker, extractPrompt } from './activity.js';

test('extractPrompt pulls the question and numbered options', () => {
  const tail = [
    'Do you want to make this edit to config.ts?',
    '❯ 1. Yes',
    '  2. Yes, and don’t ask again',
    '  3. No, and tell Claude what to do differently',
  ].join('\n');
  const prompt = extractPrompt(tail);
  assert.match(prompt.question, /make this edit/i);
  assert.deepEqual(
    prompt.options.map((o) => o.key),
    ['1', '2', '3'],
  );
  assert.equal(prompt.options[0]?.label, 'Yes');
});

test('extractPrompt falls back to y/n options', () => {
  const prompt = extractPrompt('Overwrite existing file? (y/n)');
  assert.match(prompt.question, /overwrite/i);
  assert.deepEqual(
    prompt.options.map((o) => o.key),
    ['y', 'n'],
  );
});

test('extractPrompt always returns a question even when unrecognized', () => {
  const prompt = extractPrompt('some unrelated output without a clear prompt');
  assert.ok(prompt.question.length > 0);
});

test('reports working immediately after output', () => {
  const changes: string[] = [];
  const tracker = new ActivityTracker((activity) => changes.push(activity));
  tracker.feed(Buffer.from('compiling project\n'));
  assert.equal(tracker.activity, 'working');
  assert.deepEqual(changes, ['working']);
  tracker.stop();
});

test('detects a plain permission prompt', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.feed(Buffer.from('Do you want to proceed?'));
  assert.equal(tracker.activity, 'awaiting_permission');
  tracker.stop();
});

test('detects a numbered yes/no menu', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.feed(Buffer.from('Make this change?\n  1. Yes\n  2. No, tell Claude what to do\n'));
  assert.equal(tracker.activity, 'awaiting_permission');
  tracker.stop();
});

test('detects a (y/n) prompt', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.feed(Buffer.from('Overwrite file? (y/n) '));
  assert.equal(tracker.activity, 'awaiting_permission');
  tracker.stop();
});

test('matches prompts wrapped in ANSI color sequences', () => {
  const tracker = new ActivityTracker(() => {});
  tracker.feed(Buffer.from('\x1b[1m\x1b[33mDo you want to proceed?\x1b[0m'));
  assert.equal(tracker.activity, 'awaiting_permission');
  tracker.stop();
});

test('transitions to idle once output stops', () => {
  mock.timers.enable({ apis: ['Date', 'setInterval'] });
  try {
    const changes: string[] = [];
    const tracker = new ActivityTracker((activity) => changes.push(activity));
    tracker.feed(Buffer.from('building...\n'));
    assert.equal(tracker.activity, 'working');
    mock.timers.tick(2000);
    assert.equal(tracker.activity, 'idle');
    assert.deepEqual(changes, ['working', 'idle']);
    tracker.stop();
  } finally {
    mock.timers.reset();
  }
});

test('only emits on a real change', () => {
  const changes: string[] = [];
  const tracker = new ActivityTracker((activity) => changes.push(activity));
  tracker.feed(Buffer.from('one\n'));
  tracker.feed(Buffer.from('two\n'));
  tracker.feed(Buffer.from('three\n'));
  assert.deepEqual(changes, ['working']);
  tracker.stop();
});

test('fires once when a transient API error appears', () => {
  let fired = 0;
  const tracker = new ActivityTracker(
    () => {},
    () => {
      fired += 1;
    },
  );
  tracker.feed(Buffer.from('● API Error: 500 Internal server error. try again in a moment\n'));
  assert.equal(fired, 1, 'fires on the new transient error');
  // The same error lingering in the rolling tail must not re-fire.
  tracker.feed(Buffer.from('more output\n'));
  assert.equal(fired, 1, 'a lingering error does not re-fire');
  tracker.stop();
});

test('fires again only for a genuinely new transient error', () => {
  let fired = 0;
  const tracker = new ActivityTracker(
    () => {},
    () => {
      fired += 1;
    },
  );
  tracker.feed(Buffer.from('API Error: 529 overloaded\n'));
  assert.equal(fired, 1);
  tracker.feed(Buffer.from('recovered, working again\n'));
  tracker.feed(Buffer.from('API Error: 503 service unavailable\n'));
  assert.equal(fired, 2, 'a second distinct error fires again');
  tracker.stop();
});

test('does not treat a non-transient 4xx as retryable', () => {
  let fired = 0;
  const tracker = new ActivityTracker(
    () => {},
    () => {
      fired += 1;
    },
  );
  tracker.feed(Buffer.from('API Error: 400 bad request - your prompt was malformed\n'));
  assert.equal(fired, 0, '400 is not transient; no auto-retry');
  tracker.stop();
});
