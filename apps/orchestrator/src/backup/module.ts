import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP = 7;
const DBS = ['lumpy.db', 'fleet.db'];

/**
 * Online snapshot of a live SQLite DB via the backup API (consistent even while
 * the orchestrator is writing through WAL; opens read-only so it never blocks).
 */
async function snapshot(src: string, dest: string): Promise<void> {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

/**
 * Periodic local backups of the durable state. All of it - sessions, fleet,
 * incidents, schedules, projects, and the encrypted SSH/account secrets - lives
 * only in the data dir on a single box, so a corruption or fat-fingered
 * `rm`/`reset` is otherwise unrecoverable. We snapshot both stores AND the
 * encryption key together: without the key the encrypted secrets cannot be
 * decrypted, so they must travel as a unit. (Offsite copy is a follow-up; this
 * is the local safety net.)
 */
export const backupModule: LumpyModule = {
  id: 'backup',
  name: 'Backups',
  version: '0.1.0',
  description: 'Daily local snapshots of the SQLite stores and the encryption key.',
  register(ctx: ModuleContext) {
    const dataDir = ctx.config.dataDir;
    const root = join(dataDir, 'backups');

    const prune = (): void => {
      try {
        const dirs = readdirSync(root)
          .filter((d) => /^\d{4}-/.test(d))
          .sort();
        for (const old of dirs.slice(0, Math.max(0, dirs.length - KEEP))) {
          rmSync(join(root, old), { recursive: true, force: true });
        }
      } catch {
        // nothing to prune yet
      }
    };

    const runBackup = async (): Promise<void> => {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = join(root, stamp);
        mkdirSync(dir, { recursive: true });
        for (const name of DBS) {
          try {
            await snapshot(join(dataDir, name), join(dir, name));
          } catch (error) {
            logger.warn({ db: name, error }, 'backup: could not snapshot a db');
          }
        }
        try {
          copyFileSync(join(dataDir, '.secret.key'), join(dir, '.secret.key'));
        } catch {
          // no key file yet
        }
        prune();
        logger.info({ dir }, 'backup written');
      } catch (error) {
        logger.error({ error }, 'backup failed');
      }
    };

    // Once shortly after boot (so a fresh deploy has a recovery point), then daily.
    const first = setTimeout(() => void runBackup(), 60_000);
    first.unref();
    const timer = setInterval(() => void runBackup(), DAY_MS);
    timer.unref();
    logger.info('backup module ready (daily local snapshots)');
  },
};
