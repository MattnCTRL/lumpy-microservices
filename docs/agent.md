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

## Monitoring a Mac (or any non-Linux machine)

The agent is cross-platform (it uses Node's `os` module + `df`), so it monitors
macOS too — unlike the SSH path, which reads Linux `/proc`.

**One-command install (recommended).** On the Mac (which must be on the same
tailnet as the orchestrator, with Node 20+ and git installed), run the macOS
installer. It clones the repo to `~/.lumpy`, installs the agent, and registers a
launchd agent (`com.lumpy.agent`, RunAtLoad + KeepAlive):

```bash
LUMPY_AGENT_NAME="My MacBook" \
  bash <(curl -fsSL https://raw.githubusercontent.com/MattnCTRL/lumpy-microservices/main/scripts/install-agent-mac.sh)
```

`LUMPY_URL` defaults to the box (`http://100.81.90.46:4317`); override it if your
orchestrator differs. `LUMPY_AGENT_NAME` defaults to the Mac's name. Re-run any
time to update. Uninstall with
`launchctl unload ~/Library/LaunchAgents/com.lumpy.agent.plist`.

A laptop shows `online` while awake and goes `offline` when it sleeps, as
expected.

## Deploying to a server (one command)

On a Debian/Ubuntu host that is on the same Tailscale tailnet as the
orchestrator, run the installer as root. It installs Node if needed, fetches the
agent, and registers a systemd service that restarts on failure and boot:

```bash
LUMPY_URL=http://<orchestrator-tailnet-ip>:4317 \
  bash <(curl -fsSL https://raw.githubusercontent.com/MattnCTRL/lumpy-microservices/main/scripts/install-agent.sh)
```

Then:

```bash
systemctl status lumpy-agent     # confirm it's running
journalctl -u lumpy-agent -f     # follow its logs
```

The server self-registers and appears in the Fleet tab as `online`. The
orchestrator must be reachable from the host — keep both on the tailnet and use
the orchestrator's tailnet IP. Until ingestion auth lands, only run the agent on
hosts that reach the orchestrator over the private network — see
[security.md](security.md).
