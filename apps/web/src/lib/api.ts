import type {
  ActivityEntry,
  Alert,
  AuthState,
  ConsultVerdict,
  CreateProjectInput,
  CreateServerInput,
  CreateSessionInput,
  FleetMounts,
  FleetNodeKind,
  HealthResponse,
  HostedIncident,
  KnowledgeBase,
  PendingRemediation,
  Playbook,
  Project,
  RepoSyncResult,
  RepoSyncStatus,
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

/**
 * The orchestrator base URL. An explicit absolute NEXT_PUBLIC_ORCHESTRATOR_URL
 * always wins (build-time override). Otherwise it is derived at RUNTIME from the
 * page's own host - the orchestrator is reached on the same host as the web UI,
 * at NEXT_PUBLIC_ORCHESTRATOR_PORT (default 4317). Deriving at runtime means a
 * Tailscale IP change or a switch to a MagicDNS name does not strand the client
 * the way a build-time-baked IP would. SSR (no window) uses a local fallback;
 * all real calls run in the browser after hydration.
 */
function resolveOrchestratorUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  if (explicit && /^https?:\/\//.test(explicit)) return explicit.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const port = process.env.NEXT_PUBLIC_ORCHESTRATOR_PORT || '4317';
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return 'http://127.0.0.1:4317';
}

export const ORCHESTRATOR_URL = resolveOrchestratorUrl();

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

export function alertsSocketUrl(): string {
  return socketUrl('/ws/alerts');
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

/** For mutations with no body to parse: throw the server's error on a non-2xx so a
 *  failed action can't silently look successful (the global toast surfaces it). */
async function ok(response: Response): Promise<void> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? response.statusText);
  }
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
  stopSession: (id: string) => send(`/api/sessions/${id}/stop`, 'POST').then(ok),
  restartSession: (id: string) =>
    send(`/api/sessions/${id}/restart`, 'POST').then(parse<Session>),
  resumeSession: (id: string) =>
    send(`/api/sessions/${id}/resume`, 'POST').then(parse<Session>),
  deleteSession: (id: string) => send(`/api/sessions/${id}`, 'DELETE').then(ok),
  sendInput: (id: string, data: string) =>
    send(`/api/sessions/${id}/input`, 'POST', { data }).then(ok),

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
  deleteServer: (id: string) => send(`/api/fleet/servers/${id}`, 'DELETE').then(ok),

  listAlerts: () => req('/api/alerts').then(parse<Alert[]>),
  listActivity: () => req('/api/activity').then(parse<ActivityEntry[]>),
  getRepoSync: () => req('/api/reposync').then(parse<RepoSyncStatus>),
  runRepoSync: () => send('/api/reposync/run', 'POST').then(parse<{ results: RepoSyncResult[] }>),
  dismissAlert: (id: string) =>
    send(`/api/alerts/${encodeURIComponent(id)}`, 'DELETE').then(ok),

  listPendingRemediations: () => req('/api/remediation').then(parse<PendingRemediation[]>),
  approveRemediation: (alertId: string) =>
    send(`/api/remediation/${encodeURIComponent(alertId)}/approve`, 'POST').then(ok),
  dismissRemediation: (alertId: string) =>
    send(`/api/remediation/${encodeURIComponent(alertId)}`, 'DELETE').then(ok),

  listModules: () => req('/api/modules').then(parse<ModuleInfo[]>),
  listPlaybooks: () => req('/api/playbooks').then(parse<Playbook[]>),
  getSettings: () => req('/api/settings').then(parse<SettingsResponse>),
  updateSettings: (patch: {
    remediationMode?: string;
    remediationAutoSeverities?: string[];
    secondOpinionMode?: string;
    supabaseToken?: string;
    vercelToken?: string;
    githubToken?: string;
    openaiToken?: string;
  }) =>
    send('/api/settings', 'PATCH', patch).then(parse<SettingsResponse>),
  secondOpinion: (input: { prompt: string; subject?: string }) =>
    send('/api/secondopinion', 'POST', input).then(parse<ConsultVerdict>),

  listProjects: () => req('/api/projects').then(parse<Project[]>),
  getProject: (id: string) => req(`/api/projects/${id}`).then(parse<Project>),
  createProject: (input: CreateProjectInput) =>
    send('/api/projects', 'POST', input).then(parse<Project>),
  updateProject: (id: string, patch: UpdateProjectInput) =>
    send(`/api/projects/${id}`, 'PATCH', patch).then(parse<Project>),
  deleteProject: (id: string) => send(`/api/projects/${id}`, 'DELETE').then(ok),
  getKnowledge: (id: string) =>
    req(`/api/projects/${id}/knowledge`).then(parse<KnowledgeBase>),
  putKnowledge: (id: string, claudeMd: string) =>
    send(`/api/projects/${id}/knowledge`, 'PUT', { claudeMd }).then(parse<KnowledgeBase>),
  deriveKnowledge: (id: string) =>
    send(`/api/projects/${id}/derive`, 'POST').then(parse<{ sessionId: string }>),
  approveKnowledge: (id: string) =>
    send(`/api/projects/${id}/knowledge/approve`, 'POST').then(parse<KnowledgeBase>),
  discardKnowledge: (id: string) => send(`/api/projects/${id}/knowledge/discard`, 'POST').then(ok),

  listServices: () => req('/api/services').then(parse<Service[]>),
  createService: (input: CreateServiceInput) =>
    send('/api/services', 'POST', input).then(parse<Service>),
  updateService: (id: string, patch: UpdateServiceInput) =>
    send(`/api/services/${id}`, 'PATCH', patch).then(parse<Service>),
  deleteService: (id: string) => send(`/api/services/${id}`, 'DELETE').then(ok),
  deployService: (id: string) =>
    send(`/api/services/${id}/deploy`, 'POST').then(parse<{ sessionId: string }>),

  listSchedules: () => req('/api/schedules').then(parse<Schedule[]>),
  createSchedule: (input: CreateScheduleInput) =>
    send('/api/schedules', 'POST', input).then(parse<Schedule>),
  updateSchedule: (id: string, patch: UpdateScheduleInput) =>
    send(`/api/schedules/${id}`, 'PATCH', patch).then(parse<Schedule>),
  deleteSchedule: (id: string) => send(`/api/schedules/${id}`, 'DELETE').then(ok),
  runSchedule: (id: string) =>
    send(`/api/schedules/${id}/run`, 'POST').then(parse<{ sessionId: string | null }>),

  getConnectors: (id: string) =>
    req(`/api/sessions/${id}/connectors`).then(parse<SessionConnectorsView>),
  updateConnectors: (id: string, input: UpdateConnectorsInput) =>
    send(`/api/sessions/${id}/connectors`, 'PATCH', input).then(parse<SessionConnectorsView>),

  authMe: () => req('/api/auth/me').then(parse<AuthState>),
  authLoginUrl: () => `${ORCHESTRATOR_URL}/api/auth/github/login`,
  authLogout: () => send('/api/auth/logout', 'POST').then(ok),
};
