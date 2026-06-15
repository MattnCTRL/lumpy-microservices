'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Project, Schedule } from '@lumpy/shared';
import { Field } from '@/components/Field';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 9:00 UTC', cron: '0 9 * * *' },
  { label: 'Weekdays 8:00 UTC', cron: '0 8 * * 1-5' },
  { label: 'Mondays 9:00 UTC', cron: '0 9 * * 1' },
];

function humanizeCron(cron: string): string {
  const preset = CRON_PRESETS.find((p) => p.cron === cron);
  if (preset) return preset.label;
  return cron;
}

function fmt(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSchedules(await api.listSchedules());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
    api.listProjects().then(setProjects).catch(() => {});
    const interval = setInterval(() => void refresh(), 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  const toggle = async (s: Schedule) => {
    await api.updateSchedule(s.id, { enabled: !s.enabled });
    void refresh();
  };
  const run = async (s: Schedule) => {
    setNote(null);
    try {
      await api.runSchedule(s.id);
      setNote(`Ran "${s.name}" - started a session.`);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'run failed');
    }
  };
  const remove = async (s: Schedule) => {
    await api.deleteSchedule(s.id);
    void refresh();
  };

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? null;

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-4">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Schedules</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
        >
          New
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        Recurring autonomous Claude jobs - manual refreshes, audits, health sweeps. Cron is UTC.
      </p>
      {error && <p className="mb-3 text-sm text-red-700">{error} - {ORCHESTRATOR_URL}</p>}
      {note && <p className="mb-3 text-sm text-emerald-700">{note}</p>}

      {schedules.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No schedules yet. Create one to run a task on a cadence.
        </p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li
              key={s.id}
              className={`rounded-lg border bg-neutral-950 p-3 ${
                s.enabled ? 'border-neutral-800' : 'border-neutral-900 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-100">{s.name}</span>
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
                      {s.cron}
                    </span>
                    <span className="text-xs text-neutral-500">{humanizeCron(s.cron)}</span>
                    {projectName(s.projectId) && (
                      <span className="text-xs text-indigo-700">↳ {projectName(s.projectId)}</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{s.task}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-600">
                    <span>next: {s.enabled ? fmt(s.nextRunAt) : 'paused'}</span>
                    <span>
                      last: {fmt(s.lastRunAt)}
                      {s.lastStatus === 'error' && <span className="text-red-700"> (failed)</span>}
                      {s.lastStatus === 'ok' && <span className="text-emerald-500"> ✓</span>}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    onClick={() => void toggle(s)}
                    className={`rounded border px-2 py-0.5 text-xs ${
                      s.enabled
                        ? 'border-emerald-300/60 text-emerald-700 hover:bg-emerald-100'
                        : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                    }`}
                  >
                    {s.enabled ? 'enabled' : 'paused'}
                  </button>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => void run(s)} className="text-neutral-400 hover:text-neutral-100">
                      run now
                    </button>
                    <button onClick={() => void remove(s)} className="text-neutral-500 hover:text-red-700">
                      delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateDialog
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateDialog({
  projects,
  onClose,
  onCreated,
}: {
  projects: Project[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [task, setTask] = useState('');
  const [projectId, setProjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createSchedule({
        name: name.trim(),
        cron: cron.trim(),
        task: task.trim(),
        projectId: projectId || null,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to create schedule');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-md surface p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-neutral-100">New schedule</h2>
        <div className="space-y-3">
          <Field label="Name">
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nightly manual refresh"
              className="input"
            />
          </Field>
          <Field label="Cron (UTC)" hint="minute hour day-of-month month day-of-week">
            <input
              required
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * *"
              className="input font-mono"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => setCron(p.cron)}
                  className={`rounded border px-2 py-0.5 text-[11px] ${
                    cron === p.cron
                      ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                      : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Project" hint="scope to a project's workspace, manual & connectors (optional)">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input">
              <option value="">none - fresh workspace</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Task" hint="what Claude should do each run">
            <textarea
              required
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. refresh the operating manual from the latest code and report what changed"
              className="input h-24"
            />
          </Field>
        </div>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !task.trim() || !cron.trim()}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}
