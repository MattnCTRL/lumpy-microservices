'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Service } from '@lumpy/shared';
import { Field } from '@/components/Field';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setServices(await api.listServices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'orchestrator unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deploy = async (s: Service) => {
    setNote(null);
    try {
      await api.deployService(s.id);
      setNote(`Deployed "${s.name}" — running as a session.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'deploy failed');
    }
  };

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Micro Services</h1>
          <p className="text-xs text-neutral-500">
            Deployable specialist functions that work for Lumpy and improve after each use.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          New service
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {note && <p className="mb-3 text-sm text-emerald-400">{note}</p>}

      {services.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No services yet. Create one — a focused specialist (e.g. &quot;DB migration
          reviewer&quot;, &quot;dependency upgrader&quot;) that Lumpy can deploy on demand.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <div
              key={s.id}
              className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🧩</span>
                    <span className="truncate text-sm font-semibold text-neutral-100">{s.name}</span>
                    <span className="rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
                      v{s.version}
                    </span>
                  </div>
                  {s.speciality && (
                    <p className="mt-0.5 text-xs text-neutral-500">{s.speciality}</p>
                  )}
                </div>
              </div>
              {s.description && (
                <p className="mt-2 line-clamp-3 text-xs text-neutral-400">{s.description}</p>
              )}
              {s.improvements.length > 0 && (
                <p className="mt-2 text-xs text-indigo-400/80">
                  ✦ {s.improvements.length} self-improvement
                  {s.improvements.length > 1 ? 's' : ''}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 border-t border-neutral-800 pt-3">
                <button
                  onClick={() => void deploy(s)}
                  className="rounded-md bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-white"
                >
                  Deploy
                </button>
                <button
                  onClick={() => setEditing(s)}
                  className="rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  Edit
                </button>
                <button
                  onClick={async () => {
                    if (confirm(`Delete service "${s.name}"?`)) {
                      await api.deleteService(s.id);
                      void refresh();
                    }
                  }}
                  className="ml-auto text-xs text-neutral-500 hover:text-red-400"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ServiceDialog
          service={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ServiceDialog({
  service,
  onClose,
  onSaved,
}: {
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [speciality, setSpeciality] = useState(service?.speciality ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [instructions, setInstructions] = useState(service?.instructions ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (service) {
        await api.updateService(service.id, {
          name: name.trim(),
          speciality: speciality.trim(),
          description: description.trim() || null,
          instructions,
        });
      } else {
        await api.createService({
          name: name.trim(),
          speciality: speciality.trim() || undefined,
          description: description.trim() || undefined,
          instructions,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-950 p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-neutral-100">
          {service ? `Edit ${service.name}` : 'New micro service'}
        </h2>
        <div className="space-y-3">
          <Field label="Name">
            <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="DB migration reviewer" />
          </Field>
          <Field label="Speciality" hint="one line — its distinct function">
            <input value={speciality} onChange={(e) => setSpeciality(e.target.value)} className="input" placeholder="reviews SQL migrations for safety" />
          </Field>
          <Field label="Description" hint="optional">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" placeholder="what it's for" />
          </Field>
          <Field label="Instructions" hint="the prompt that defines what this service does when deployed">
            <textarea required value={instructions} onChange={(e) => setInstructions(e.target.value)} className="input h-40 font-mono text-xs" placeholder="You are a specialist that…" />
          </Field>
          {service && service.improvements.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-400">Self-improvements</p>
              <ul className="space-y-1 text-xs text-neutral-500">
                {service.improvements.map((imp, i) => (
                  <li key={i}>
                    <span className="text-indigo-400/80">v{imp.version}</span> — {imp.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !instructions.trim()}
            className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {submitting ? 'Saving…' : service ? 'Save' : 'Create service'}
          </button>
        </div>
      </form>
    </div>
  );
}
