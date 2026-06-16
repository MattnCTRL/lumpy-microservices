export type SessionStatus = 'running' | 'stopped';

/**
 * Inferred from the session's terminal stream. `working` = actively producing
 * output, `awaiting_permission` = a prompt is asking the operator to approve an
 * action, `idle` = quiet and waiting, `unknown` = not yet determined.
 */
export type SessionActivity = 'working' | 'awaiting_permission' | 'idle' | 'unknown';

/** A selectable answer in a session prompt; `key` is the keystroke to send. */
export interface SessionPromptOption {
  key: string;
  label: string;
}

/**
 * A best-effort, human-readable view of the question a session is currently
 * asking, extracted from its terminal stream so the UI can show it without the
 * operator reading raw TTY output.
 */
export interface SessionPrompt {
  question: string;
  options: SessionPromptOption[];
}

export interface Session {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  status: SessionStatus;
  activity: SessionActivity;
  /** The project this session belongs to, if any. */
  projectId: string | null;
  /** Locked sessions (the Conductor) cannot be stopped or removed. */
  locked: boolean;
  /** The current prompt when awaiting_permission, else null. Best-effort. */
  prompt: SessionPrompt | null;
  /** When true, Claude runs with permissions auto-approved (autonomous). */
  autonomous: boolean;
  /** Optional task the session was started with. */
  task: string | null;
  /**
   * What this session IS, for the UI split:
   * - 'conductor': the locked master orchestrator (persistent, interactive)
   * - 'task': a headless one-shot job (librarian/remediation/scheduled/service or
   *   any autonomous session with a task) - runs to completion then auto-retires
   * - 'session': a plain interactive session you drive
   */
  kind: 'conductor' | 'task' | 'session';
  /** For a finished task: ms since it stopped (drives the auto-retire), else null. */
  doneForMs: number | null;
  createdAt: string;
  lastActivityAt: string | null;
}

export interface CreateSessionInput {
  name: string;
  workspace?: string;
  command?: string;
  tags?: string[];
  /** Default true: Claude executes without pausing for permission. */
  autonomous?: boolean;
  /** An initial task to start the session working on immediately. */
  task?: string;
  /** Launch the session inside this project (uses its workspace). */
  projectId?: string;
}

// --- Projects (governed workspaces with a knowledge base) ----------------

/** Where a project's knowledge base is derived from - the full picture. */
/** A database this project uses. A project may have several, each with a purpose. */
export interface ProjectDatabase {
  /** What this database is for, e.g. "main", "analytics", "game state". */
  label: string;
  /** Supabase project URL (https://<ref>.supabase.co), a postgres URL, or other. */
  url: string;
}

/** A live app/product this project runs (e.g. NubSec), optionally on a server. */
export interface HostedService {
  /** Display name, e.g. "NubSec". */
  name: string;
  /** Public URL, e.g. https://www.nublear.com. */
  url: string;
  /** Fleet server id it runs on, so the Fleet can list it under that machine. */
  serverId: string | null;
}

export interface ProjectSources {
  /** Git repos (urls or paths) to ingest - a project may span several. */
  repos: string[];
  /** Fleet node id whose local files to read over SSHFS (this Mac, Atlas, …). */
  machineId: string | null;
  /** Paths on that machine to ingest. */
  sourcePaths: string[];
  /** Fleet server ids this project runs on (cloud infra attribution + context). */
  serverIds: string[];
  /** Live apps/products this project hosts (surfaced on the Fleet by server). */
  hostedServices: HostedService[];
  /** Also review connected data sources (Supabase, TensorGarden, …). */
  useConnectors: boolean;
  /** This project's databases (Supabase scoped per-ref; others recorded). */
  databases: ProjectDatabase[];
}

/**
 * A first-class project: a governed workspace on the box. Its operating manual
 * (CLAUDE.md + .lumpy/knowledge) governs every Claude session launched in it,
 * and is derived from the project's cumulative sources.
 */
/**
 * `import` = an existing project: collect and analyze its sources first, then
 * move forward. `new` = built from scratch: scaffold the mapping/connectors to
 * save and distribute data going forward.
 */
export type ProjectOrigin = 'import' | 'new';

export interface Project {
  id: string;
  name: string;
  slug: string;
  workspace: string;
  description: string | null;
  origin: ProjectOrigin;
  sources: ProjectSources;
  /** Whether a Supabase access token is stored (the token itself is never returned). */
  supabaseConfigured: boolean;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  workspace?: string;
  description?: string;
  origin?: ProjectOrigin;
  sources?: Partial<ProjectSources>;
  /** Supabase access token (sbp_…) - stored encrypted, scoped to this project. */
  supabaseToken?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  sources?: Partial<ProjectSources>;
  supabaseToken?: string;
}

