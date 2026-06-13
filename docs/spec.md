# Lumpy Micro Services — System Specification

> **Status:** Draft v0.1 (pre-build)
> **Owner:** Matthew Whiteman
> **Date:** 2026-06-13
> **One-liner:** A self-hosted, always-on orchestrator that runs and controls many interactive Claude Code sessions, plus maps/monitors/remediates a fleet of remote servers — all driven from a high-end UI on any device over a private network.

---

## 1. Vision & Goals

Lumpy is a **personal operations cockpit**. It does two intertwined jobs:

1. **Agent orchestration** — spin up, manage, observe, and steer multiple live Claude Code (CLI) sessions concurrently, each working in its own repo/workspace, persisting across disconnects and orchestrator restarts.
2. **Fleet observability & autonomous remediation** — discover, map, and monitor remote servers over SSH/agents; detect incidents; alert; and remediate automatically or with a one-tap approval, scaled to severity.

The whole thing runs unattended on a Hetzner box and is controllable from a phone, laptop, or tablet through one cohesive, fast, modern UI.

### Design principles

- **Persistence first.** Sessions and state survive crashes, deploys, and network drops. tmux is the backbone for terminal durability.
- **Private by default.** No public attack surface; everything sits behind a Tailscale mesh. Code-executing actions require being on the network.
- **Human-in-the-loop, tiered.** Autonomy is earned per-playbook; destructive actions always confirm.
- **One event spine.** Everything (session output, metrics, alerts, approvals) flows through a single event/stream layer so the UI, notifications, and automation all see the same truth.
- **Mobile-grade UI, desktop-power UI.** The same app scales from a 3-tap phone action to a multi-pane desktop war-room.

### Non-goals (v1)

- Multi-tenant / multi-user SaaS. This is single-operator (you), though built so multi-user is not precluded.
- Distributed worker scheduling across many nodes (kept as a future extension; v1 is central).
- Replacing a full APM/Datadog. We do focused, actionable monitoring — not deep distributed tracing.

---

## 2. Architecture Decisions (locked)

| Decision                 | Choice                                                     | Rationale                                                                                                        |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Session engine**       | Wrap interactive `claude` CLI in **tmux + PTY**            | Maximum fidelity to the real interactive experience; durable, reattachable sessions; stream raw TTY to xterm.js. |
| **Topology**             | **Central orchestrator + lightweight remote agents**       | One brain on Hetzner; thin sensors/executors on each target server (or agentless SSH fallback).                  |
| **Access model**         | **Private — Tailscale/WireGuard mesh**, strong auth on top | It runs code and SSHes into prod; minimize attack surface.                                                       |
| **Remediation autonomy** | **Tiered by severity**                                     | Low → auto; medium → one-tap approval; high/destructive → explicit confirm. Configurable per playbook.           |

---

## 3. High-Level Architecture

```
                          ┌──────────────────────────────────────────────┐
                          │              CLIENTS (over Tailscale)          │
                          │   Phone PWA  ·  Desktop web  ·  Tablet         │
                          └───────────────┬────────────────────────────────┘
                                          │  HTTPS + WebSocket (xterm streams, live events)
                          ┌───────────────▼────────────────────────────────┐
                          │            EDGE / GATEWAY (Caddy)               │
                          │  TLS, auth enforcement, reverse proxy, WS up    │
                          └───────────────┬────────────────────────────────┘
                                          │
        ┌─────────────────────────────────▼─────────────────────────────────────┐
        │                       ORCHESTRATOR CORE (Node/TS)                       │
        │                                                                         │
        │  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────┐ │
        │  │ Session Mgr  │  │ Fleet Manager │  │ Alert Engine  │  │ Auth/RBAC │ │
        │  │ (tmux/PTY)   │  │ (SSH/agents)  │  │ + Remediation │  │           │ │
        │  └──────┬───────┘  └──────┬────────┘  └──────┬────────┘  └───────────┘ │
        │         │                 │                  │                          │
        │  ┌──────▼─────────────────▼──────────────────▼───────────────────────┐ │
        │  │                  EVENT SPINE (Redis Streams / pub-sub)             │ │
        │  └──────┬─────────────────┬──────────────────┬───────────────────────┘ │
        └─────────┼─────────────────┼──────────────────┼─────────────────────────┘
                  │                 │                  │
        ┌─────────▼──────┐ ┌────────▼────────┐ ┌───────▼──────────┐
        │  Postgres      │ │  Time-series    │ │  Object store    │
        │ (state, audit) │ │ (VictoriaMetrics│ │ (logs,artifacts, │
        │                │ │  / Timescale)   │ │  session dumps)  │
        └────────────────┘ └─────────────────┘ └──────────────────┘
                  │
        ┌─────────▼───────────────────────────────────────────────┐
        │            TARGET SERVERS (the fleet)                    │
        │   lumpy-agent (metrics/logs push + command exec)         │
        │   ── or agentless: SSH on demand ──                      │
        └─────────────────────────────────────────────────────────┘
                  │
        ┌─────────▼───────────────────────┐
        │  NOTIFICATIONS                   │
        │  Web Push · ntfy/Pushover ·      │
        │  (Telegram/Slack optional)       │
        │  → actionable approve/deny       │
        └──────────────────────────────────┘
```

