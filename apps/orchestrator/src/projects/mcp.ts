import type { Project } from '@lumpy/shared';

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

/**
 * Extract a Supabase project ref from a database URL or a bare ref. Handles the
 * common real shapes:
 * - project/API URL:        https://<ref>.supabase.co
 * - direct connection:      postgres://...@db.<ref>.supabase.co:5432/postgres
 * - pooler connection:      postgresql://postgres.<ref>:pw@aws-0-...pooler.supabase.com
 * - a bare ref string
 * Refs are 20-char lowercase alphanumeric; requiring >= 16 avoids matching short
 * subdomains like `app.supabase.com` (which would otherwise yield a bogus "app").
 * Returns null when no scoped ref can be derived - in which case NO Supabase MCP
 * server is written and NO account token is injected.
 */
export function supabaseRef(url: string): string | null {
  const s = url.trim();
  let m = s.match(/\bdb\.([a-z0-9]{16,})\.supabase\./i);
  if (m) return m[1] ?? null;
  m = s.match(/\bpostgres\.([a-z0-9]{16,})\b/i);
  if (m) return m[1] ?? null;
  m = s.match(/\/project\/([a-z0-9]{16,})/i); // dashboard URL: app.supabase.com/project/<ref>
  if (m) return m[1] ?? null;
  m = s.match(/https?:\/\/([a-z0-9]{16,})\.supabase\./i);
  if (m) return m[1] ?? null;
  return /^[a-z0-9]{16,}$/i.test(s) ? s : null;
}

/**
 * Build a project's MCP servers - one Supabase MCP per database, each pinned to
 * THAT database's ref via `--project-ref` so a session can never reach another
 * project's (or another of this project's) databases. The token is never written
 * to the file; it is referenced via ${SUPABASE_ACCESS_TOKEN} and injected at
 * launch from the encrypted store. Non-Supabase databases get no server.
 */
export function buildProjectMcpServers(
  project: Project,
  hasToken: boolean,
): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  if (!hasToken) return mcpServers;
  const used = new Set<string>();
  for (const db of project.sources.databases) {
    const ref = supabaseRef(db.url);
    if (!ref) continue;
    const base = `supabase-${slug(db.label || 'main')}`;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
    used.add(key);
    mcpServers[key] = {
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase@latest', '--read-only', `--project-ref=${ref}`],
      env: { SUPABASE_ACCESS_TOKEN: '${SUPABASE_ACCESS_TOKEN}' },
    };
  }
  return mcpServers;
}

/** Whether a project has at least one Supabase database that yields a scoped ref. */
export function hasScopedSupabaseDb(project: Project): boolean {
  return project.sources.databases.some((d) => supabaseRef(d.url) !== null);
}