/** A project's operating manual: the governing CLAUDE.md, supporting docs, and any pending draft. */
export interface KnowledgeBase {
  claudeMd: string;
  docs: { name: string; content: string }[];
  /** A librarian-proposed manual awaiting approval, or null. */
  draft: string | null;
}

// --- Micro services (deployable, self-improving specialists) -------------

/** A recorded refinement to a service's definition after a run. */
export interface ServiceImprovement {
  at: string;
  note: string;
  version: number;
}

/**
 * A micro service: a specialist function that works directly for Lumpy (like a
 * subagent, but platform-level). It is deployed by spawning a session with its
 * instructions, and can be improved after each use.
 */
export interface Service {
  id: string;
  name: string;
  speciality: string;
  description: string | null;
  instructions: string;
  version: number;
  improvements: ServiceImprovement[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  name: string;
  speciality?: string;
  description?: string;
  instructions: string;
}

export interface UpdateServiceInput {
  name?: string;
  speciality?: string;
  description?: string | null;
  instructions?: string;
}

/** Record a refinement; optionally replace the instructions and bump the version. */
export interface ImproveServiceInput {
  note: string;
  instructions?: string;
}

// --- Scheduled tasks (recurring autonomous Claude jobs) -----------------

export type ScheduleRunStatus = 'ok' | 'error' | null;

export interface Schedule {
  id: string;
  name: string;
  /** 5-field cron expression, evaluated in UTC. */
  cron: string;
  /** The autonomous task prompt Claude runs each time. */
  task: string;
  /** Scope to a project's workspace + manual + connectors (optional). */
  projectId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastSessionId: string | null;
  lastStatus: ScheduleRunStatus;
  /** Next fire time (UTC ISO), computed from the cron expression. */
  nextRunAt: string | null;
  createdAt: string;
}

export interface CreateScheduleInput {
  name: string;
  cron: string;
  task: string;
  projectId?: string | null;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  cron?: string;
  task?: string;
  projectId?: string | null;
  enabled?: boolean;
}

// --- Repo Sync (GitHub-as-hub backup of the box's repos) ----------------

export interface RepoSyncResult {
  repo: string;
  /** 'pushed' = changes backed up, 'clean' = nothing to do, 'error' = failed, 'skipped' = no token/remote. */
  status: 'pushed' | 'clean' | 'error' | 'skipped';
  detail: string;
  at: string;
}

export interface RepoSyncStatus {
  configured: boolean;
  branch: string;
  lastRunAt: string | null;
  results: RepoSyncResult[];
}

// --- Activity feed (audit trail) ----------------------------------------

export interface ActivityEntry {
  id: string;
  /** Coarse category: session | alert | hosted | remediation | cert | digest. */
  kind: string;
  title: string;
  at: string;
}

// --- Session connectors (per-project data sources) ----------------------

/**
 * An MCP server declaration, written to the workspace's `.mcp.json`. Either a
 * local `stdio` server (command/args) or a remote `http` server (url). Values
 * may reference session env with ${VAR} so secrets stay out of the file.
 */
export interface McpServerDef {
  type?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * The connectors a session/project uses: secret env vars (injected into the
 * session at launch), MCP servers (Supabase, Vercel, …), and the GitHub repo it
 * maps to. Secret values are never returned to clients - see the View type.
 */
export interface SessionConnectors {
  env: Record<string, string>;
  mcpServers: Record<string, McpServerDef>;
  repo: string | null;
}

/** Client-facing view: env keys without their secret values. */
export interface SessionConnectorsView {
  envKeys: string[];
  mcpServers: Record<string, McpServerDef>;
  repo: string | null;
}

/** Partial update to a session's connectors. */
export interface UpdateConnectorsInput {
  setEnv?: Record<string, string>;
  removeEnv?: string[];
  mcpServers?: Record<string, McpServerDef>;
  repo?: string | null;
}

export type Role = 'admin' | 'viewer';

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  /** admin = full access; viewer = read-only. */
  role: Role;
}

export interface AuthState {
  configured: boolean;
  /** Whether sign-in is enforced (opt-in). When false the API is open. */
  required: boolean;
  user: GithubUser | null;
}

export interface SettingsResponse {
  remediation: {
    mode: 'off' | 'investigate' | 'auto';
    autoSeverities: string[];
  };
  /** Account-level integrations shared across projects. */
  integrations: {
    /** A Supabase Personal Access Token is stored (scoped per-project at launch). */
    supabaseConfigured: boolean;
    /** A Vercel Access Token is stored. */
    vercelConfigured: boolean;
    /** A GitHub token is stored (enables the box to push/pull + Repo Sync). */
    githubConfigured: boolean;
    /** An OpenAI API key is stored (powers Codex second-opinion consults). */
    codexConfigured: boolean;
  };
  /** Cross-model (Codex) second opinion on autonomous actions. */
  secondOpinion: {
    /**
     * off: never consult. advisory: consult and record, but never block.
     * enforce: hold an auto-action when Codex rejects it (falls back to one-tap approval).
     */
    mode: 'off' | 'advisory' | 'enforce';
    /** The Codex CLI is installed and reachable on the orchestrator host. */
    cliInstalled: boolean;
  };
  system: {
    version: string;
    sessionUser: string | null;
    workspaceRoot: string;
    publicUrl: string | null;
    defaultCommand: string;
    notifications: { configured: boolean; topic: string | null; server: string };
  };
}

/** A Codex second-opinion verdict (read-only, cross-model review). */
export interface ConsultVerdict {
  verdict: 'approve' | 'concern' | 'reject';
  /** 0-100 self-rated confidence. */
  confidence: number;
  summary: string;
  concerns: string[];
  suggestions: string[];
  /** True when Codex actually ran; false if skipped (no key / disabled / CLI missing). */
  available: boolean;
  /** Set when the consult could not complete (the gate then fails open). */
  error?: string;
}

export interface HealthResponse {
  status: 'ok';
  tmux: boolean;
  version: string;
  uptimeSeconds: number;
  /** Tailnet-reachable base URL agents should report to, if configured. */
  publicUrl: string;
  /** Default root (on the orchestrator host) under which session workspaces resolve. */
  workspaceRoot: string;
  /** Sessions currently running (attached brokers) - resource-pressure signal. */
  sessionCount: number;
  /** Orchestrator process resident set size, in MB. */
  rssMb: number;
  /** Deployment label (e.g. "box"); empty = unlabeled. */
  instance: string;
}

/** Control messages sent from client to server over the session WebSocket. */
export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

/**
 * Control messages sent from server to client over the session WebSocket.
 * Raw terminal output is sent as binary frames, not as one of these.
 */
export type ServerMessage =
  | { type: 'snapshot-end' }
  | { type: 'status'; status: SessionStatus }
  | { type: 'error'; message: string };

// --- Fleet ---------------------------------------------------------------

export type ServerEnv = 'prod' | 'staging' | 'dev';
export type ServerCriticality = 'low' | 'medium' | 'high';

/**
 * `server` = always-on infrastructure (cloud hosts, VPSes). `machine` = a
 * personal computer (laptop/desktop) that runs the agent. `remote` = a phone or
 * tablet that can't run an agent - tracked by Tailscale presence only. Presented
 * and reasoned about separately.
 */
export type FleetNodeKind = 'server' | 'machine' | 'remote';

/** `unknown` = registered but never reported; `offline` = heartbeat went stale. */
export type ServerStatus = 'online' | 'offline' | 'unknown';

export type HostedServiceStatus = 'up' | 'down' | 'unknown';

/** A hosted service resolved onto the server that runs it (with live status). */
export interface ServerHostedService {
  name: string;
  url: string;
  projectId: string;
  projectName: string;
  status: HostedServiceStatus;
  statusCode: number | null;
  checkedAt: string | null;
  /** Response latency of the last probe, in ms. */
  latencyMs: number | null;
  /** Uptime fraction over the last 24h (0-1), from recorded incidents. */
  uptime24h: number | null;
  /** Days until the TLS certificate expires (https only). */
  certDaysLeft: number | null;
  /** When the up/down status last changed. */
  lastChangeAt: string | null;
}

/** A continuous down period for a hosted service. */
export interface HostedIncident {
  id: string;
  url: string;
  name: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  resolvedAt: string | null;
  lastStatusCode: number | null;
}

export interface ServerMetrics {
  at: string;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  load1: number;
  uptimeSeconds: number;
}

/** How a server's metrics arrive: `ssh` = Lumpy polls it; `push` = an agent reports. */
export type MonitoringMode = 'ssh' | 'push';

export interface Server {
  id: string;
  name: string;
  address: string;
  kind: FleetNodeKind;
  tags: string[];
  env: ServerEnv;
  criticality: ServerCriticality;
  status: ServerStatus;
  monitoring: MonitoringMode;
  lastSeenAt: string | null;
  createdAt: string;
  metrics: ServerMetrics | null;
  /** Services hosted on this machine, resolved from projects (with live status). */
  hostedServices: ServerHostedService[];
  /** True for the always-on cloud box that runs Lumpy itself (the home host). */
  self: boolean;
}

/** SSH connection details for agentless monitoring. Never returned to clients. */
export interface SshConnectionInput {
  host: string;
  port?: number;
  user: string;
  privateKey?: string;
  password?: string;
}

export interface ServerDetail extends Server {
  history: ServerMetrics[];
}

export interface CreateServerInput {
  name: string;
  address: string;
  kind?: FleetNodeKind;
  tags?: string[];
  env?: ServerEnv;
  criticality?: ServerCriticality;
  /** When provided, Lumpy monitors the server agentlessly over SSH. */
  ssh?: SshConnectionInput;
  /** Reported by agents (os.platform()) so the kind can be inferred. */
  platform?: string;
}

/** Metrics payload posted by an agent; the orchestrator stamps `at`. */
export type MetricsReport = Omit<ServerMetrics, 'at'>;

/** SSHFS mount state for a machine: present on the orchestrator and responsive. */
export interface MountState {
  mounted: boolean;
  healthy: boolean;
}

/** Mount state keyed by server id. */
export type FleetMounts = Record<string, MountState>;

/** A device seen on the tailnet that is not yet in the fleet. */
export interface TailnetDevice {
  name: string;
  address: string;
  os: string;
  online: boolean;
  /** Suggested kind based on OS. */
  kind: FleetNodeKind;
}

// --- Alerts --------------------------------------------------------------

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  id: string;
  serverId: string;
  serverName: string;
  ruleId: string;
  label: string;
  severity: AlertSeverity;
  metric: string;
  value: number;
  message: string;
  firedAt: string;
}

