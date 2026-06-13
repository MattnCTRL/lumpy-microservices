# Lumpy Micro Services

Self-hosted orchestrator for running many interactive Claude Code sessions and
monitoring a fleet of remote servers — controllable from any device over a
private network.

Lumpy does two intertwined jobs:

1. **Agent orchestration** — spawn, observe, and steer multiple live Claude Code
   sessions concurrently. Each runs in a durable `tmux` session that survives
   disconnects and orchestrator restarts, streamed live to the browser.
2. **Fleet observability & remediation** — discover, map, and monitor remote
   servers; detect incidents; alert; and remediate automatically or with a
   one-tap approval, scaled to severity.

## Status

Early development. The current build implements:

- **Session orchestration (Phase 1)** — create, attach, stream, and control
  `tmux`-backed Claude Code sessions from a web UI, with live activity detection
  and an event spine.
- **Fleet monitoring (Phase 2, in progress)** — a server registry with
  metrics/heartbeat ingestion, online/offline status, and a Fleet UI with live
  metric cards (the metrics-collecting agent and alerting are still ahead).

See [`docs/roadmap.md`](docs/roadmap.md) for the full plan.

## Architecture at a glance

- **Orchestrator** (`apps/orchestrator`) — Node.js + Fastify control plane. Owns
  session lifecycle via `tmux` + PTY, exposes a REST API and a WebSocket gateway
  that streams terminal output and accepts input.
- **Web** (`apps/web`) — Next.js PWA. Session grid, live terminals (xterm.js),
  and controls that work on desktop and mobile.
- **Shared** (`packages/shared`) — types shared across the workspace.

Full design: [`docs/architecture.md`](docs/architecture.md).

## Requirements

- Node.js 22+
- [`tmux`](https://github.com/tmux/tmux) on the host running the orchestrator
  (`brew install tmux` on macOS)
- The `claude` CLI, if you want to launch real Claude Code sessions

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

The orchestrator starts on `http://127.0.0.1:4317` and the web UI on
`http://127.0.0.1:3000`.

Full walkthrough: [`docs/getting-started.md`](docs/getting-started.md).

## Documentation

Project documentation lives in [`docs/`](docs/). Start with the
[documentation index](docs/README.md).

## License

[MIT](LICENSE) © Matthew Whiteman
