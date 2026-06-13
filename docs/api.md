# Orchestrator API

The orchestrator exposes a REST API for control actions and a WebSocket gateway
for live terminal I/O. Base URL defaults to `http://127.0.0.1:4317`.

All shapes referenced here are defined in `packages/shared`.

## REST

### `GET /api/health`

Returns service health and engine readiness.

```json
{
  "status": "ok",
  "tmux": true,
  "version": "0.1.0",
  "uptimeSeconds": 1234
}
```

`tmux` is `false` when `tmux` is not installed; session creation will fail until
it is available.

### `GET /api/sessions`

List all known sessions, merging stored metadata with live `tmux` status.

```json
[
  {
    "id": "k3f9d2",
    "name": "lumpy api refactor",
    "workspace": "/Users/me/dev/lumpy",
    "command": "claude",
    "tags": ["lumpy"],
    "status": "running",
    "activity": "awaiting_permission",
    "createdAt": "2026-06-13T12:00:00.000Z",
    "lastActivityAt": "2026-06-13T12:05:00.000Z"
  }
]
```

`status` is one of `running` or `stopped`. `activity` is inferred from the
terminal stream and is one of `working`, `awaiting_permission`, `idle`, or
`unknown` (it is `unknown` for stopped sessions). See
[session-engine.md](session-engine.md) for how it is derived.

### `POST /api/sessions`

Create and start a session.

```json
{
  "name": "lumpy api refactor",
  "workspace": "/Users/me/dev/lumpy",
  "command": "claude",
  "tags": ["lumpy"]
}
```

`workspace` and `command` are optional and fall back to the configured defaults.
Returns the created session (as above) with `201`.

### `GET /api/sessions/:id`

Return a single session, or `404` if unknown.

### `POST /api/sessions/:id/input`

Write text into the session (convenience endpoint for presets and mobile;
interactive input normally goes over WebSocket).

```json
{ "data": "git status\n" }
```

### `POST /api/sessions/:id/stop`

Stop the session: kills the `tmux` session and tears down its broker.

## WebSocket

### `GET /ws/session/:id`

Bidirectional channel for one session.

**Server → client**

- **Binary frames** carry raw terminal output. Write them directly to xterm.js.
- **Text frames** carry JSON control messages:

  ```json
  { "type": "snapshot-end" }          // initial ring-buffer replay finished
  { "type": "status", "status": "stopped" }
  { "type": "error", "message": "session not found" }
  ```

On connect, the server first replays the broker's ring buffer (recent output)
as binary frames, then emits `{"type":"snapshot-end"}`, then streams live.

**Client → server** (JSON text frames)

```json
{ "type": "input", "data": "ls\r" }
{ "type": "resize", "cols": 120, "rows": 40 }
```

### `GET /ws/sessions`

A read-only stream of session events from the orchestrator's event spine. Each
message is a JSON text frame:

```json
{ "type": "session.activity", "id": "k3f9d2", "activity": "working", "at": "2026-06-13T12:00:01.000Z" }
{ "type": "session.status", "id": "k3f9d2", "status": "stopped", "at": "2026-06-13T12:09:00.000Z" }
```

The web UI uses this to update activity badges and statuses live, without
polling. Future subsystems (fleet, alerts) publish their own event types on the
same channel.

## Fleet

Provided by the `fleet` module. Base path `/api/fleet`.

### `GET /api/fleet/servers`

List registered servers with derived status and latest metrics.

```json
[
  {
    "id": "v6t2i6",
    "name": "web-1",
    "address": "10.0.0.1",
    "tags": [],
    "env": "prod",
    "criticality": "high",
    "status": "online",
    "lastSeenAt": "2026-06-13T14:27:49.892Z",
    "createdAt": "2026-06-13T14:27:49.800Z",
    "metrics": {
      "at": "...",
      "cpuPercent": 23.5,
      "memPercent": 61,
      "diskPercent": 48,
      "load1": 0.7,
      "uptimeSeconds": 86400
    }
  }
]
```

`status` is `online`, `offline`, or `unknown`. `metrics` is the latest sample or
`null`.

### `POST /api/fleet/servers`

Register a server. `tags`, `env` (`prod`/`staging`/`dev`), and `criticality`
(`low`/`medium`/`high`) are optional.

```json
{ "name": "web-1", "address": "10.0.0.1", "env": "prod", "criticality": "high" }
```

### `GET /api/fleet/servers/:id`

Return one server plus its recent metrics `history`, or `404`.

### `DELETE /api/fleet/servers/:id`

Remove a server. `204`, or `404` if unknown.

### `POST /api/fleet/servers/:id/metrics`

Ingest a metrics sample (posted by an agent). The orchestrator stamps the
timestamp and marks the server `online`. `204`, or `404` if the server is
unknown.

```json
{ "cpuPercent": 23.5, "memPercent": 61, "diskPercent": 48, "load1": 0.7, "uptimeSeconds": 86400 }
```

### `GET /ws/fleet`

Live stream of fleet events (JSON text frames):

```json
{ "type": "fleet.metrics", "id": "v6t2i6", "metrics": { "...": "..." }, "at": "..." }
{ "type": "fleet.server.status", "id": "v6t2i6", "status": "offline", "at": "..." }
```

## Errors

Errors use standard HTTP status codes with a JSON body:

```json
{ "error": "session not found" }
```
