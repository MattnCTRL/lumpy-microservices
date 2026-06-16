import { chownSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import type { Project, ProjectSources } from '@lumpy/shared';
import { config } from '../config.js';
import { mountState } from '../fleet/mounts.js';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { SessionCapacityError } from '../sessions/manager.js';
import { resolveRunAs, type RunAs } from '../sessions/runas.js';
import { FleetStore } from '../store/fleet.js';
import { ledgerDigest } from '../ledger/ingest.js';
import { DRAFT_PATH, approveDraft, discardDraft, readKnowledge, writeClaudeMd } from './knowledge.js';
import { buildProjectMcpServers } from './mcp.js';

/** Build the librarian's prompt: read the project's cumulative sources, draft a manual. */
function buildLibrarianTask(project: Project, mountPath: string | null, servers: string[]): string {
  const sources: string[] = [];
  if (project.sources.repos.length) {
    // The workspace is usually a fresh, empty directory on import: tell the
    // librarian to actually fetch the code rather than assuming it is already
    // present (which produced fabricated manuals).
    sources.push(
      `This project's source repositories - clone each into the current working directory (if not already present) and review it: ${project.sources.repos.join(', ')}. For private repos use the token in $GITHUB_TOKEN, e.g. \`git clone https://$GITHUB_TOKEN@github.com/<owner>/<repo>\`.`,
    );
  } else {
    sources.push("This project's own repository, code, and docs in the current working directory.");
  }
  if (servers.length) {
    sources.push(
      `Cloud infrastructure this project runs on: ${servers.join('; ')}. Note its role (hosting, deploys, runtime) in the manual.`,
    );
  }
  if (project.sources.hostedServices.length) {
    sources.push(
      `Live services this project hosts: ${project.sources.hostedServices
        .map((s) => `${s.name} (${s.url})`)
        .join('; ')}. Document what each does.`,
    );
  }
  if (mountPath) {
    const paths = project.sources.sourcePaths.length
      ? project.sources.sourcePaths.map((p) => `${mountPath}/${p.replace(/^\/+/, '')}`).join(', ')
      : mountPath;
    sources.push(`Local files on the linked machine, mounted at: ${paths}`);
  }
  if (project.sources.useConnectors) {
    const dbList = project.sources.databases.length
      ? ` This project's databases, by purpose: ${project.sources.databases
          .map((d) => `${d.label} - ${d.url}`)
          .join('; ')}.`
      : '';
    sources.push(
      `The project's connected data sources via the scoped MCP servers in .mcp.json (e.g. the Supabase schema). Review their structure and key contents.${dbList}`,
    );
  }
  const sourceList = sources.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    `You are the project librarian for "${project.name}". Build a comprehensive operating manual / knowledge base for this project by reviewing ALL of these sources and synthesizing the full picture:`,
    '',
    sourceList,
    '',
    'Produce a single Markdown operating manual covering: what this project is and its goals; its architecture and key components; data sources and schemas; the conventions and rules that govern work here; important workflows; and any gotchas or constraints.',
    '',
    `Write the result to ${DRAFT_PATH} (create the .lumpy/knowledge directory if needed). Do NOT modify CLAUDE.md - your draft will be reviewed and approved by the owner. When the draft is written, stop.`,
  ].join('\n');
}

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

const databaseSchema = z.object({
  label: z.string().default('main'),
  url: z.string(),
});

const hostedServiceSchema = z.object({
  name: z.string(),
  url: z.string(),
  serverId: z.string().nullable().default(null),
});

const sourcesSchema = z.object({
  repos: z.array(z.string()).optional(),
  machineId: z.string().nullable().optional(),
  sourcePaths: z.array(z.string()).optional(),
  serverIds: z.array(z.string()).optional(),
  hostedServices: z.array(hostedServiceSchema).optional(),
  useConnectors: z.boolean().optional(),
  databases: z.array(databaseSchema).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(),
  description: z.string().optional(),
  origin: z.enum(['import', 'new']).optional(),
  sources: sourcesSchema.optional(),
  supabaseToken: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sources: sourcesSchema.optional(),
  supabaseToken: z.string().optional(),
});

