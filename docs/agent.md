# lumpy-agent

`@lumpy/agent` (`apps/agent`) is the metrics collector that runs on a monitored
host and pushes samples to the orchestrator's fleet ingestion endpoint. This is
the Node implementation (v0); a small static binary is a later optimization
(see [roadmap.md](roadmap.md)).

## What it collects

Every interval it samples and reports:

- **CPU %** — busy share computed from `os.cpus()` tick deltas between samples.
- **Memory %** — used / total from `os.totalmem()` and `os.freemem()`.
- **Disk %** — usage of the filesystem at `LUMPY_DISK_PATH` via `df`.
- **Load (1m)** — `os.loadavg()[0]`.
- **Uptime** — `os.uptime()`.

## Running

```bash
LUMPY_URL=http://orchestrator:4317 npm run start -w @lumpy/agent
```

On first run with no server id, the agent **self-registers** using the host's
name and primary IPv4 address, then saves the assigned id to
`~/.lumpy/agent.json` (keyed by orchestrator URL) so restarts reuse it. If the
server is later removed upstream, the agent re-registers automatically.

To bind to an existing server entry instead, set `LUMPY_SERVER_ID`.

## Configuration

| Variable               | Default                 | Description                                                                  |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `LUMPY_URL`            | `http://127.0.0.1:4317` | Orchestrator base URL (a Tailscale address in production).                   |
| `LUMPY_SERVER_ID`      | _(unset)_               | Bind to a specific server id; disables self-registration and the state file. |
| `LUMPY_AGENT_INTERVAL` | `5000`                  | Reporting interval in milliseconds.                                          |
| `LUMPY_AGENT_NAME`     | hostname                | Name used when self-registering.                                             |
| `LUMPY_DISK_PATH`      | `/`                     | Filesystem to report disk usage for.                                         |

## Deploying

On a server reachable over the tailnet, run the agent under a process manager so
it restarts on boot. A systemd unit recipe will accompany the deployment guide.
Until ingestion auth lands, only run the agent on hosts that reach the
orchestrator over the private network — see [security.md](security.md).
