'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Alert } from '@lumpy/shared';
import { api, ORCHESTRATOR_URL } from '@/lib/api';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAlerts(await api.listAlerts());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'orchestrator unreachable');
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
          {error} — is the orchestrator running on {ORCHESTRATOR_URL}?
        </div>
      )}

      <h2 className="mb-3 text-sm font-medium text-neutral-300">
        Active alerts {alerts.length > 0 && `(${alerts.length})`}
      </h2>

      {alerts.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-neutral-500">
          All clear — no active alerts.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
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
                    onClick={async () => {
                      await api.dismissAlert(alert.id);
                      void refresh();
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
