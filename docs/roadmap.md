# Roadmap

Phased delivery plan. The full rationale for each phase is in [spec.md](spec.md)
§10. This file tracks status; keep it current.

## Phase 0 — Foundations

Monorepo, tooling, configuration, documentation, and an authenticated app shell.

- [x] Monorepo layout (npm workspaces), TypeScript, formatting
- [x] Documentation set and documentation policy
- [x] Shared types package
- [x] Module/extension seam (registry + `ModuleContext`) for downstream tools
- [ ] Tailscale + reverse proxy deployment recipe
- [ ] Passkey authentication

## Phase 1 — Session orchestration (current)

Create, attach, stream, and control `tmux`-backed Claude Code sessions.

- [x] `tmux` + PTY session manager with brokers and ring buffers
- [x] REST API for session lifecycle
- [x] WebSocket gateway for live terminal I/O
- [x] Web UI: session grid, live terminals, create/stop
- [x] Event spine (`EventBus`) + `/ws/sessions` live event stream
- [x] Activity detection (working / awaiting_permission / idle) with live badges
- [x] Mobile quick-keys to answer prompts by thumb
- [ ] Session recovery on orchestrator restart (wired; needs hardening)
- [ ] Permission-prompt → push notification → approve/deny relay (needs a
      notification provider — see `.notes/TODO.md`)

## Phase 2 — Fleet monitoring

Remote agent, metrics/log ingestion, server registry, basic alerting.

- [ ] `lumpy-agent` (metrics, heartbeat, log tail) + agentless SSH fallback
- [ ] Server registry and detail view with live charts/logs
- [ ] Threshold alert rules and notifications

## Phase 3 — Alerting & tiered remediation

- [ ] Rule/playbook engine with severity → autonomy mapping
- [ ] Approve-to-remediate flow and audit log
- [ ] "Investigate with Claude" delegation

## Phase 4 — Advanced UI & polish

- [ ] Topology map, war-room multi-pane, broadcast/swarm prompts
- [ ] Command palette, playbook visual editor, digests/quiet hours

## Phase 5 — Hardening & extensions

- [ ] RBAC / multi-user, per-session isolation
- [ ] Distributed workers, retention/rollups, backup/restore drills
