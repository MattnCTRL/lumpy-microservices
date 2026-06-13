import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EventBus } from '../events/bus.js';
import { Store } from '../store/sqlite.js';
import { SessionManager } from './manager.js';
import * as tmux from './tmux.js';

const tmuxAvailable = await tmux.isAvailable();

test(
  'recovers a running session after a simulated restart',
  { skip: tmuxAvailable ? false : 'tmux not available' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumpy-test-'));
    const prefix = `lumpytest${Date.now()}`;
    const store = new Store(dir);
    const bus = new EventBus();
    const before = new SessionManager(store, bus, prefix);

    let id: string | undefined;
    try {
      // `cat` blocks on stdin, so the session stays alive for the test.
      const session = await before.create({
        name: 'rec',
        workspace: dir,
        command: 'cat',
        tags: [],
        autonomous: false,
        task: null,
      });
      id = session.id;
      assert.equal(session.status, 'running');
      assert.ok(before.getBroker(id), 'broker attached on create');

      // Simulate an orchestrator restart: drop brokers but leave tmux running.
      before.disposeAll();
      assert.equal(before.getBroker(id), undefined, 'broker detached on dispose');

      const after = new SessionManager(store, bus, prefix);
      await after.recover();

      assert.ok(after.getBroker(id), 'broker re-attached after recover');
      const recovered = (await after.list()).find((s) => s.id === id);
      assert.equal(recovered?.status, 'running', 'session still running after recover');
    } finally {
      if (id) await before.stop(id);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
