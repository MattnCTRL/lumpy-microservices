export type SessionStatus = 'running' | 'stopped';

/**
 * Inferred from the session's terminal stream. `working` = actively producing
 * output, `awaiting_permission` = a prompt is asking the operator to approve an
 * action, `idle` = quiet and waiting, `unknown` = not yet determined.
 */
export type SessionActivity = 'working' | 'awaiting_permission' | 'idle' | 'unknown';

export interface Session {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  status: SessionStatus;
  activity: SessionActivity;
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
  tags?: string[];
  env?: ServerEnv;
  criticality?: ServerCriticality;
  /** When provided, Lumpy monitors the server agentlessly over SSH. */
  ssh?: SshConnectionInput;
}

/** Metrics payload posted by an agent; the orchestrator stamps `at`. */
export type MetricsReport = Omit<ServerMetrics, 'at'>;

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

// --- Event spine ---------------------------------------------------------

/**
 * Events published on the orchestrator's event spine. Session events stream
 * over `/ws/sessions`; fleet events over `/ws/fleet`. New subsystems extend
 * this union as they land.
 */
export type LumpyEvent =
  | { type: 'session.activity'; id: string; name: string; activity: SessionActivity; at: string }
  | { type: 'session.status'; id: string; name: string; status: SessionStatus; at: string }
  | { type: 'fleet.server.status'; id: string; name: string; status: ServerStatus; at: string }
  | { type: 'fleet.metrics'; id: string; name: string; metrics: ServerMetrics; at: string }
  | { type: 'fleet.server.removed'; id: string; name: string; at: string }
  | { type: 'alert.fired'; alert: Alert; at: string }
  | { type: 'alert.resolved'; id: string; serverName: string; label: string; at: string };