/**
 * A remediation that is held awaiting the operator's one-tap approval (a severity
 * not in the auto policy, a playbook that requires approval, a Codex reject, or a
 * box at capacity). Persisted so an already-delivered push notification's approve
 * link still works after an orchestrator restart.
 */
export interface PendingRemediation {
  alertId: string;
  serverName: string;
  severity: AlertSeverity;
  label: string;
  createdAt: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  /** Alert rule ids this playbook responds to. */
  ruleIds: string[];
  /** When true, this playbook always needs approval regardless of severity policy. */
  requiresApproval: boolean;
  /** The instruction given to the remediation session. */
  task: string;
}

// --- Event spine ---------------------------------------------------------

/**
 * Events published on the orchestrator's event spine. Session events stream
 * over `/ws/sessions`; fleet events over `/ws/fleet`. New subsystems extend
 * this union as they land.
 */
export type LumpyEvent =
  | {
      type: 'session.activity';
      id: string;
      name: string;
      activity: SessionActivity;
      prompt: SessionPrompt | null;
      at: string;
    }
  | { type: 'session.status'; id: string; name: string; status: SessionStatus; at: string }
  | {
      type: 'fleet.server.status';
      id: string;
      name: string;
      kind: FleetNodeKind;
      status: ServerStatus;
      at: string;
    }
  | { type: 'fleet.metrics'; id: string; name: string; metrics: ServerMetrics; at: string }
  | { type: 'fleet.server.removed'; id: string; name: string; at: string }
  | { type: 'alert.fired'; alert: Alert; at: string }
  | { type: 'alert.resolved'; id: string; serverName: string; label: string; at: string }
  | {
      type: 'remediation.pending';
      alertId: string;
      serverName: string;
      severity: AlertSeverity;
      label: string;
      at: string;
    }
  | {
      type: 'remediation.started';
      alertId: string;
      sessionId: string;
      serverName: string;
      mode: 'investigate' | 'auto';
      at: string;
    }
  | {
      type: 'hosted.status';
      name: string;
      url: string;
      projectName: string;
      status: HostedServiceStatus;
      statusCode: number | null;
      at: string;
    }
  | {
      type: 'hosted.cert';
      name: string;
      url: string;
      projectName: string;
      daysLeft: number;
      at: string;
    }
  | { type: 'digest'; title: string; message: string; priority: number; at: string }
  | {
      type: 'secondopinion';
      /** Short label for the action that was reviewed. */
      subject: string;
      verdict: 'approve' | 'concern' | 'reject';
      summary: string;
      /** Whether the gate let the action proceed (false = held for approval). */
      proceeded: boolean;
      at: string;
    };
