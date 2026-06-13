# Architecture

This document describes how the running system fits together. For the product
vision and the full design, see [spec.md](spec.md).

## Components

```
┌──────────────────────────────────────────────────────────┐
│  Web (apps/web) — Next.js PWA                             │
│  Session grid · live terminals (xterm.js) · controls     │
└───────────────┬──────────────────────────────────────────┘
                │  REST (control)        WebSocket (stream)
                ▼                        ▼
┌──────────────────────────────────────────────────────────┐
│  Orchestrator (apps/orchestrator) — Fastify control plane │
│                                                            │
│   HTTP API ──┐                                             │
│   WS gateway ┤── Session Manager ── tmux + PTY brokers     │
│   Store ─────┘            │                                │
│   (SQLite metadata)       ▼                                │
└──────────────────────────┼────────────────────────────────┘
                           │ attach / input / resize
                           ▼
                    ┌──────────────┐
                    │ tmux sessions │  lumpy-<id> → `claude` (or any command)
                    └──────────────┘
```

## Orchestrator

The orchestrator is the control plane. It is a Fastify application with three
concerns:

- **HTTP API** — create, list, inspect, and stop sessions. See [api.md](api.md).
- **WebSocket gateway** — one channel per session that streams raw terminal
  output to clients and relays input/resize back. See [api.md](api.md).
- **Session Manager** — owns the lifecycle of `tmux`-backed sessions and infers
  their activity from the terminal stream. See [session-engine.md](session-engine.md).
- **Event spine** — an in-process `EventBus` carries domain events (session
  activity/status today; fleet and alerts later). It is exposed to clients over
  `GET /ws/sessions` and to modules through the `ModuleContext`.

State is split deliberately:

- **`tmux` is the source of truth for live sessions.** Sessions survive an
  orchestrator restart because they live in `tmux`, not in the orchestrator
  process. On startup the manager re-discovers them by listing `tmux` sessions
  with the configured prefix.
- **SQLite holds metadata** that `tmux` does not track: human-friendly names,
  the originating workspace and command, tags, and timestamps.

## Web

The web app is a Next.js PWA. It renders the session grid and full-screen
terminals via xterm.js, talking to the orchestrator over REST for control
actions and over WebSocket for live terminal I/O. It holds no server state of
its own; the orchestrator is authoritative.

## Shared

`packages/shared` contains the TypeScript types exchanged between orchestrator
and web (session shapes, WebSocket message envelopes), so both sides stay in
sync from a single definition.

## Why this shape

- **Durability first.** Wrapping the real `claude` CLI in `tmux` gives full
  fidelity to the interactive experience and makes sessions reattachable and
  crash-resilient without the orchestrator having to persist terminal state.
- **Thin, replaceable seams.** REST + WebSocket between web and orchestrator,
  and `tmux` between orchestrator and sessions, are all simple boundaries that
  can be hardened, replaced, or distributed later (see the roadmap).

## Fleet

The `fleet` module is the first non-session module and the template for the rest.
It owns the `/api/fleet` + `/ws/fleet` namespaces and its own `fleet.db` store,
holds a registry of remote servers, ingests their metrics/heartbeats, derives
online/offline status, and publishes fleet events on the spine. See
[fleet.md](fleet.md). The metrics-collecting agent, ingestion auth, and fleet UI
are still ahead.

## Planned components

The alert and remediation engine, the notification layer, and the security layer
(Tailscale-only access, passkey auth) are specified in [spec.md](spec.md) and
tracked in [roadmap.md](roadmap.md). They are not yet implemented.
