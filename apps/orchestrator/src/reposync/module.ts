import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RepoSyncResult, RepoSyncStatus } from '@lumpy/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { resolveRunAs, runAsEnv, type RunAs } from '../sessions/runas.js';

const exec = promisify(execFile);
const SYNC_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;
const BRANCH = 'lumpy-autosync';

async function git(dir: string, args: string[], runAs: RunAs): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await exec('git', ['-C', dir, ...args], {
      uid: runAs.uid,
      gid: runAs.gid,
      env: runAsEnv(runAs),
      timeout: 120_000,
    });
    return { ok: true, out: stdout.trim() };
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return { ok: false, out: (e.stderr || e.message || 'git error').toString().trim() };
  }
}

/**
 * Repo Sync: backs the box's real git repos up to GitHub on a schedule so work
 * that only exists on the box (e.g. uncommitted edits) can't be lost. It mirrors
 * each repo's current working state to a `lumpy-autosync` branch WITHOUT touching
 * the local branch or `main` - commit, push to the backup branch, then soft-undo
 * the commit so the working tree is exactly as it was.
 */
export const repoSyncModule: LumpyModule = {
  id: 'reposync',
  name: 'Repo Sync',
  version: '0.1.0',
  description: 'Backs the box git repos up to GitHub (lumpy-autosync branch) on a schedule.',
  register(ctx: ModuleContext) {
    const { app, store } = ctx;
    let runAs: RunAs | null = null;
    try {
      if (config.sessionUser) runAs = resolveRunAs(config.sessionUser);
    } catch {
      runAs = null;
    }

    let lastRunAt: string | null = null;
    let lastResults: RepoSyncResult[] = [];
    let inFlight = false;

    const discover = async (): Promise<string[]> => {
      if (!runAs) return [];
      let entries: string[] = [];
      try {
        entries = readdirSync(config.workspaceRoot);
      } catch {
        return [];
      }
      const repos: string[] = [];
      for (const name of entries) {
        const dir = join(config.workspaceRoot, name);
        if (!existsSync(join(dir, '.git'))) continue;
        const remote = await git(dir, ['remote', 'get-url', 'origin'], runAs);
        if (remote.ok && remote.out) repos.push(dir);
      }
      return repos;
    };

    const syncRepo = async (dir: string): Promise<RepoSyncResult> => {
      const at = new Date().toISOString();
      const repo = dir.split('/').pop() || dir;
      if (!runAs) return { repo, status: 'skipped', detail: 'no session user', at };
      const status = await git(dir, ['status', '--porcelain'], runAs);
      if (!status.ok) return { repo, status: 'error', detail: status.out.slice(0, 200), at };
      if (!status.out) return { repo, status: 'clean', detail: 'no changes', at };
      // Capture the working state on a throwaway commit, push it to the backup
      // branch, then soft-undo so local state is exactly as before.
      await git(dir, ['add', '-A'], runAs);
      const commit = await git(dir, ['commit', '-m', `lumpy autosync ${at}`, '--no-verify'], runAs);
      if (!commit.ok) return { repo, status: 'error', detail: `commit: ${commit.out.slice(0, 150)}`, at };
      const push = await git(dir, ['push', '--force', 'origin', `HEAD:${BRANCH}`], runAs);
      await git(dir, ['reset', 'HEAD~1'], runAs); // restore working tree
      if (!push.ok) return { repo, status: 'error', detail: `push: ${push.out.slice(0, 150)}`, at };
      return { repo, status: 'pushed', detail: `backed up to ${BRANCH}`, at };
    };

    const run = async (): Promise<RepoSyncResult[]> => {
      if (inFlight) return lastResults;
      inFlight = true;
      try {
        const now = new Date().toISOString();
        if (!store.hasSecret('github_token')) {
          lastResults = [{ repo: '(all)', status: 'skipped', detail: 'no GitHub token configured', at: now }];
          lastRunAt = now;
          return lastResults;
        }
        const repos = await discover();
        const results: RepoSyncResult[] = [];
        for (const dir of repos) results.push(await syncRepo(dir));
        lastResults = results;
        lastRunAt = now;
        for (const r of results) {
          if (r.status === 'pushed') store.appendActivity('reposync', `Backed up ${r.repo} → ${BRANCH}`, r.at);
          else if (r.status === 'error')
            store.appendActivity('reposync', `Repo sync failed: ${r.repo}`, r.at);
        }
        logger.info({ count: results.length }, 'repo sync run complete');
        return results;
      } finally {
        inFlight = false;
      }
    };

    const first = setTimeout(() => void run().catch((e) => logger.warn({ e }, 'repo sync failed')), FIRST_RUN_DELAY_MS);
    first.unref();
    const timer = setInterval(() => void run().catch((e) => logger.warn({ e }, 'repo sync failed')), SYNC_INTERVAL_MS);
    timer.unref();

    app.get(
      '/api/reposync',
      async (): Promise<RepoSyncStatus> => ({
        configured: store.hasSecret('github_token'),
        branch: BRANCH,
        lastRunAt,
        results: lastResults,
      }),
    );
    app.post('/api/reposync/run', async () => ({ results: await run() }));

    logger.info('repo sync module ready');
  },
};
