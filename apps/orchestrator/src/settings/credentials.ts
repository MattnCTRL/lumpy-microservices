import { chownSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveRunAs } from '../sessions/runas.js';
import type { Store } from '../store/sqlite.js';

/**
 * Mirror the account Vercel token to a file the session user can read
 * (`~/.vercel-token`). New sessions get it via `$VERCEL_TOKEN` at launch, but
 * the always-on Conductor (which can't be restarted) needs a file it can read
 * on demand: `VERCEL_TOKEN=$(cat ~/.vercel-token) npx vercel …`.
 */
export function syncVercelToken(store: Store): void {
  if (!config.sessionUser) return;
  let runAs: ReturnType<typeof resolveRunAs>;
  try {
    runAs = resolveRunAs(config.sessionUser);
  } catch {
    return;
  }
  const path = join(`/home/${config.sessionUser}`, '.vercel-token');
  const token = store.getSecret('vercel_token');
  try {
    if (token) {
      writeFileSync(path, `${token}\n`, { mode: 0o600 });
      chownSync(path, runAs.uid, runAs.gid);
    } else {
      rmSync(path, { force: true });
    }
  } catch (error) {
    logger.warn({ error }, 'could not sync the Vercel token file');
  }
}
