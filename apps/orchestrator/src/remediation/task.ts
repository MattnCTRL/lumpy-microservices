import type { Alert } from '@lumpy/shared';

export type RemediationMode = 'investigate' | 'auto';

/**
 * Build the task prompt for a Claude session spun up to handle an alert.
 * `guidance` (from a matching playbook) replaces the generic instruction when
 * present; the mode still controls whether changes are permitted.
 */
export function buildRemediationTask(
  alert: Alert,
  mode: RemediationMode,
  guidance?: string,
): string {
  const context =
    `A Lumpy monitoring alert fired on server "${alert.serverName}" ` +
    `(severity: ${alert.severity}).\n` +
    `Alert: ${alert.message}\n\n`;

  const body =
    guidance?.trim() ||
    (mode === 'auto'
      ? 'Investigate the cause on this host and remediate it.'
      : 'Investigate the likely cause on this host.');

  const constraint =
    mode === 'auto'
      ? '\n\nYou may make safe, non-destructive changes; never delete data or take irreversible ' +
        'actions - if a fix would require that, stop and report instead. Summarize what you found ' +
        'and what you changed.'
      : '\n\nDo NOT make any changes - produce a concise diagnosis and a recommended fix only.';

  return context + body + constraint;
}
