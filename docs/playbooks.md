# Playbooks

Playbooks are vetted, reusable instructions for handling specific alerts. When the
[remediation loop](remediation.md) spawns a Claude session for an alert, it uses
the matching playbook's instruction instead of a generic prompt — so the response
is consistent and scoped, not improvised each time.

## How matching works

Each playbook lists the alert rule ids it covers. When an alert fires, Lumpy
finds the playbook whose `ruleIds` include the alert's rule and uses its `task` as
the session's instruction. The remediation **mode** still controls whether
changes are allowed (investigate = report only; auto = fix if safe). A playbook
can set `requiresApproval` to always need one-tap approval regardless of the
severity policy.

## Built-in playbooks

| Playbook      | Alerts                      | What it does                                                                                      |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Disk cleanup  | disk-critical, disk-warning | Find space hogs and reclaim only clearly-safe space (caches, old logs, temp). Never touches data. |
| CPU triage    | cpu-warning                 | Identify the top CPU processes; restart only an obviously stuck, safe-to-restart one.             |
| Memory triage | mem-critical, mem-warning   | Identify top memory consumers; restart a clearly leaking, restartable service only if safe.       |
| Offline check | offline                     | Diagnose why a server stopped reporting (connectivity, agent) — no changes.                       |

Defined in `apps/orchestrator/src/remediation/playbooks.ts`. They appear on the
**Settings** page. A user-editable playbook store (custom steps, per-server
overrides) is a planned extension.

## API

- `GET /api/playbooks` — list the built-in playbooks.
