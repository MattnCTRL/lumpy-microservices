'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  HostedService,
  KnowledgeBase,
  Project,
  ProjectDatabase,
  Server,
  Session,
} from '@lumpy/shared';
import { Field } from '@/components/Field';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      setError(null);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="bg-red-100 px-4 py-2 text-sm text-red-700">
          {error} - is the orchestrator running on {ORCHESTRATOR_URL}?
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={`w-full shrink-0 overflow-y-auto border-neutral-800 p-3 md:block md:w-72 md:border-r ${
            selected ? 'hidden' : 'block'
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300">Projects</h2>
            <button
              onClick={() => setCreating(true)}
              className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
            >
              New
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="px-1 py-2 text-sm text-neutral-500">No projects yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      p.id === selectedId
                        ? 'border-neutral-600 bg-neutral-900'
                        : 'border-transparent hover:bg-neutral-900/60'
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-neutral-100">{p.name}</div>
                    <div className="truncate font-mono text-xs text-neutral-500">{p.workspace}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className={`min-h-0 flex-1 overflow-y-auto p-4 ${selected ? 'block' : 'hidden md:block'}`}>
          {selected ? (
            <ProjectDetail
              key={selected.id}
              project={selected}
              onBack={() => setSelectedId(null)}
              onChanged={() => void refresh()}
              onDeleted={() => {
                setSelectedId(null);
                void refresh();
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              Select a project, or create one.
            </div>
          )}
        </main>
      </div>

      {creating && (
        <CreateProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setSelectedId(p.id);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ProjectDetail({
  project,
  onBack,
  onChanged,
  onDeleted,
}: {
  project: Project;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button
        onClick={onBack}
        className="text-sm text-neutral-400 hover:text-neutral-200 md:hidden"
      >
        ← Projects
      </button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-neutral-100">{project.name}</h1>
          <p className="font-mono text-xs text-neutral-500">{project.workspace}</p>
          {project.description && (
            <p className="mt-1 text-sm text-neutral-400">{project.description}</p>
          )}
        </div>
        <button
          onClick={async () => {
            if (confirm(`Delete project "${project.name}"? (sessions and files are left in place)`)) {
              await api.deleteProject(project.id);
              onDeleted();
            }
          }}
          className="shrink-0 text-xs text-neutral-500 hover:text-red-700"
        >
          delete
        </button>
      </div>

      <SourcesPanel project={project} onChanged={onChanged} />
      <KnowledgePanel project={project} />
      <SessionsPanel project={project} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="surface p-4">
      <h2 className="text-sm font-medium text-neutral-100">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function SourcesPanel({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [machines, setMachines] = useState<Server[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [repos, setRepos] = useState(project.sources.repos.join('\n'));
  const [machineId, setMachineId] = useState(project.sources.machineId ?? '');
  const [paths, setPaths] = useState(project.sources.sourcePaths.join('\n'));
  const [serverIds, setServerIds] = useState<string[]>(project.sources.serverIds);
  const [hostedServices, setHostedServices] = useState<HostedService[]>(
    project.sources.hostedServices,
  );
  const [useConnectors, setUseConnectors] = useState(project.sources.useConnectors);
  const [databases, setDatabases] = useState<ProjectDatabase[]>(project.sources.databases);
  const [saved, setSaved] = useState(false);

  const setDb = (i: number, patch: Partial<ProjectDatabase>) =>
    setDatabases((dbs) => dbs.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addDb = () => setDatabases((dbs) => [...dbs, { label: '', url: '' }]);
  const removeDb = (i: number) => setDatabases((dbs) => dbs.filter((_, j) => j !== i));
  const toggleServer = (id: string) =>
    setServerIds((ids) => (ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id]));
  const setHs = (i: number, patch: Partial<HostedService>) =>
    setHostedServices((hs) => hs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addHs = () => setHostedServices((hs) => [...hs, { name: '', url: '', serverId: null }]);
  const removeHs = (i: number) => setHostedServices((hs) => hs.filter((_, j) => j !== i));

  useEffect(() => {
    api
      .listServers()
      .then((s) => {
        setMachines(s.filter((m) => m.kind !== 'server'));
        setServers(s.filter((m) => m.kind === 'server'));
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    await api.updateProject(project.id, {
      sources: {
        repos: repos
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean),
        machineId: machineId || null,
        sourcePaths: paths
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean),
        serverIds,
        hostedServices: hostedServices
          .map((s) => ({ name: s.name.trim(), url: s.url.trim(), serverId: s.serverId }))
          .filter((s) => s.name && s.url),
        useConnectors,
        databases: databases
          .map((d) => ({ label: d.label.trim() || 'main', url: d.url.trim() }))
          .filter((d) => d.url),
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onChanged();
  };

  return (
    <Section
      title="Knowledge sources"
      hint="The full picture the librarian draws from to build this project's manual."
    >
      <div className="space-y-3">
        <Field label="Git repos" hint="one per line - a project can span several repos (optional)">
          <textarea
            value={repos}
            onChange={(e) => setRepos(e.target.value)}
            className="input h-16"
            placeholder={'github.com/you/project\ngithub.com/you/project-api'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Linked machine" hint="read local files from this machine over SSHFS">
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="input">
            <option value="">none</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.address})
              </option>
            ))}
          </select>
        </Field>
        {machineId && (
          <Field label="Source paths" hint="one per line, relative to that machine's home">
            <textarea value={paths} onChange={(e) => setPaths(e.target.value)} className="input h-20" placeholder={'Developer/myproject\nDocuments/specs'} />
          </Field>
        )}
        <Field
          label="Servers"
          hint="cloud servers from the Fleet that this project runs on - attributes the infra to this project."
        >
          {servers.length === 0 ? (
            <p className="text-xs text-neutral-500">No servers in the Fleet yet.</p>
          ) : (
            <div className="space-y-1.5">
              {servers.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200"
                >
                  <input
                    type="checkbox"
                    checked={serverIds.includes(s.id)}
                    onChange={() => toggleServer(s.id)}
                  />
                  {s.name} <span className="text-xs text-neutral-500">({s.address})</span>
                </label>
              ))}
            </div>
          )}
        </Field>
        <Field
          label="Hosted services"
          hint="live apps/products this project runs (e.g. NubSec). Pick the server each runs on - the Fleet shows them with live status under that machine."
        >
          <div className="space-y-2">
            {hostedServices.map((svc, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input
                  value={svc.name}
                  onChange={(e) => setHs(i, { name: e.target.value })}
                  className="input w-28 shrink-0"
                  placeholder="name"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <input
                  value={svc.url}
                  onChange={(e) => setHs(i, { url: e.target.value })}
                  className="input min-w-[12rem] flex-1"
                  placeholder="https://service.example.com"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <select
                  value={svc.serverId ?? ''}
                  onChange={(e) => setHs(i, { serverId: e.target.value || null })}
                  className="input w-36 shrink-0"
                >
                  <option value="">no server</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeHs(i)}
                  className="shrink-0 rounded-md border border-neutral-700 px-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  aria-label="remove hosted service"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addHs}
              className="rounded-md border border-dashed border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              + Add hosted service
            </button>
          </div>
        </Field>
        <Field
          label="Databases"
          hint="a project can use several. Supabase URLs (https://<ref>.supabase.co) are scoped to THIS project via the account token (Settings); other databases are recorded for the manual."
        >
          <div className="space-y-2">
            {databases.map((db, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={db.label}
                  onChange={(e) => setDb(i, { label: e.target.value })}
                  className="input w-28 shrink-0"
                  placeholder="purpose"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <input
                  value={db.url}
                  onChange={(e) => setDb(i, { url: e.target.value })}
                  className="input flex-1"
                  placeholder="https://abcdefgh.supabase.co"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  onClick={() => removeDb(i)}
                  className="shrink-0 rounded-md border border-neutral-700 px-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  aria-label="remove database"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addDb}
              className="rounded-md border border-dashed border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              + Add database
            </button>
          </div>
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200">
          <input type="checkbox" checked={useConnectors} onChange={(e) => setUseConnectors(e.target.checked)} />
          Also review connected data when building the manual
        </label>
        <button
          onClick={save}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          {saved ? 'Saved ✓' : 'Save sources'}
        </button>
      </div>
    </Section>
  );
}

function KnowledgePanel({ project }: { project: Project }) {
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getKnowledge(project.id)
      .then((k) => {
        setKb(k);
        setDraftText(k.claudeMd);
      })
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const derive = async () => {
    setBusy('derive');
    setNote(null);
    try {
      await api.deriveKnowledge(project.id);
      setNote('Librarian started - it will read your sources and write a draft. Refresh in a bit.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Operating manual (knowledge base)"
      hint="Governs every Claude session in this project (written to CLAUDE.md). Build it from your sources, review, and approve."
    >
      {!kb ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={derive}
              disabled={busy !== null}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy === 'derive' ? 'Starting librarian…' : '✦ Build / refresh from sources'}
            </button>
            <button onClick={load} className="text-xs text-neutral-500 hover:text-neutral-200">
              refresh
            </button>
          </div>
          {note && <p className="text-xs text-emerald-700">{note}</p>}

          {kb.draft !== null && (
            <div className="rounded-md border border-amber-300/50 bg-amber-100 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Draft awaiting approval
              </p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs text-neutral-300">
                {kb.draft}
              </pre>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={async () => {
                    await api.approveKnowledge(project.id);
                    load();
                  }}
                  className="rounded-md bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-white"
                >
                  Approve → CLAUDE.md
                </button>
                <button
                  onClick={async () => {
                    await api.discardKnowledge(project.id);
                    load();
                  }}
                  className="rounded-md px-3 py-1 text-sm text-neutral-400 hover:text-red-700"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-neutral-400">CLAUDE.md (the governing rules)</p>
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              className="input h-48 font-mono text-xs"
              placeholder="# Operating manual\n\nWrite or generate the rules that govern this project…"
            />
            <button
              onClick={async () => {
                setBusy('save');
                await api.putKnowledge(project.id, draftText);
                setBusy(null);
                load();
              }}
              disabled={busy !== null}
              className="mt-2 rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : 'Save manual'}
            </button>
          </div>

          {kb.docs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-400">Knowledge docs</p>
              <ul className="flex flex-wrap gap-1.5">
                {kb.docs.map((d) => (
                  <li
                    key={d.name}
                    className="rounded border border-neutral-700 px-2 py-0.5 font-mono text-xs text-neutral-300"
                  >
                    {d.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function SessionsPanel({ project }: { project: Project }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listSessions()
      .then((all) => setSessions(all.filter((s) => s.projectId === project.id)))
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const newSession = async () => {
    setBusy(true);
    try {
      await api.createSession({
        name: `${project.name} agent`,
        projectId: project.id,
        autonomous: true,
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Agents (sessions)" hint="Claude sessions running in this project - all governed by the manual above.">
      <div className="space-y-2">
        {sessions.length === 0 ? (
          <p className="text-sm text-neutral-500">No sessions in this project yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-glass bg-white/55 px-3 py-2"
              >
                <span className="truncate text-sm text-neutral-100">{s.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <span
                    className={`h-2 w-2 rounded-full ${s.status === 'running' ? 'bg-emerald-500' : 'bg-neutral-600'}`}
                  />
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={newSession}
            disabled={busy}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {busy ? 'Starting…' : '+ New session in project'}
          </button>
          <a href="/sessions" className="text-xs text-neutral-500 hover:text-neutral-200">
            open Sessions →
          </a>
        </div>
      </div>
    </Section>
  );
}

function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [description, setDescription] = useState('');
  const [origin, setOrigin] = useState<'import' | 'new'>('import');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const p = await api.createProject({
        name: name.trim(),
        workspace: workspace.trim() || undefined,
        description: description.trim() || undefined,
        origin,
      });
      onCreated(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create project');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-md surface p-5">
        <h2 className="mb-4 text-base font-semibold text-neutral-100">New project</h2>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOrigin('import')}
            className={`rounded-md border p-3 text-left text-sm ${
              origin === 'import'
                ? 'border-neutral-500 bg-neutral-900 text-neutral-100'
                : 'border-neutral-800 text-neutral-400 hover:bg-neutral-900/50'
            }`}
          >
            Import existing
            <span className="mt-0.5 block text-xs text-neutral-500">
              Collect &amp; analyze its sources first, then move forward.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOrigin('new')}
            className={`rounded-md border p-3 text-left text-sm ${
              origin === 'new'
                ? 'border-neutral-500 bg-neutral-900 text-neutral-100'
                : 'border-neutral-800 text-neutral-400 hover:bg-neutral-900/50'
            }`}
          >
            Create new
            <span className="mt-0.5 block text-xs text-neutral-500">
              Scaffold mapping &amp; connectors to save data going forward.
            </span>
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Name">
            <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Latchkey" />
          </Field>
          <Field label="Workspace" hint="path on the box - blank uses /home/lumpy/projects/<name>">
            <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} className="input" placeholder="/home/lumpy/projects/latchkey" />
          </Field>
          <Field label="Description" hint="optional">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" placeholder="what this project is" />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
