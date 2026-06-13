# Fleet Monitoring

The `fleet` module turns Lumpy into a monitor for remote servers: a registry of
machines, ingestion of their metrics/heartbeats, and live online/offline status.
It is a self-contained module (see [modules.md](modules.md)) that owns the
`/api/fleet` and `/ws/fleet` namespaces and its own `fleet.db` store.

## Model

- **Server registry** — each server has a name, address (a Tailscale IP/hostname
  in production), tags, environment (`prod`/`staging`/`dev`), and criticality
  (`low`/`medium`/`high`). Stored in SQLite.
- **Metrics** — agents push periodic samples (CPU, memory, disk, 1-minute load,
  uptime). The latest sample and a bounded in-memory history are kept per server.
  Long-term time-series storage is a later phase.
- **Status** — derived, never stored as truth:
  - `online` — a metrics report arrived within the heartbeat window (30s).
  - `offline` — no report within the window (a checker flips it every 10s).
  - `unknown` — registered but never reported (or not yet seen since restart).

Status and metrics changes are published on the [event spine](session-engine.md#event-spine)
as `fleet.server.status` and `fleet.metrics`, streamed to clients over
`/ws/fleet`.

## Reporting metrics

An agent (or any caller on the private network) posts samples:

```bash
curl -X POST http://orchestrator:4317/api/fleet/servers/<id>/metrics \
  -H 'content-type: application/json' \
  -d '{"cpuPercent":23.5,"memPercent":61,"diskPercent":48,"load1":0.7,"uptimeSeconds":86400}'
```

The orchestrator stamps the timestamp, updates the server's status to `online`,
and publishes the events. See [api.md](api.md#fleet) for the full surface.

## Trying it without a real host

Register a server in the **Fleet** tab of the web UI (or via the API), then run
the demo agent against its id to stream synthetic metrics:

```bash
node scripts/demo-agent.mjs <serverId> --interval 1500
```

The server flips to `online` and its metric cards and sparklines update live.
This is a development helper, not the production agent.

## Roadmap

This is the ingestion and status core. Still ahead (see [roadmap.md](roadmap.md)):

- **`lumpy-agent`** — a small binary that collects and pushes metrics, with an
  agentless SSH fallback for hosts where nothing can be installed.
- **Ingestion auth** — token / mTLS over the tailnet. The current endpoint
  trusts the private network; do not expose it publicly.
- **Web UI** — server list, detail with live charts, and the topology map.
- **Alerts & remediation** — rules over these metrics feed the `alerts` and
  `remediation` modules.
