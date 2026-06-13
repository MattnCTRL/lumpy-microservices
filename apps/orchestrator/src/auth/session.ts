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
 * Telemetry ingestion from agents (self-registration and metric pushes) is
 * machine-to-machine, not a human control action — agents have no GitHub login.
 * These paths are gated by the agent token instead (see http.ts).
 */
export function isAgentIngestPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  return path === '/api/fleet/servers' || /^\/api\/fleet\/servers\/[^/]+\/metrics$/.test(path);
}

/**
 * Whether a request may proceed under the auth gate. Health and the sign-in
 * flow are always allowed; agent telemetry is allowed when the agent is
 * authorized; otherwise a signed-in user is required, and viewers are read-only
 * (mutations need the admin role).
 */
export function gateDecision(
  user: GithubUser | null,
  method: string,
  path: string,
  agentAuthorized = false,
): GateDecision {
  if (path === '/api/health' || path.startsWith('/api/auth/')) return 'allow';
  if (agentAuthorized && isAgentIngestPath(method, path)) return 'allow';
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
    const user = JSON.parse(unsigned.value) as GithubUser;
    // Reject cookies from an older shape (e.g. before roles) so the user is
    // prompted to sign in again and gets a current, well-formed session.
    if (!user || typeof user.login !== 'string' || (user.role !== 'admin' && user.role !== 'viewer')) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}
