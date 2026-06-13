import { join } from 'node:path';
import { customAlphabet } from 'nanoid';
import { z } from 'zod';
import type { Project, ProjectSources } from '@lumpy/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { FleetStore } from '../store/fleet.js';
import { resolveRunAs, type RunAs } from '../sessions/runas.js';
import { DRAFT_PATH, approveDraft, discardDraft, readKnowledge, writeClaudeMd } from './knowledge.js';

/** Build the librarian's prompt: read the project's cumulative sources, draft a manual. */
function buildLibrarianTask(project: Project, mountPath: string | null): string {
  const sources: string[] = [
    "This project's own repository, code, and docs in the current working directory.",
  ];
  if (mountPath) {
    const paths = project.sources.sourcePaths.length
      ? project.sources.sourcePaths.map((p) => `${mountPath}/${p.replace(/^\/+/, '')}`).join(', ')
      : mountPath;
    sources.push(`Local files on the linked machine, mounted at: ${paths}`);
  }
  if (project.sources.useConnectors) {
    sources.push(
      "The project's connected data sources via the MCP servers in .mcp.json (e.g. the Supabase schema, the TensorGarden portal). Review their structure and key contents.",
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
    `Write the result to ${DRAFT_PATH} (create the .lumpy/knowledge directory if needed). Do NOT modify CLAUDE.md — your draft will be reviewed and approved by the owner. When the draft is written, stop.`,
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

const sourcesSchema = z.object({
  repo: z.string().nullable().optional(),
  machineId: z.string().nullable().optional(),
  sourcePaths: z.array(z.string()).optional(),
  useConnectors: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(),
  description: z.string().optional(),
  origin: z.enum(['import', 'new']).optional(),
  sources: sourcesSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sources: sourcesSchema.optional(),
});

function mergeSources(base: ProjectSources, patch?: z.infer<typeof sourcesSchema>): ProjectSources {
  return {
    repo: patch?.repo !== undefined ? patch.repo : base.repo,
    machineId: patch?.machineId !== undefined ? patch.machineId : base.machineId,
    sourcePaths: patch?.sourcePaths ?? base.sourcePaths,
    useConnectors: patch?.useConnectors ?? base.useConnectors,
  };
}

const EMPTY_SOURCES: ProjectSources = {
  repo: null,
  machineId: null,
  sourcePaths: [],
  useConnectors: false,
};

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
        createdAt: new Date().toISOString(),
      };
      store.createProject(project);
      logger.info({ id, workspace }, 'project created');
      return reply.status(201).send(project);
    });

    app.patch('/api/projects/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const current = store.getProject(id);
      if (!current) return reply.status(404).send({ error: 'project not found' });
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
      }
      return store.updateProject(id, {
        name: parsed.data.name,
        description: parsed.data.description,
        sources: parsed.data.sources
          ? mergeSources(current.sources, parsed.data.sources)
          : undefined,
      });
    });

    app.delete('/api/projects/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!store.getProject(id)) return reply.status(404).send({ error: 'project not found' });
      store.deleteProject(id);
      return reply.status(204).send();
    });

    // --- Knowledge base (operating manual) ---

    app.get('/api/projects/:id/knowledge', async (request, reply) => {
      const { id } = request.params as { id: string };
      const project = store.getProject(id);
      if (!project) return reply.status(404).send({ error: 'project not found' });
      return readKnowledge(project.workspace);
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

      let mountPath: string | null = null;
      if (project.sources.machineId && config.sessionUser) {
        const machine = fleet.getServer(project.sources.machineId);
        if (machine) {
          mountPath = `/home/${config.sessionUser}/macs/${machine.address.replace(/[.:]/g, '-')}`;
        }
      }

      const session = await ctx.sessions.create({
        name: `Librarian: ${project.name}`,
        workspace: project.workspace,
        command: config.defaultCommand,
        tags: ['librarian'],
        autonomous: true,
        task: buildLibrarianTask(project, mountPath),
        projectId: project.id,
      });
      logger.info({ project: id, session: session.id }, 'librarian session started');
      return reply.status(202).send({ sessionId: session.id });
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
