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

/** Where a project's knowledge base is derived from — the full picture. */
export interface ProjectSources {
  /** Git repo (url or path) to ingest. */
  repo: string | null;
  /** Fleet node id whose local files to read over SSHFS (this Mac, Atlas, …). */
  machineId: string | null;
  /** Paths on that machine to ingest. */
  sourcePaths: string[];
  /** Also review connected data sources (Supabase, TensorGarden, …). */
  useConnectors: boolean;
}

/**
 * A first-class project: a governed workspace on the box. Its operating manual
 * (CLAUDE.md + .lumpy/knowledge) governs every Claude session launched in it,
 * and is derived from the project's cumulative sources.
 */
export interface Project {
  id: string;
  name: string;
  slug: string;
  workspace: string;
  description: string | null;
  sources: ProjectSources;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  workspace?: string;
  description?: string;
  sources?: Partial<ProjectSources>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  sources?: Partial<ProjectSources>;
}

/** A project's operating manual: the governing CLAUDE.md, supporting docs, and any pending draft. */
export interface KnowledgeBase {
  claudeMd: string;
  docs: { name: string; content: string }[];
  /** A librarian-proposed manual awaiting approval, or null. */
  draft: string | null;
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
 * maps to. Secret values are never returned to clients — see the View type.
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
  system: {
    version: string;
    sessionUser: string | null;
    workspaceRoot: string;
    publicUrl: string | null;
    defaultCommand: string;
    notifications: { configured: boolean; topic: string | null; server: string };
  };
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
 * tablet that can't run an agent — tracked by Tailscale presence only. Presented
 * and reasoned about separately.
 */
export type FleetNodeKind = 'server' | 'machine' | 'remote';

/** `unknown` = registered but never reported; `offline` = heartbeat went stale. */
export type ServerStatus = 'online' | 'offline' | 'unknown';

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
  | { type: 'fleet.server.status'; id: string; name: string; status: ServerStatus; at: string }
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
    };
