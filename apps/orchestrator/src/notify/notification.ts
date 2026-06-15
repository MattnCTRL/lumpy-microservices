import type { LumpyEvent } from '@lumpy/shared';

export interface NtfyAction {
  action: 'http' | 'view';
  label: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  clear?: boolean;
}

export interface Notification {
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click?: string;
  actions?: NtfyAction[];
}

/**
 * Map a domain event to a push notification, or `null` if the event is not worth
 * notifying about.
 *
 * Two distinct bases, because a single URL cannot serve both: `apiUrl` is the
 * orchestrator (action POSTs like approve/input must reach it), while `webUrl` is
 * the PWA (click deep links like /alerts must open it). When `webUrl` is omitted
 * it falls back to `apiUrl` (single-origin / reverse-proxy deployments).
 */
export function buildNotification(
  event: LumpyEvent,
  apiUrl: string,
  webUrl: string = apiUrl,
): Notification | null {
  const link = (path: string): string | undefined => (webUrl ? `${webUrl}${path}` : undefined);

  if (event.type === 'session.activity' && event.activity === 'awaiting_permission') {
    const actions: NtfyAction[] = apiUrl
      ? [
          inputAction('Approve', apiUrl, event.id, '\r'),
          inputAction('Reject', apiUrl, event.id, '\x1b'),
        ]
      : [];
    return {
      title: `${event.name} needs you`,
      message: event.prompt?.question ?? 'A session is awaiting permission to proceed.',
      priority: 4,
      tags: ['warning'],
      click: link('/sessions'),
      actions,
    };
  }

  if (event.type === 'alert.fired') {
    const alert = event.alert;
    return {
      title: `${alert.serverName} - ${alert.label}`,
      message: alert.message,
      priority: alert.severity === 'critical' ? 5 : 3,
      tags: alert.severity === 'critical' ? ['rotating_light'] : ['warning'],
      click: link('/alerts'),
    };
  }

  if (event.type === 'remediation.pending') {
    const actions: NtfyAction[] = apiUrl
      ? [
          {
            action: 'http',
            label: 'Approve fix',
            url: `${apiUrl}/api/remediation/${event.alertId}/approve`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            clear: true,
          },
        ]
      : [];
    return {
      title: `${event.serverName} - approve remediation?`,
      message: `${event.label} (${event.severity}). Approve to let Claude investigate and fix.`,
      priority: 4,
      tags: ['warning'],
      click: link('/alerts'),
      actions,
    };
  }

  if (event.type === 'remediation.started') {
    return {
      title: `${event.serverName} - ${event.mode === 'auto' ? 'auto-remediating' : 'investigating'}`,
      message: 'Lumpy started an autonomous Claude session to handle the alert.',
      priority: 3,
      tags: ['robot'],
      click: link('/sessions'),
    };
  }

  if (event.type === 'alert.resolved') {
    return {
      title: `${event.serverName} - resolved`,
      message: `${event.label} cleared`,
      priority: 2,
      tags: ['white_check_mark'],
      click: link('/alerts'),
    };
  }

  if (event.type === 'hosted.status') {
    const down = event.status === 'down';
    return {
      title: `${event.name} - ${down ? 'DOWN' : 'recovered'}`,
      message: down
        ? `${event.url} is not responding${event.statusCode ? ` (HTTP ${event.statusCode})` : ''}.`
        : `${event.url} is back up.`,
      priority: down ? 5 : 2,
      tags: down ? ['rotating_light'] : ['white_check_mark'],
      click: link('/fleet'),
    };
  }

  if (event.type === 'hosted.cert') {
    return {
      title: `${event.name} - TLS cert expiring`,
      message: `Certificate for ${event.url} expires in ${event.daysLeft} day${event.daysLeft === 1 ? '' : 's'}.`,
      priority: 4,
      tags: ['warning'],
      click: link('/fleet'),
    };
  }

  if (event.type === 'digest') {
    return {
      title: event.title,
      message: event.message,
      priority: event.priority,
      tags: ['bar_chart'],
      click: link('/'),
    };
  }

  // Only push when Codex actually blocked an auto-action - that's the moment the
  // owner needs to know about. Advisory/approved consults stay in the feed.
  if (event.type === 'secondopinion' && !event.proceeded) {
    return {
      title: `Codex held an auto-action - ${event.subject}`,
      message: event.summary,
      priority: 4,
      tags: ['no_entry'],
      click: link('/alerts'),
    };
  }

  return null;
}

function inputAction(label: string, apiUrl: string, sessionId: string, data: string): NtfyAction {
  return {
    action: 'http',
    label,
    url: `${apiUrl}/api/sessions/${sessionId}/input`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
    clear: true,
  };
}
