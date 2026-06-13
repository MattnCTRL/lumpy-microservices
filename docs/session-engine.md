# Session Engine

How Lumpy runs and streams interactive Claude Code sessions.

## Model

Every session is a real `tmux` session named `<prefix>-<id>` (default prefix
`lumpy`). Inside it runs the session command — `claude` by default — in the
session's workspace directory.

`tmux` is the source of truth. The orchestrator process can restart, crash, or
redeploy without taking sessions down; they keep running detached inside
`tmux`. On startup the orchestrator re-discovers them.

## Components

### Broker

For each live session the orchestrator runs one **broker**: a single PTY
(`node-pty`) attached to the `tmux` session via `tmux attach-session`. The
broker:

- reads raw terminal output and fans it out to every connected client,
- keeps a bounded **ring buffer** of recent output so a newly connected client
  can be painted with current screen state before live streaming begins,
- writes client input into the PTY,
- resizes the PTY (and `tmux` window) to match the controlling client.

A single broker per session — rather than one PTY per viewer — means all
viewers share one consistent view and one terminal size.

### Manager

The **Session Manager** owns the set of brokers and the metadata store. It:

- creates sessions (`tmux new-session -d`, then starts a broker),
- lists sessions by merging stored metadata with live `tmux` status,
- stops sessions (`tmux kill-session`, tears down the broker),
- recovers on startup by listing prefixed `tmux` sessions and starting brokers
  for any that lack one.

### Store

SQLite holds what `tmux` cannot: name, workspace, command, tags, and
timestamps. Liveness and status are always read from `tmux`, never cached.

## Lifecycle

```
create ─► tmux new-session -d ─► start broker ─► running
                                                   │
 client connects ─► send ring buffer ─► live stream│
                                                   │
 stop ─► kill broker ─► tmux kill-session ─► stopped
```

If the orchestrator restarts while a session is running, the broker is
recreated on startup and clients can reconnect transparently.

## Status detection (planned)

A future iteration parses the terminal stream to detect session state
(`idle`, `working`, `awaiting_input`, `awaiting_permission`) and surfaces
Claude Code permission prompts as push notifications with approve/deny actions.
See [spec.md](spec.md) §4.1.

## Requirements & caveats

- `tmux` must be installed on the orchestrator host. The orchestrator performs a
  preflight check and refuses to start sessions if it is missing.
- The session command runs with the orchestrator's environment and permissions.
  Network isolation (Tailscale) and auth are the access controls; see
  [security.md](security.md).
