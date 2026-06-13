import { chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// node-pty ships a prebuilt `spawn-helper` that can lose its executable bit when
// the package is extracted by some npm versions, which makes PTY spawning fail
// with "posix_spawnp failed". Restore the bit after install.

if (process.platform === 'win32') process.exit(0);

const prebuilds = 'node_modules/node-pty/prebuilds';

let entries;
try {
  entries = readdirSync(prebuilds, { recursive: true });
} catch {
  process.exit(0);
}

for (const entry of entries) {
  if (typeof entry === 'string' && entry.endsWith('spawn-helper')) {
    try {
      chmodSync(join(prebuilds, entry), 0o755);
    } catch {
      // Best effort; ignore.
    }
  }
}