function mergeSources(base: ProjectSources, patch?: z.infer<typeof sourcesSchema>): ProjectSources {
  return {
    repos: patch?.repos ?? base.repos,
    machineId: patch?.machineId !== undefined ? patch.machineId : base.machineId,
    sourcePaths: patch?.sourcePaths ?? base.sourcePaths,
    serverIds: patch?.serverIds ?? base.serverIds,
    hostedServices: patch?.hostedServices ?? base.hostedServices,
    useConnectors: patch?.useConnectors ?? base.useConnectors,
    databases: patch?.databases ?? base.databases,
  };
}

const EMPTY_SOURCES: ProjectSources = {
  repos: [],
  machineId: null,
  sourcePaths: [],
  serverIds: [],
  hostedServices: [],
  useConnectors: false,
  databases: [],
};

/** Whether a Supabase token is available (per-project or account-level). */
function hasSupabaseToken(store: ModuleContext['store'], id: string): boolean {
  return store.getProjectSupabaseToken(id) !== null || store.hasSecret('supabase_pat');
}

/**
 * Write the project's own `.mcp.json` - one Supabase MCP per database, each
 * scoped to THAT database's ref (so a session can never touch another project's
 * - or another of this project's - databases unintentionally). The token is not
 * written to the file; it is referenced via ${SUPABASE_ACCESS_TOKEN} and
 * injected at launch from the encrypted store. Non-Supabase databases are
 * recorded on the project for the librarian but get no MCP server. The server
 * set is built by the shared helper that the session manager also re-derives on
 * every launch, so the two can never drift.
 */