---

## 4. Core Subsystems

### 4.1 Session Manager (Claude Code orchestration)

**Goal:** run N concurrent interactive `claude` sessions, each durable and individually controllable/observable.

**Mechanism**

- Each session is a **tmux session** (`lumpy-sess-<id>`) running `claude` in a defined **workspace** (a git repo / directory, optionally an isolated git worktree).
- The orchestrator attaches via **`node-pty`** spawning `tmux attach` (or pipes through `tmux pipe-pane`) to capture raw output and inject keystrokes.
- tmux gives us: survive orchestrator restarts, reattach without losing scrollback, multiple viewers of one session.
- Output streamed to clients via WebSocket; rendered by **xterm.js** (with `@xterm/addon-serialize` for scrollback hydration on (re)connect).
- Input: keystrokes, line commands, and **structured "send prompt" actions** from the UI (including from mobile — a text box that writes to the PTY + Enter).

**Per-session capabilities**

- Create from a **template** (repo URL/path, branch, base prompt, permission mode, model, env vars, MCP servers, allowed tools).
- Lifecycle: `start · attach · detach · pause(suspend) · resume · interrupt(Ctrl-C/ESC) · kill · archive`.
- **Snapshot & resume context**: capture scrollback + working dir state; relaunch with `claude --resume` / `--continue` where applicable.
- **Health probe**: detect stuck/idle/awaiting-input/awaiting-permission states by parsing the TTY for known prompts; surface a status badge.
- **Permission relay**: when Claude Code asks for a permission/approval, detect it, push a notification with Approve/Deny buttons → relay the keystroke back. (This is the bridge between interactive CLI and remote phone control.)
- **Cost/usage tracking** per session (parse usage lines / wrap with accounting where possible).
- **Tags & grouping**: by project, priority, or "swarm" (a set of sessions working a shared goal).

**Concurrency & resources**

- Per-session cgroup/`systemd` slice or nice/ionice limits; configurable max concurrent sessions; CPU/mem caps; disk quota per workspace.
- Optional run-in-container mode per session (Docker/Podman) for isolation — flagged for later; v1 uses native tmux + workspace dirs.

**Status model (state machine)**
`provisioning → running → (idle | working | awaiting_input | awaiting_permission | error) → (paused) → stopped → archived`

### 4.2 Fleet Manager (remote server map/monitor/manage)

**Inventory & discovery**

- **Server registry**: name, addresses (Tailscale IP preferred), tags/roles, SSH creds ref, agent status, owner, environment (prod/staging), criticality tier.
- **Discovery**: import from Tailscale device list, Hetzner Cloud API, and/or manual add; optional subnet scan within the tailnet.
- **Topology map**: a visual graph of servers, their roles, dependencies (e.g. "web → db"), and live health colors.

**Monitoring (two modes)**

1. **Agent mode (preferred):** `lumpy-agent` — a small static binary (Go) installed on each server. Pushes:
   - System metrics (CPU, mem, disk, IO, net, load, process table, temps).
   - Service health (systemd unit states, container states, port checks, custom healthcheck commands).
   - Log tailing (journald/file globs) with filtering → forwarded as events.
   - Heartbeat (so we detect agent/host down).
   - Accepts **signed command execution** requests from the orchestrator (for remediation).
2. **Agentless mode (fallback):** orchestrator runs periodic SSH checks (metrics via standard commands, log greps). Lower fidelity, zero install. Good for servers you can't/won't install on.

**Data flow**: agents push to orchestrator ingestion endpoint (mTLS over tailnet) → Event Spine → time-series store + alert engine.

**Management actions**

