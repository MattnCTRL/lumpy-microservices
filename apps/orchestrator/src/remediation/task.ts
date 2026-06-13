import type { Alert } from '@lumpy/shared';

export type RemediationMode = 'investigate' | 'auto';

/** Build the task prompt for a Claude session spun up to handle an alert. */
export function buildRemediationTask(alert: Alert, mode: RemediationMode): string {
  const context =
    `A Lumpy monitoring alert fired on server "${alert.serverName}" ` +
    `(severity: ${alert.severity}).\n` +
    `Alert: ${alert.message}\n\n`;

  if (mode === 'auto') {
    return (
      context +
      'Investigate the cause on this host and remediate it if you are confident the fix is ' +
      'safe and non-destructive. Never delete data or take risky/irreversible actions — if the ' +
      'fix would require that, stop and report instead. When finished, summarize what you found ' +
      'and exactly what you changed.'
    );
  }

  return (
    context +
    'Investigate the likely cause on this host. Do NOT make any changes — produce a concise ' +
    'diagnosis and a recommended fix only.'
  );
}
