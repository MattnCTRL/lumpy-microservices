import type {
  Alert,
  AuthState,
  CreateProjectInput,
  CreateServerInput,
  CreateSessionInput,
  FleetMounts,
  FleetNodeKind,
  HealthResponse,
  HostedIncident,
  KnowledgeBase,
  Playbook,
  Project,
  Schedule,
  CreateScheduleInput,
  UpdateScheduleInput,
  Server,
  ServerDetail,
  Service,
  CreateServiceInput,
  UpdateServiceInput,
  Session,
  SessionConnectorsView,
  SettingsResponse,
  SshConnectionInput,
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
  listIncidents: () => req('/api/fleet/incidents').then(parse<HostedIncident[]>),
  discoverDevices: () => req('/api/fleet/discover').then(parse<TailnetDevice[]>),
  getMounts: () => req('/api/fleet/mounts').then(parse<FleetMounts>),
  getServer: (id: string) => req(`/api/fleet/servers/${id}`).then(parse<ServerDetail>),
  createServer: (input: CreateServerInput) =>
    send('/api/fleet/servers', 'POST', input).then(parse<Server>),
  renameServer: (id: string, name: string) =>
    send(`/api/fleet/servers/${id}`, 'PATCH', { name }).then(parse<ServerDetail>),
  setServerKind: (id: string, kind: FleetNodeKind) =>
    send(`/api/fleet/servers/${id}`, 'PATCH', { kind }).then(parse<ServerDetail>),
  configureServerSsh: (id: string, ssh: SshConnectionInput) =>
    send(`/api/fleet/servers/${id}/ssh`, 'POST', ssh).then(parse<ServerDetail>),
  deleteServer: (id: string) => send(`/api/fleet/servers/${id}`, 'DELETE'),

  listAlerts: () => req('/api/alerts').then(parse<Alert[]>),
  dismissAlert: (id: string) =>
    send(`/api/alerts/${encodeURIComponent(id)}`, 'DELETE'),

  listModules: () => req('/api/modules').then(parse<ModuleInfo[]>),
  listPlaybooks: () => req('/api/playbooks').then(parse<Playbook[]>),
  getSettings: () => req('/api/settings').then(parse<SettingsResponse>),
  updateSettings: (patch: {
    remediationMode?: string;
    remediationAutoSeverities?: string[];
    supabaseToken?: string;
  }) =>
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

  listServices: () => req('/api/services').then(parse<Service[]>),
  createService: (input: CreateServiceInput) =>
    send('/api/services', 'POST', input).then(parse<Service>),
  updateService: (id: string, patch: UpdateServiceInput) =>
    send(`/api/services/${id}`, 'PATCH', patch).then(parse<Service>),
  deleteService: (id: string) => send(`/api/services/${id}`, 'DELETE'),
  deployService: (id: string) =>
    send(`/api/services/${id}/deploy`, 'POST').then(parse<{ sessionId: string }>),

  listSchedules: () => req('/api/schedules').then(parse<Schedule[]>),
  createSchedule: (input: CreateScheduleInput) =>
    send('/api/schedules', 'POST', input).then(parse<Schedule>),
  updateSchedule: (id: string, patch: UpdateScheduleInput) =>
    send(`/api/schedules/${id}`, 'PATCH', patch).then(parse<Schedule>),
  deleteSchedule: (id: string) => send(`/api/schedules/${id}`, 'DELETE'),
  runSchedule: (id: string) =>
    send(`/api/schedules/${id}/run`, 'POST').then(parse<{ sessionId: string | null }>),

  getConnectors: (id: string) =>
    req(`/api/sessions/${id}/connectors`).then(parse<SessionConnectorsView>),
  updateConnectors: (id: string, input: UpdateConnectorsInput) =>
    send(`/api/sessions/${id}/connectors`, 'PATCH', input).then(parse<SessionConnectorsView>),

  authMe: () => req('/api/auth/me').then(parse<AuthState>),
  authLoginUrl: () => `${ORCHESTRATOR_URL}/api/auth/github/login`,
  authLogout: () => send('/api/auth/logout', 'POST'),
};
