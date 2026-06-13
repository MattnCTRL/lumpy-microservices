export type SessionStatus = 'running' | 'stopped';

export interface Session {
  id: string;
  name: string;
  workspace: string;
  command: string;
  tags: string[];
  status: SessionStatus;
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