function writeProjectMcp(project: Project, hasToken: boolean, runAs: RunAs | null): void {
  const mcpServers = buildProjectMcpServers(project, hasToken);
  try {
    mkdirSync(project.workspace, { recursive: true });
    const path = join(project.workspace, '.mcp.json');
    writeFileSync(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`);
    if (runAs) {
      try {
        chownSync(project.workspace, runAs.uid, runAs.gid);
        chownSync(path, runAs.uid, runAs.gid);
      } catch {
        // best-effort
      }
    }
  } catch (error) {
    logger.warn({ project: project.id, error }, 'could not write project .mcp.json');
  }
}

/**
 * First-class projects: governed workspaces with a knowledge base. A project's
 * sessions all run in its workspace and inherit its operating manual.
 */
export const projectsModule: LumpyModule = {
  id: 'projects',
  name: 'Projects',
  version: '0.1.0',
  description: 'Governed workspaces with a derived knowledge base and many agents.',
  register(ctx: ModuleContext) {
    const { app, store } = ctx;

    // Run-as user so knowledge files written by root are owned by the session user.
    let runAs: RunAs | null = null;
    if (config.sessionUser) {
      try {
        runAs = resolveRunAs(config.sessionUser);
      } catch {
        runAs = null;
      }
    }
    const fleet = new FleetStore(config.dataDir);

    app.get('/api/projects', async () => store.listProjects());

    app.get('/api/projects/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });
      return project;
    });

    app.post('/api/projects', async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const input = parsed.data;
      const id = generateId();
      const s = slug(input.name);
      const workspace = input.workspace?.trim() || join(config.workspaceRoot, s);
      const project: Project = {
        id,
        name: input.name.trim(),
        slug: s,
        workspace,
        description: input.description?.trim() || null,
        origin: input.origin ?? 'new',
        sources: mergeSources(EMPTY_SOURCES, input.sources),
        supabaseConfigured: Boolean(input.supabaseToken),
        createdAt: new Date().toISOString(),
      };
      store.createProject(project);
      if (input.supabaseToken) store.setProjectSupabaseToken(id, input.supabaseToken.trim());
      writeProjectMcp(project, hasSupabaseToken(store, id), runAs);
      logger.info({ id, workspace }, 'project created');
      return reply.status(201).send(store.getProject(id));
    });

    app.patch('/api/projects/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const current = store.getProject(id);
      if (!current) return reply.status(404).send({ error: 'project not found' });
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      const updated = store.updateProject(id, {
        name: parsed.data.name,
        description: parsed.data.description,
        sources: parsed.data.sources
          ? mergeSources(current.sources, parsed.data.sources)
          : undefined,
      });
      if (parsed.data.supabaseToken !== undefined) {
        store.setProjectSupabaseToken(id, parsed.data.supabaseToken.trim() || null);
      }
      // Refresh the project's isolated .mcp.json from its (possibly new) Supabase config.
      const fresh = store.getProject(id);
      if (fresh) writeProjectMcp(fresh, hasSupabaseToken(store, id), runAs);
      return fresh ?? updated;
    });

    app.delete('/api/projects/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getProject(id)) return reply.status(404).send({ error: 'project not found' });
      store.deleteProject(id);
      // The project's hosted-service URLs are no longer probed, so clear their
      // incidents rather than leaving an open one skewing uptime forever.
      store.deleteHostedIncidentsForProject(id);
      store.deleteLedgerForProject(id);
      return reply.status(204).send();
    });

    // --- Knowledge base (operating manual) ---

    app.get('/api/projects/:id/knowledge', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });
      return readKnowledge(project.workspace);
    });

    // The project's memory ledger (compact, deduped facts/decisions/checks/gotchas).
    app.get('/api/projects/:id/ledger', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getProject(id)) return reply.status(404).send({ error: 'project not found' });
      return store.listLedger('project', id);
    });

    app.put('/api/projects/:id/knowledge', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });
      const body = z.object({ claudeMd: z.string() }).safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: 'claudeMd is required' });
      writeClaudeMd(project.workspace, body.data.claudeMd, runAs);
      return readKnowledge(project.workspace);
    });

    // Spawn the librarian: an autonomous session that reads the project's
    // cumulative sources and drafts the operating manual for review.
    app.post('/api/projects/:id/derive', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });

      // One librarian per project at a time: a double-click (the button re-enables
      // on the 202, before the librarian finishes) must not stack Claude sessions.
      const runningLibrarian = (await ctx.sessions.list()).find(
        (s) => s.projectId === id && s.tags.includes('librarian') && s.status === 'running',
      );
      if (runningLibrarian) {
        return reply
          .status(409)
          .send({ error: 'a librarian is already running for this project', sessionId: runningLibrarian.id });
      }

      let mountPath: string | null = null;
      if (project.sources.machineId && config.sessionUser) {
        const machine = fleet.getServer(project.sources.machineId);
        // Only point the librarian at a mount that is actually live: reading a
        // stale FUSE mount (host asleep/offline) hangs the session in D-state I/O.
        if (machine && (await mountState(machine.address)).mounted) {
          mountPath = `/home/${config.sessionUser}/macs/${machine.address.replace(/[.:]/g, '-')}`;
        } else if (machine) {
          logger.warn(
            { project: id, machine: machine.id },
            'linked machine is not mounted; librarian will skip its files',
          );
        }
      }

      const servers = project.sources.serverIds
        .map((sid) => fleet.getServer(sid))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => `${s.name} (${s.address})`);

      // Ensure the project's isolated .mcp.json (its own DB, nothing else) is current.
      writeProjectMcp(project, hasSupabaseToken(store, id), runAs);

      // Give the librarian the account GitHub token (only when repos are
      // configured) so it can clone private repos.
      const librarianEnv: Record<string, string> = {};
      if (project.sources.repos.length && store.hasSecret('github_token')) {
        const token = store.getSecret('github_token');
        if (token) librarianEnv.GITHUB_TOKEN = token;
      }

      // Seed the project's existing memory so the librarian builds on it instead
      // of re-deriving what is already known.
      const baseTask = buildLibrarianTask(project, mountPath, servers);
      const prior = ledgerDigest(store, project.id);
      const task = prior
        ? `${baseTask}\n\nPRIOR PROJECT MEMORY (build on this; do not re-derive what is already known):\n${prior}`
        : baseTask;

      try {
        const session = await ctx.sessions.create({
          name: `Librarian: ${project.name}`,
          workspace: project.workspace,
          command: config.defaultCommand,
          tags: ['librarian'],
          autonomous: true,
          task,
          projectId: project.id,
          env: librarianEnv,
        });
        logger.info({ project: id, session: session.id }, 'librarian session started');
        return reply.status(202).send({ sessionId: session.id });
      } catch (error) {
        if (error instanceof SessionCapacityError) {
          return reply.status(503).send({ error: error.message });
        }
        throw error;
      }
    });

    app.post('/api/projects/:id/knowledge/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });
      if (!approveDraft(project.workspace, runAs)) {
        return reply.status(404).send({ error: 'no draft to approve' });
      }
      return readKnowledge(project.workspace);
    });

    app.post('/api/projects/:id/knowledge/discard', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });
      discardDraft(project.workspace);
      return reply.status(204).send();
    });

    logger.info('projects module ready');
  },
};
