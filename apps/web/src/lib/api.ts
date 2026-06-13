import type { CreateSessionInput, HealthResponse, Session } from '@lumpy/shared';

export const ORCHESTRATOR_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://127.0.0.1:4317';

function socketUrl(pathname: string): string {
  const url = new URL(ORCHESTRATOR_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = pathname;
  return url.toString();
}

export function sessionSocketUrl(id: string): string {
  return socketUrl(`/ws/session/${id}`);
}

export function eventsSocketUrl(): string {
  return socketUrl('/ws/sessions');
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${ORCHESTRATOR_URL}/api/health`).then(parse<HealthResponse>),
  listSessions: () => fetch(`${ORCHESTRATOR_URL}/api/sessions`).then(parse<Session[]>),
  createSession: (input: CreateSessionInput) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then(parse<Session>),
  stopSession: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions/${id}/stop`, { method: 'POST' }),
  sendInput: (id: string, data: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions/${id}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }),
};
