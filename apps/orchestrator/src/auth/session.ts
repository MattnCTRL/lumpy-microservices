import type { FastifyRequest } from 'fastify';
import type { GithubUser, Role } from '@lumpy/shared';

export const USER_COOKIE = 'lumpy_user';

/**
 * The role for a GitHub login. When no admin allow-list is configured, everyone
 * who signs in is an admin — so turning on auth can never lock the owner out.
 * Otherwise only listed logins are admins; everyone else is a read-only viewer.
 */
export function roleFor(login: string, adminLogins: string[]): Role {
  if (adminLogins.length === 0) return 'admin';
  return adminLogins.includes(login.toLowerCase()) ? 'admin' : 'viewer';
}

export type GateDecision = 'allow' | 'unauthenticated' | 'forbidden';

/**
 * Whether a request may proceed under the auth gate. Health and the sign-in
 * flow are always allowed; otherwise a signed-in user is required, and viewers
 * are read-only (mutations need the admin role).
 */
export function gateDecision(
  user: GithubUser | null,
  method: string,
  path: string,
): GateDecision {
  if (path === '/api/health' || path.startsWith('/api/auth/')) return 'allow';
  if (!user) return 'unauthenticated';
  if (user.role !== 'admin' && method.toUpperCase() !== 'GET') return 'forbidden';
  return 'allow';
}

/** Read and verify the signed user cookie, or null if absent/invalid. */
export function readUser(request: FastifyRequest): GithubUser | null {
  const raw = request.cookies[USER_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  try {
    return JSON.parse(unsigned.value) as GithubUser;
  } catch {
    return null;
  }
}