- Run command / playbook on one or many servers (fan-out).
- Service restart, deploy hooks, config edits (with diff + confirm).
- **One-click "investigate with Claude"**: spin up a Claude Code session pre-loaded with the server's recent metrics/logs and SSH access to diagnose.

### 4.3 Alert Engine + Remediation (tiered autonomy)

**Rules**

- Threshold rules (e.g. disk > 90%, mem > 95% for 5m, service down, agent heartbeat lost).
- Log-pattern rules (regex/keyword on streamed logs → alert).
- Composite/anomaly rules (rate-of-change, sustained conditions, flapping detection).
- Each rule → **severity**: `info · warning · critical · emergency`.

**Severity → autonomy mapping (default, per-playbook overridable)**

| Severity                | Default behavior                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| info                    | Log + dashboard only. No notification.                                                                                           |
| warning                 | Notify. Optional **auto-remediate if a "safe" playbook is attached** (e.g. clear tmp, rotate logs, restart a stateless service). |
| critical                | Notify with **one-tap Approve** to run the matched remediation playbook; auto-run only if explicitly allow-listed.               |
| emergency / destructive | **Always require explicit confirmation** (typed confirm or 2-step). Never auto.                                                  |

**Playbooks**

- Declarative + scriptable: `{ trigger, match, steps[], risk_level, rollback, requires_confirmation }`.
- Steps can be: shell commands on target, service ops, scale actions, **or "delegate to a Claude Code session"** (the system opens a scoped session to diagnose+fix, then reports back a proposed diff/commands for approval).
- Every remediation run is fully audited (who/what/when/result/rollback available).
- **Escalation chains**: if remediation fails or no approval within T minutes, escalate severity / notify next channel.
- **Flap & storm control**: dedupe, cool-down windows, alert grouping to avoid 3am spam.

### 4.4 Event Spine

- **Redis Streams** (or NATS) as the single real-time bus: session output frames, status changes, metrics samples, alerts, approvals, audit events.
- Consumers: WebSocket gateway (→ UI), persistence writers (→ Postgres/TS), notification dispatcher, automation engine.
- Gives replay, backpressure, and a clean seam if we later split services.

### 4.5 Notifications

- **Channels**: Web Push (PWA), plus ntfy or Pushover for reliable phone push with **action buttons**; optional Telegram/Slack/email.
- **Actionable**: notifications carry Approve/Deny/View deep-links that hit signed, short-lived endpoints (so you can approve a remediation or a Claude permission prompt straight from the lock screen — still gated by being on the tailnet for execution).
- **Digest mode**: batch low-priority into periodic summaries; quiet hours.

### 4.6 Auth, Identity & Security

- **Network**: Tailscale/WireGuard mesh; orchestrator binds to tailnet interface only. No public ingress for control.
- **App auth**: OIDC (or self-hosted, e.g. Authelia/Pocket-ID) + **passkeys/WebAuthn** for device login. Session cookies + short-lived API tokens.
- **RBAC** (future-proofing for multi-user): roles `owner/operator/viewer`; per-action scopes (view session vs. send input vs. run remediation).
- **Secrets**: SSH keys, agent tokens, API keys in a secrets manager (SOPS+age, or Infisical/Vault). Never in DB plaintext.
- **mTLS** between agents and orchestrator over the tailnet.
- **Audit log**: append-only record of every command, input injection, approval, remediation, and config change.
- **Confirmation friction** scales with blast radius (typed confirm for fleet-wide/destructive ops).

---

## 5. Data Model (initial)

```
users(id, email, role, webauthn_creds, created_at)
servers(id, name, tailscale_ip, tags[], role, env, criticality, agent_mode, ssh_cred_ref, status, last_seen)
session_templates(id, name, repo, branch, base_prompt, model, perm_mode, env, mcp[], allowed_tools[])
sessions(id, template_id, name, workspace_path, tmux_name, status, tags[], cost, started_at, last_activity, archived_at)
session_events(id, session_id, ts, type, payload)            -- status/usage/permission requests (raw TTY in object store)
metrics(server_id, ts, name, value, labels)                  -- in time-series store
log_events(id, server_id, ts, source, level, message, raw)
alerts(id, rule_id, server_id?, session_id?, severity, status, opened_at, ack_by, resolved_at)
rules(id, name, expr, severity, scope, playbook_id?, enabled)
playbooks(id, name, trigger, steps_json, risk_level, requires_confirmation, rollback_json)
remediations(id, alert_id, playbook_id, status, approved_by, started_at, finished_at, result, rollback_available)
approvals(id, subject_type, subject_id, requested_at, decided_at, decided_by, decision)
audit(id, actor, action, target, ts, detail_json)            -- append-only
notifications(id, channel, payload, sent_at, action_taken)
```

