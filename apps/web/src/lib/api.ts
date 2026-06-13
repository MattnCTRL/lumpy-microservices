import type {
  Alert,
  AuthState,
  CreateProjectInput,
  CreateServerInput,
  CreateSessionInput,
  FleetMounts,
  FleetNodeKind,
  HealthResponse,
  KnowledgeBase,
  Playbook,
  Project,
  Server,
  ServerDetail,
  Session,
  SessionConnectorsView,
  SettingsResponse,
  TailnetDevice,
  UpdateConnectorsInput,
  UpdateProjectInput,
} from '@lumpy/shared';

export interface ModuleInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
}

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

// Every request carries cookies so the signed-in session is recognized even
// though the web (:3000) and orchestrator (:4317) are different origins.
function req(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ORCHESTRATOR_URL}${path}`, { credentials: 'include', ...init });
}

function send(path: string, method: string, body?: unknown): Promise<Response> {
  return req(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

export const api = {
  health: () => req('/api/health').then(parse<HealthResponse>),
  listSessions: () => req('/api/sessions').then(parse<Session[]>),
  createSession: (input: CreateSessionInput) =>
    send('/api/sessions', 'POST', input).then(parse<Session>),
  stopSession: (id: string) => send(`/api/sessions/${id}/stop`, 'POST'),
  restartSession: (id: string) =>
    send(`/api/sessions/${id}/restart`, 'POST').then(parse<Session>),
  resumeSession: (id: string) =>
    send(`/api/sessions/${id}/resume`, 'POST').then(parse<Session>),
  deleteSession: (id: string) => send(`/api/sessions/${id}`, 'DELETE'),
  sendInput: (id: string, data: string) => send(`/api/sessions/${id}/input`, 'POST', { data }),

  listServers: () => req('/api/fleet/servers').then(parse<Server[]>),
  discoverDevices: () => req('/api/fleet/discover').then(parse<TailnetDevice[]>),
  getMounts: () => req('/api/fleet/mounts').then(parse<FleetMounts>),
  getServer: (id: string) => req(`/api/fleet/servers/${id}`).then(parse<ServerDetail>),
  createServer: (input: CreateServerInput) =>
    send('/api/fleet/servers', 'POST', input).then(parse<Server>),
  renameServer: (id: string, name: string) =>
    send(`/api/fleet/servers/${id}`, 'PATCH', { name }).then(parse<ServerDetail>),
  setServerKind: (id: string, kind: FleetNodeKind) =>
    send(`/api/fleet/servers/${id}`, 'PATCH', { kind }).then(parse<ServerDetail>),
  deleteServer: (id: string) => send(`/api/fleet/servers/${id}`, 'DELETE'),

  listAlerts: () => req('/api/alerts').then(parse<Alert[]>),
  dismissAlert: (id: string) =>
    send(`/api/alerts/${encodeURIComponent(id)}`, 'DELETE'),

  listModules: () => req('/api/modules').then(parse<ModuleInfo[]>),
  listPlaybooks: () => req('/api/playbooks').then(parse<Playbook[]>),
  getSettings: () => req('/api/settings').then(parse<SettingsResponse>),
  updateSettings: (patch: { remediationMode?: string; remediationAutoSeverities?: string[] }) =>
    send('/api/settings', 'PATCH', patch).then(parse<SettingsResponse>),

  listProjects: () => req('/api/projects').then(parse<Project[]>),
  getProject: (id: string) => req(`/api/projects/${id}`).then(parse<Project>),
  createProject: (input: CreateProjectInput) =>
    send('/api/projects', 'POST', input).then(parse<Project>),
  updateProject: (id: string, patch: UpdateProjectInput) =>
    send(`/api/projects/${id}`, 'PATCH', patch).then(parse<Project>),
  deleteProject: (id: string) => send(`/api/projects/${id}`, 'DELETE'),
  getKnowledge: (id: string) =>
    req(`/api/projects/${id}/knowledge`).then(parse<KnowledgeBase>),
  putKnowledge: (id: string, claudeMd: string) =>
    send(`/api/projects/${id}/knowledge`, 'PUT', { claudeMd }).then(parse<KnowledgeBase>),
  deriveKnowledge: (id: string) =>
    send(`/api/projects/${id}/derive`, 'POST').then(parse<{ sessionId: string }>),
  approveKnowledge: (id: string) =>
    send(`/api/projects/${id}/knowledge/approve`, 'POST').then(parse<KnowledgeBase>),
  discardKnowledge: (id: string) => send(`/api/projects/${id}/knowledge/discard`, 'POST'),

  getConnectors: (id: string) =>
    req(`/api/sessions/${id}/connectors`).then(parse<SessionConnectorsView>),
  updateConnectors: (id: string, input: UpdateConnectorsInput) =>
    send(`/api/sessions/${id}/connectors`, 'PATCH', input).then(parse<SessionConnectorsView>),

  authMe: () => req('/api/auth/me').then(parse<AuthState>),
  authLoginUrl: () => `${ORCHESTRATOR_URL}/api/auth/github/login`,
  authLogout: () => send('/api/auth/logout', 'POST'),
};
