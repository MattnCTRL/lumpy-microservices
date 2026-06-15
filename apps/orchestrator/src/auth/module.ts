import { randomBytes } from 'node:crypto';
import type { GithubUser } from '@lumpy/shared';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { USER_COOKIE, readUser, roleFor } from './session.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const STATE_COOKIE = 'lumpy_oauth_state';

/**
 * Sign in with GitHub. The Lumpy profile mirrors the GitHub account (avatar,
 * name, handle). Sign-in is optional - the app is already private on the
 * tailnet - and is disabled until LUMPY_GITHUB_CLIENT_ID/SECRET are set.
 */
export const authModule: LumpyModule = {
  id: 'auth',
  name: 'Authentication',
  version: '0.1.0',
  description: 'Sign in with GitHub and mirror the GitHub profile.',
  register(ctx: ModuleContext) {
    const { app, config } = ctx;
    const { clientId, clientSecret } = config.github;
    const redirectUri = `${config.publicUrl}/api/auth/github/callback`;
    const webUrl = config.webUrl || '/';

    if (!clientId || !clientSecret) {
      logger.warn('GitHub sign-in not configured (set LUMPY_GITHUB_CLIENT_ID/SECRET)');
    }

    app.get('/api/auth/me', async (request) => {
      return {
        configured: Boolean(clientId && clientSecret),
        required: config.requireAuth && Boolean(clientId && clientSecret),
        user: readUser(request),
      };
    });

    app.get('/api/auth/github/login', async (_request, reply) => {
      if (!clientId) return reply.status(503).send({ error: 'GitHub sign-in not configured' });
      const state = randomBytes(16).toString('hex');
      reply.setCookie(STATE_COOKIE, state, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        signed: true,
        maxAge: 600,
      });
      const url =
        `${AUTHORIZE_URL}?client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;
      return reply.redirect(url);
    });

    app.get('/api/auth/github/callback', async (request, reply) => {
      const { code, state } = request.query as { code?: string; state?: string };
      const stateRaw = request.cookies[STATE_COOKIE];
      const stateCheck = stateRaw ? request.unsignCookie(stateRaw) : { valid: false, value: null };
      if (!code || !state || !stateCheck.valid || stateCheck.value !== state) {
        return reply.status(400).send({ error: 'invalid OAuth state' });
      }

      try {
        const tokenResponse = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        });
        const token = (await tokenResponse.json()) as { access_token?: string };
        if (!token.access_token) return reply.status(401).send({ error: 'token exchange failed' });

        const userResponse = await fetch(USER_URL, {
          headers: {
            authorization: `Bearer ${token.access_token}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'lumpy',
          },
        });
        const gh = (await userResponse.json()) as {
          login: string;
          name: string | null;
          avatar_url: string;
        };
        const profile: GithubUser = {
          login: gh.login,
          name: gh.name,
          avatarUrl: gh.avatar_url,
          role: roleFor(gh.login, config.adminLogins),
        };

        reply.setCookie(USER_COOKIE, JSON.stringify(profile), {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          signed: true,
          maxAge: 60 * 60 * 24 * 30,
        });
        reply.clearCookie(STATE_COOKIE, { path: '/' });
        logger.info({ login: profile.login }, 'github sign-in');
        return reply.redirect(webUrl);
      } catch (error) {
        logger.error({ error }, 'github sign-in failed');
        return reply.status(502).send({ error: 'github sign-in failed' });
      }
    });

    app.post('/api/auth/logout', async (_request, reply) => {
      reply.clearCookie(USER_COOKIE, { path: '/' });
      return reply.status(204).send();
    });
  },
};