---

## 6. API & Realtime Surface

**REST/RPC (over Tailscale, authed)**

- `POST /sessions` (create from template), `GET /sessions`, `POST /sessions/:id/input`, `POST /sessions/:id/{pause|resume|interrupt|kill}`, `GET /sessions/:id/scrollback`
- `GET /servers`, `POST /servers`, `POST /servers/:id/exec` (gated), `GET /servers/:id/metrics`
- `GET /alerts`, `POST /alerts/:id/ack`, `POST /remediations/:id/{approve|deny}`
- `GET/POST /playbooks`, `GET/POST /rules`, `GET /audit`

**WebSocket channels**

- `ws/session/:id` — bidirectional raw TTY frames (xterm).
- `ws/events` — multiplexed live feed: status changes, metrics deltas, alerts, approval requests.

**Webhooks/ingest**

- `POST /ingest/metrics`, `POST /ingest/logs`, `POST /ingest/heartbeat` (agent → orchestrator, mTLS).

---

## 7. UI / UX Specification

**Platform:** Next.js (App Router) **PWA** — installable on phone, offline-aware shell, push notifications. Tailwind + shadcn/ui. Terminal via **xterm.js**. Dark, dense, keyboard-driven on desktop; thumb-friendly on mobile.

### 7.1 Global shell

- Left rail (desktop) / bottom tab bar (mobile): **Sessions · Fleet · Alerts · Playbooks · Activity · Settings**.
- Global **command palette** (⌘K): jump to any session/server, run actions, send a prompt.
- Persistent **status bar**: active sessions count, open alerts by severity, system health, connection (tailnet) indicator.
- Live **notification center** with approve/deny inline.

### 7.2 Sessions view

- **Grid / "video wall"** of session tiles: each shows live mini-terminal preview, status badge (working/idle/awaiting-permission), repo, model, cost, last activity.
- **Focus mode**: full xterm with input bar, quick-keys (Esc, Ctrl-C, "approve", common prompts), scrollback, and a side panel (workspace file tree, git status, recent diff, usage).
- **Multi-pane war-room** (desktop): tile 2–6 terminals side by side; broadcast a prompt to a selected group ("swarm" mode).
- **Mobile session view**: single terminal, big input box, swipe between sessions, prominent Approve/Deny when permission is pending, "send prompt" presets.
- **Create-session** flow: pick template or custom (repo, branch, model, permission mode, prompt). One-tap "clone & start."

### 7.3 Fleet view

- **Topology map**: interactive node graph; color = health; click → server detail.
- **Server list/table**: filterable by tag/role/env/criticality; sparkline metrics inline.
- **Server detail**: live metrics charts (CPU/mem/disk/net), service/unit status, log stream (filterable), quick actions (restart service, run playbook, **"Investigate with Claude"**), recent alerts.

### 7.4 Alerts & Remediation

- **Incident inbox**: grouped, severity-sorted; ack/snooze/resolve.
- **Alert detail**: what fired, context (metrics/logs at the time), matched playbook, **Approve to remediate** / Deny, live remediation log, rollback button.
- **Timeline** of an incident from detection → notification → action → resolution.

### 7.5 Playbooks & Rules

- Visual editor for rules (condition builder) and playbooks (step list, risk level, confirmation toggle, rollback).
- Dry-run / simulate against historical data.
- Per-playbook autonomy override (the severity→autonomy mapping).

### 7.6 Activity / Audit

- Unified, searchable feed of every action, approval, remediation, and config change. Exportable.

---

## 8. Technology Stack (recommended)

