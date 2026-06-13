import type {
  Alert,
  CreateServerInput,
  CreateSessionInput,
  HealthResponse,
  Server,
  ServerDetail,
  Session,
} from '@lumpy/shared';

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

export function fleetSocketUrl(): string {
  return socketUrl('/ws/fleet');
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
  restartSession: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions/${id}/restart`, { method: 'POST' }).then(
      parse<Session>,
    ),
  resumeSession: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions/${id}/resume`, { method: 'POST' }).then(parse<Session>),
  deleteSession: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions/${id}`, { method: 'DELETE' }),
  sendInput: (id: string, data: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/sessions/${id}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }),

  listServers: () => fetch(`${ORCHESTRATOR_URL}/api/fleet/servers`).then(parse<Server[]>),
  getServer: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/fleet/servers/${id}`).then(parse<ServerDetail>),
  createServer: (input: CreateServerInput) =>
    fetch(`${ORCHESTRATOR_URL}/api/fleet/servers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then(parse<Server>),
  renameServer: (id: string, name: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/fleet/servers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(parse<ServerDetail>),
  deleteServer: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/fleet/servers/${id}`, { method: 'DELETE' }),

  listAlerts: () => fetch(`${ORCHESTRATOR_URL}/api/alerts`).then(parse<Alert[]>),
  dismissAlert: (id: string) =>
    fetch(`${ORCHESTRATOR_URL}/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
