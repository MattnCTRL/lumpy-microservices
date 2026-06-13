# Alerts

The `alerts` module watches fleet metrics and raises alerts when thresholds are
crossed, publishing `alert.fired` / `alert.resolved` on the event spine. The
`notify` module turns those into ntfy push notifications, so a problem on any
monitored server reaches your phone.

## How it works

- Subscribes to `fleet.metrics` and `fleet.server.status` events.
- Evaluates a set of threshold rules per server. For a given metric only the
  **most severe breached tier** fires (e.g. disk at 92% raises `critical`, not
  both `critical` and `warning`).
- Rules can require several consecutive samples before firing (debounce), so a
  brief spike does not page you.
- An alert is **edge-triggered**: it fires once on the transition into a bad
  state and resolves once the metric returns to normal — no repeat spam.
- A server going offline raises a `critical` alert that resolves when it returns.

## Default rules

| Rule               | Condition                | Severity |
| ------------------ | ------------------------ | -------- |
| Disk almost full   | disk ≥ 90%               | critical |
| Disk filling up    | disk ≥ 80%               | warning  |
| Memory critical    | memory ≥ 95% (2 samples) | critical |
| Memory high        | memory ≥ 90% (2 samples) | warning  |
| CPU sustained high | cpu ≥ 90% (3 samples)    | warning  |
| Server offline     | no heartbeat in 30s      | critical |

Rules live in `apps/orchestrator/src/alerts/rules.ts`. A UI rule editor is on the
roadmap; for now adjust the defaults there.

## Notifications

`alert.fired` pushes with priority by severity (critical → max, warning →
default) and a deep link to the Alerts view; `alert.resolved` sends a quiet
"cleared" notice. Configure ntfy as described in
[notifications.md](notifications.md).

## API

- `GET /api/alerts` — current active alerts.
- `GET /ws/alerts` — live stream of `alert.fired` / `alert.resolved`.

The web UI shows an **Alerts** tab with a live count badge and the active list.

## Next

Threshold alerts are the trigger layer for the tiered **remediation** described
in [spec.md](spec.md) §4.3 — low-risk issues auto-fixed, others one-tap
approved from your phone. That builds on these events.
