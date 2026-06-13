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

/**
 * Events published on the orchestrator's event spine and streamed to clients
 * over the `/ws/sessions` channel. New subsystems (fleet, alerts) extend this
 * union as they land.
 */
export type LumpyEvent =
  | { type: 'session.activity'; id: string; activity: SessionActivity; at: string }
  | { type: 'session.status'; id: string; status: SessionStatus; at: string };
