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

## Activity detection

Each broker feeds an `ActivityTracker` that infers what the session is doing
from its terminal output:

- **`working`** — output was produced within the last ~1.2s.
- **`awaiting_permission`** — the recent output matches a permission prompt
  (e.g. "Do you want to proceed?", a numbered yes/no menu, `(y/n)`).
- **`idle`** — quiet and not awaiting.
- **`unknown`** — no output seen yet (or the session is stopped).

The tracker strips ANSI sequences, keeps a bounded tail of recent output, and
re-evaluates on each chunk and on a 1s timer (so idle transitions are detected
even when output stops). On every change it publishes a `session.activity`
event on the [event spine](#event-spine), and the current value is included in
the REST session list.

Detection is intentionally tolerant — the terminal stream is the ground truth
and the operator can always act manually. The pattern set will expand as the
Claude Code prompt formats are pinned down.

## Event spine

Status and activity changes are published on an in-process event bus
(`EventBus`) and streamed to clients over `GET /ws/sessions`. The interface is
deliberately small so it can be backed by Redis Streams later without changing
publishers. New subsystems publish their own event types on the same bus.

## Autonomous sessions

Sessions default to **autonomous**: a Claude session launches with
`--dangerously-skip-permissions` so it executes without pausing for approval, and
an optional **task** is passed as the initial prompt so it starts working
immediately. This is the core of Lumpy "doing things on your behalf".

The launch command is derived from the base command, the autonomous flag, and the
task (`apps/orchestrator/src/sessions/launch.ts`). `IS_SANDBOX=1` is set so
skip-permissions is allowed when the orchestrator runs as root. Turn the flag off
for an interactive session that asks before acting.

**Caution:** an autonomous session runs commands on the orchestrator host without
asking. On the current deployment it runs as root, so only point it at trusted
workspaces. Running sessions under a dedicated non-root user is a planned
hardening (see [roadmap.md](roadmap.md)).

## Permission relay (in progress)

Detecting `awaiting_permission` is the first half of remote approvals. The web
UI surfaces it (highlighted session + a quick-keys bar to answer prompts by
thumb). Push notifications with approve/deny actions are next and depend on a
configured notification provider. See [spec.md](spec.md) §4.1 and §4.5.

## Requirements & caveats

- `tmux` must be installed on the orchestrator host. The orchestrator performs a
  preflight check and refuses to start sessions if it is missing.
- The session command runs with the orchestrator's environment and permissions.
  Network isolation (Tailscale) and auth are the access controls; see
  [security.md](security.md).
