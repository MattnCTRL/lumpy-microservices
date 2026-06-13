# Remediation

The `remediation` module closes Lumpy's loop: when an alert fires, it can spin up
an **autonomous Claude session** to investigate — and, optionally, fix — the
problem, then notify you. This is Lumpy acting on your behalf.

## Modes

Set `LUMPY_REMEDIATION_MODE`:

| Mode            | Behavior                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `off` (default) | Alerts notify only; no session is started.                                                                        |
| `investigate`   | On each alert, start an autonomous session that diagnoses the cause and reports — **makes no changes**.           |
| `auto`          | The session investigates **and** remediates if the fix is safe and non-destructive, then reports what it changed. |

One session is started per active alert and not repeated; the lock clears when the
alert resolves.

## How it works

1. The module subscribes to `alert.fired`.
2. It creates an autonomous session (`apps/orchestrator/src/remediation/`) whose
   task is pre-loaded with the alert (server, severity, message) and instructions
   scoped to the mode.
3. It publishes `remediation.started`, which `notify` turns into a push so you
   know Lumpy is on it, with a link to the session.
4. You can open the session anytime to watch, steer, or stop it.

## Safety

- Remediation sessions run as the **non-root session user**
  (`LUMPY_SESSION_USER`), so they cannot perform root actions — anything
  requiring root needs you. See [security.md](security.md).
- `investigate` is read-only by instruction; `auto` is told to avoid destructive
  or irreversible actions and to stop and report instead.
- Tiered policy by severity (auto for low-risk, approve for critical) is a planned
  refinement of the spec's §4.3 model.

## Trying it

Set `LUMPY_REMEDIATION_MODE=investigate` in the orchestrator environment and
restart. The next alert spawns an investigation session (visible in the Sessions
tab and pushed to your phone).
