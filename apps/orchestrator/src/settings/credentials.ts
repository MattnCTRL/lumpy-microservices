import { execFileSync } from 'node:child_process';
import { chownSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveRunAs, runAsEnv } from '../sessions/runas.js';
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

/**
 * Wire the account GitHub token into the session user's git so the box can
 * push/pull. Writes ~/.git-credentials (used by the `store` credential helper)
 * and sets a credential helper + commit identity. Clears it when the token is
 * removed. This is what lets the box reach GitHub at all.
 */
export function syncGithubToken(store: Store): void {
  if (!config.sessionUser) return;
  let runAs: ReturnType<typeof resolveRunAs>;
  try {
    runAs = resolveRunAs(config.sessionUser);
  } catch {
    return;
  }
  const home = `/home/${config.sessionUser}`;
  const credPath = join(home, '.git-credentials');
  const token = store.getSecret('github_token');
  try {
    if (token) {
      // The classic credential-store format; `x-access-token` works for PATs.
      writeFileSync(credPath, `https://x-access-token:${token}@github.com\n`, { mode: 0o600 });
      chownSync(credPath, runAs.uid, runAs.gid);
      const git = (args: string[]) =>
        execFileSync('git', args, { uid: runAs.uid, gid: runAs.gid, env: runAsEnv(runAs) });
      git(['config', '--global', 'credential.helper', 'store']);
      git(['config', '--global', 'user.name', 'Lumpy Repo Sync']);
      git(['config', '--global', 'user.email', 'lumpy@nublear.com']);
      // Tighten: only this helper, and never prompt (fail fast in automation).
      git(['config', '--global', 'credential.https://github.com.helper', 'store']);
    } else {
      rmSync(credPath, { force: true });
    }
  } catch (error) {
    logger.warn({ error }, 'could not wire the GitHub token into git');
  }
}
