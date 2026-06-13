# Roadmap

Phased delivery plan. The full rationale for each phase is in [spec.md](spec.md)
§10. This file tracks status; keep it current.

## Phase 0 — Foundations

Monorepo, tooling, configuration, documentation, and an authenticated app shell.

- [x] Monorepo layout (npm workspaces), TypeScript, formatting
- [x] Documentation set and documentation policy
- [x] Shared types package
- [x] Module/extension seam (registry + `ModuleContext`) for downstream tools
- [x] Always-on deploy: `scripts/install-orchestrator.sh` runs orchestrator +
      web as systemd services bound to the tailnet (see [deploy.md](deploy.md))
- [x] **Sign in with GitHub** (OAuth) with profile mirroring (avatar/name/handle)
- [ ] Gate access by auth + roles (passkeys as an additional factor)
- [ ] GitHub integration beyond auth: surface repos when creating sessions, and
      show the signed-in GitHub profile in the UI header

## Phase 1 — Session orchestration (current)

Create, attach, stream, and control `tmux`-backed Claude Code sessions.

- [x] `tmux` + PTY session manager with brokers and ring buffers
- [x] REST API for session lifecycle
- [x] WebSocket gateway for live terminal I/O
- [x] Web UI: session grid, live terminals, create/stop
- [x] Event spine (`EventBus`) + `/ws/sessions` live event stream
- [x] Activity detection (working / awaiting_permission / idle) with live badges
- [x] Mobile quick-keys to answer prompts by thumb
- [x] Autonomous sessions by default (skip-permissions + optional initial task)
- [x] Run sessions under a dedicated non-root user (autonomy hardening)
- [x] Session recovery on orchestrator restart (hardened; integration-tested)
- [x] Tests: activity detection (unit) + restart recovery (integration)
- [x] Permission-prompt → ntfy push with approve/reject action buttons
      (`notify` module; see [notifications.md](notifications.md))

## Phase 2 — Fleet monitoring (current)

Remote agent, metrics/log ingestion, server registry, basic alerting.

- [x] `fleet` module: server registry (SQLite) + REST/`/ws/fleet`
- [x] Metrics/heartbeat ingestion with online/offline/unknown status derivation
- [x] Fleet events on the spine + tests
- [x] Web UI: Sessions/Fleet navigation; server list + detail with live metric
      cards and sparklines, driven by `/ws/fleet`
- [x] **Agentless SSH monitoring**: add a server with SSH creds, Lumpy connects
      out and polls `/proc`; connection tested on add; rename/delete in the UI
- [x] Demo metrics agent (`scripts/demo-agent.mjs`) for exercising the UI
- [x] `lumpy-agent` (CPU/mem/disk/load/uptime, self-registration) — Node v0
- [ ] Encrypt stored SSH credentials at rest
- [ ] Remote management over SSH (run commands / playbooks on a server)
- [ ] Agent: log tailing; static-binary build
- [ ] Ingestion auth (token / mTLS over the tailnet)
- [x] Server-offline notifications via the `notify` module
- [ ] Live log streaming in the server detail view
- [x] Threshold alert rules (the `alerts` module) feeding notifications

## Phase 3 — Alerting & tiered remediation

- [x] Alert-triggered remediation: autonomous Claude sessions (investigate/auto)
- [x] Severity → autonomy mapping (auto for warnings, one-tap approve for critical)
- [ ] Playbook engine (declarative remediation steps)
- [ ] Approve-to-remediate flow and audit log
- [x] "Investigate with Claude" delegation (the remediation loop)

## Phase 4 — Advanced UI & polish

- [ ] Topology map, war-room multi-pane, broadcast/swarm prompts
- [ ] Command palette, playbook visual editor, digests/quiet hours

## Phase 5 — Hardening & extensions

- [ ] RBAC / multi-user, per-session isolation
- [ ] Distributed workers, retention/rollups, backup/restore drills