| Layer               | Choice                                            | Notes                                                        |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Orchestrator core   | **Node.js + TypeScript** (Fastify/NestJS)         | `node-pty` for tmux/PTY; rich ecosystem for WS/streams.      |
| Terminal durability | **tmux**                                          | Reattach, survive restarts, multi-viewer.                    |
| Realtime bus        | **Redis Streams** (or NATS)                       | Event spine + pub/sub + replay.                              |
| State DB            | **PostgreSQL**                                    | Supabase optional (MCP available) or self-hosted on Hetzner. |
| Time-series         | **VictoriaMetrics** (or TimescaleDB)              | Metrics storage + query.                                     |
| Object store        | **MinIO** (S3-compatible)                         | Scrollback dumps, logs, artifacts.                           |
| Remote agent        | **Go** (single static binary)                     | Tiny footprint, easy install, mTLS.                          |
| Frontend            | **Next.js PWA + Tailwind + shadcn/ui + xterm.js** | One app, all devices.                                        |
| Charts/graph        | Recharts/visx + a graph lib (e.g. React Flow)     | Metrics + topology map.                                      |
| Auth                | OIDC + **WebAuthn/passkeys** (Authelia/Pocket-ID) | Device-bound login.                                          |
| Network             | **Tailscale**                                     | Private mesh; sole control ingress.                          |
| Edge                | **Caddy**                                         | TLS + reverse proxy + WS.                                    |
| Secrets             | **SOPS+age** or Infisical                         | No plaintext secrets in DB.                                  |
| Process mgmt        | **systemd** units (+ optional Docker Compose)     | Auto-restart, resource slices.                               |
| Notifications       | Web Push + **ntfy/Pushover**                      | Actionable, reliable phone push.                             |

> Note: this is a self-hosted, long-running, stateful system (PTYs, tmux, persistent sockets). It is **not** a fit for Vercel's serverless model — Vercel could optionally host a _thin public status page_ later, but the orchestrator lives on Hetzner.

---

## 9. Deployment (Hetzner)

- Single **Hetzner Cloud VM** (e.g. CPX/CCX with ample RAM for many sessions) running:
  - `docker compose` (or systemd) stack: orchestrator, redis, postgres, victoriametrics, minio, caddy.
  - tmux + `claude` CLI installed natively (sessions run on host, not in a constrained container, for fidelity — or in privileged session containers later).
- **Tailscale** installed on the VM and all target servers + your devices.
- Backups: nightly Postgres dump + MinIO snapshot to Hetzner Storage Box / object storage.
- Provisioning via a single bootstrap script (cloud-init) + Ansible/compose for repeatability.
- Health: orchestrator self-monitors (it's a server in its own fleet) and watchdog via systemd.

---

## 10. Phased Roadmap

**Phase 0 — Foundations (skeleton)**

- Repo + monorepo layout, compose stack, Tailscale, Caddy, auth (passkey login), Postgres/Redis up. Empty PWA shell that authenticates.

**Phase 1 — Session orchestration MVP**

- Create/attach/kill tmux+PTY `claude` sessions; live xterm streaming over WS; input injection; scrollback persistence; session grid + focus view; permission-prompt detection → push notification → approve/deny relay.

**Phase 2 — Fleet monitoring MVP**

- `lumpy-agent` (metrics+heartbeat+log tail) + agentless SSH fallback; server registry; server detail with live charts/logs; basic threshold alert rules; notifications.

**Phase 3 — Alerting + tiered remediation**

- Rule/playbook engine; severity→autonomy mapping; approve-to-remediate flow; audit log; escalation/flap control; "Investigate with Claude" delegation.

**Phase 4 — Advanced UI & polish**

- Topology map; war-room multi-pane + swarm prompts; command palette; playbook visual editor + dry-run; digests/quiet hours; cost dashboards.

**Phase 5 — Hardening & extensions**

- RBAC/multi-user, per-session containers, distributed workers, rollups/retention, mobile UX refinements, backup/restore drills.

---

## 11. Key Risks & Open Questions

- **Parsing interactive TTY for state/permissions** is brittle (CLI output can change). Mitigation: tolerant matchers + a "manual approve" fallback always available; revisit Agent SDK for the _automation_ paths later (hybrid) if parsing proves painful.
- **Resource contention**: many concurrent Claude sessions are heavy. Need real caps, queueing, and a "max active" policy.
- **Security of remote command execution**: signed commands, mTLS, audit, and confirmation gates are mandatory before any auto-remediation ships.
- **Notification reliability** for time-critical approvals (Web Push can be flaky on iOS) → ntfy/Pushover as primary for criticals.
- **Decisions still open:** (1) exact metrics retention windows; (2) which servers get agent vs agentless; (3) whether to containerize sessions in v1; (4) preferred push provider (ntfy self-host vs Pushover); (5) IaC tool (Ansible vs plain compose + script).

---

## 12. Next Step

If this spec looks right, the recommended first build target is **Phase 0 + the Phase 1 session core** (the part with the most novel value): a working orchestrator that can spawn a tmux-backed `claude` session and stream it live to a browser with input + permission relay. Everything else builds on that spine.
