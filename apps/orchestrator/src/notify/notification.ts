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
 * Map a domain event to a push notification, or `null` if the event is not
 * worth notifying about. `publicUrl`, when set, enables deep links and
 * approve/reject action buttons that the phone can reach over the tailnet.
 */
export function buildNotification(event: LumpyEvent, publicUrl: string): Notification | null {
  if (event.type === 'session.activity' && event.activity === 'awaiting_permission') {
    const actions: NtfyAction[] = publicUrl
      ? [
          inputAction('Approve', publicUrl, event.id, '\r'),
          inputAction('Reject', publicUrl, event.id, '\x1b'),
        ]
      : [];
    return {
      title: `${event.name} needs you`,
      message: 'A session is awaiting permission to proceed.',
      priority: 4,
      tags: ['warning'],
      click: publicUrl ? `${publicUrl}/sessions` : undefined,
      actions,
    };
  }

  if (event.type === 'fleet.server.status' && event.status === 'offline') {
    return {
      title: `${event.name} is offline`,
      message: 'No heartbeat received within the expected window.',
      priority: 4,
      tags: ['rotating_light'],
      click: publicUrl ? `${publicUrl}/fleet` : undefined,
    };
  }

  return null;
}

function inputAction(
  label: string,
  publicUrl: string,
  sessionId: string,
  data: string,
): NtfyAction {
  return {
    action: 'http',
    label,
    url: `${publicUrl}/api/sessions/${sessionId}/input`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
    clear: true,
  };
}
