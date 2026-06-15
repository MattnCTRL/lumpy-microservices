import { z } from 'zod';
import type { SettingsResponse } from '@lumpy/shared';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { VERSION } from '../version.js';
import { syncGithubToken, syncVercelToken } from './credentials.js';

const SUPABASE_PAT = 'supabase_pat';
const VERCEL_TOKEN = 'vercel_token';
const GITHUB_TOKEN = 'github_token';

const patchSchema = z.object({
  remediationMode: z.enum(['off', 'investigate', 'auto']).optional(),
  remediationAutoSeverities: z.array(z.enum(['warning', 'critical'])).optional(),
  /** Account-level Supabase Personal Access Token (sbp_…); empty string clears it. */
  supabaseToken: z.string().optional(),
  /** Account-level Vercel Access Token; empty string clears it. */
  vercelToken: z.string().optional(),
  /** Account-level GitHub token (covers all your repos); empty string clears it. */
  githubToken: z.string().optional(),
});

function view(ctx: ModuleContext): SettingsResponse {
  const current = ctx.settings.get();
  return {
    remediation: {
      mode: current.remediationMode,
      autoSeverities: current.remediationAutoSeverities,
    },
    integrations: {
      supabaseConfigured: ctx.store.hasSecret(SUPABASE_PAT),
      vercelConfigured: ctx.store.hasSecret(VERCEL_TOKEN),
      githubConfigured: ctx.store.hasSecret(GITHUB_TOKEN),
    },
    system: {
      version: VERSION,
      sessionUser: ctx.config.sessionUser || null,
      workspaceRoot: ctx.config.workspaceRoot,
      publicUrl: ctx.config.publicUrl || null,
      defaultCommand: ctx.config.defaultCommand,
      notifications: {
        configured: Boolean(ctx.config.ntfyTopic),
        topic: ctx.config.ntfyTopic || null,
        server: ctx.config.ntfyUrl,
      },
    },
  };
}

export const settingsModule: LumpyModule = {
  id: 'settings',
  name: 'Settings',
  version: '0.1.0',
  description: 'Runtime configuration and system overview.',
  register(ctx: ModuleContext) {
    ctx.app.get('/api/settings', async () => view(ctx));

    ctx.app.patch('/api/settings', async (request, reply) => {
      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const { supabaseToken, vercelToken, githubToken, ...settings } = parsed.data;
      ctx.settings.update(settings);
      if (supabaseToken !== undefined) {
        ctx.store.setSecret(SUPABASE_PAT, supabaseToken.trim() || null);
      }
      if (vercelToken !== undefined) {
        ctx.store.setSecret(VERCEL_TOKEN, vercelToken.trim() || null);
        syncVercelToken(ctx.store);
      }
      if (githubToken !== undefined) {
        ctx.store.setSecret(GITHUB_TOKEN, githubToken.trim() || null);
        syncGithubToken(ctx.store);
      }
      return view(ctx);
    });
  },
};
