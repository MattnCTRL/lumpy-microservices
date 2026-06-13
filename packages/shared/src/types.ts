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
  createdAt: string;
  lastActivityAt: string | null;
}

export interface CreateSessionInput {
  name: string;
  workspace?: string;
  command?: string;
  tags?: string[];
}

export interface HealthResponse {
  status: 'ok';
  tmux: boolean;
  version: string;
  uptimeSeconds: number;
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

export interface Server {
  id: string;
  name: string;
  address: string;
  tags: string[];
  env: ServerEnv;
  criticality: ServerCriticality;
  status: ServerStatus;
  lastSeenAt: string | null;
  createdAt: string;
  metrics: ServerMetrics | null;
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
}

/** Metrics payload posted by an agent; the orchestrator stamps `at`. */
export type MetricsReport = Omit<ServerMetrics, 'at'>;

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
  | { type: 'fleet.metrics'; id: string; metrics: ServerMetrics; at: string };
