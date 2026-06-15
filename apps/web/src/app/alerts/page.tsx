'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Alert, ConsultVerdict, PendingRemediation } from '@lumpy/shared';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pending, setPending] = useState<PendingRemediation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAlerts(await api.listAlerts());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'orchestrator unreachable');
      return;
    }
    // Best-effort: a pending-remediation hiccup must not blank the alerts view.
    try {
      setPending(await api.listPendingRemediations());
    } catch {
      // leave the prior pending list in place
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="h-full overflow-y-auto p-4">
      {error && (
        <div className="mb-3 rounded bg-red-950/60 px-4 py-2 text-sm text-red-300">
          {error} - is the orchestrator running on {ORCHESTRATOR_URL}?
        </div>
      )}

      {pending.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 text-sm font-medium text-amber-300">
            Awaiting your approval ({pending.length})
          </h2>
          <ul className="space-y-2">
            {pending.map((p) => (
              <PendingItem key={p.alertId} pending={p} onChange={() => void refresh()} />
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-3 text-sm font-medium text-neutral-300">
        Active alerts {alerts.length > 0 && `(${alerts.length})`}
      </h2>

      {alerts.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-neutral-500">
          All clear - no active alerts.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <AlertItem key={alert.id} alert={alert} onDismiss={() => void refresh()} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingItem({
  pending,
  onChange,
}: {
  pending: PendingRemediation;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'dismiss'>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (kind: 'approve' | 'dismiss') => {
    setBusy(kind);
    setErr(null);
    try {
      const res =
        kind === 'approve'
          ? await api.approveRemediation(pending.alertId)
          : await api.dismissRemediation(pending.alertId);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? res.statusText);
      }
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
      setBusy(null);
    }
  };

  return (
    <li className="rounded-lg border border-amber-900/50 bg-amber-950/10 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-neutral-100">{pending.serverName}</div>
          <div className="truncate text-sm text-neutral-300">
            {pending.label} ({pending.severity})
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void run('approve')}
            disabled={busy !== null}
            className="rounded-md bg-emerald-600/90 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy === 'approve' ? 'approving…' : 'Approve fix'}
          </button>
          <button
            onClick={() => void run('dismiss')}
            disabled={busy !== null}
            className="text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-50"
          >
            {busy === 'dismiss' ? 'dismissing…' : 'dismiss'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        held since {new Date(pending.createdAt).toLocaleTimeString()}
      </p>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </li>
  );
}

function AlertItem({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const [verdict, setVerdict] = useState<ConsultVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [consultError, setConsultError] = useState<string | null>(null);

  const consult = async () => {
    setBusy(true);
    setConsultError(null);
    try {
      const v = await api.secondOpinion({
        subject: `${alert.serverName}: ${alert.label}`,
        prompt: [
          `An alert is firing on the server "${alert.serverName}".`,
          `Alert: ${alert.label} (severity: ${alert.severity}).`,
          `Details: ${alert.message}`,
          '',
          'What is the most likely cause, and what is the safest next step? Is this safe to remediate automatically without a human in the loop?',
        ].join('\n'),
      });
      setVerdict(v);
    } catch (e) {
      setConsultError(e instanceof Error ? e.message : 'consult failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-lg border px-4 py-3 ${
        alert.severity === 'critical'
          ? 'border-red-900/60 bg-red-950/20'
          : 'border-amber-900/50 bg-amber-950/10'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-neutral-100">{alert.serverName}</span>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              alert.severity === 'critical'
                ? 'bg-red-500/20 text-red-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {alert.severity}
          </span>
          <button
            onClick={() => void consult()}
            disabled={busy}
            className="text-xs text-neutral-400 hover:text-neutral-100 disabled:opacity-50"
          >
            {busy ? 'asking Codex…' : 'second opinion'}
          </button>
          <button
            onClick={async () => {
              await api.dismissAlert(alert.id);
              onDismiss();
            }}
            className="text-xs text-neutral-500 hover:text-neutral-200"
          >
            dismiss
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-neutral-300">{alert.message}</p>
      <p className="mt-1 text-xs text-neutral-500">
        since {new Date(alert.firedAt).toLocaleTimeString()}
      </p>

      {consultError && <p className="mt-2 text-xs text-red-400">{consultError}</p>}
      {verdict && <VerdictCard verdict={verdict} />}
    </li>
  );
}

function VerdictCard({ verdict }: { verdict: ConsultVerdict }) {
  const tone =
    verdict.verdict === 'reject'
      ? 'border-red-900/60 text-red-300'
      : verdict.verdict === 'concern'
        ? 'border-amber-900/60 text-amber-300'
        : 'border-emerald-900/60 text-emerald-300';
  return (
    <div className={`mt-3 rounded-md border bg-neutral-950/60 p-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide">Codex: {verdict.verdict}</span>
        {verdict.confidence > 0 && (
          <span className="text-[10px] text-neutral-500">{verdict.confidence}% confidence</span>
        )}
      </div>
      <p className="mt-1 text-sm text-neutral-200">{verdict.summary}</p>
      {verdict.concerns.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Concerns</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-neutral-300">
            {verdict.concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {verdict.suggestions.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Suggestions
          </p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-neutral-300">
            {verdict.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
