# Deploying Lumpy (always-on)

Run the orchestrator and web UI on an always-on Debian/Ubuntu host (e.g. a
Hetzner box) so Lumpy is reachable from your devices over Tailscale without your
laptop needing to be on.

## What the deploy does

`scripts/install-orchestrator.sh` (run as root on the target box):

- adds 2 GB swap if none (so the web build doesn't OOM on small boxes),
- installs Node 20, build tools, `git`, and `tmux`,
- clones the repo to `/opt/lumpy` and installs dependencies,
- builds the web UI with the orchestrator URL baked to the host's tailnet IP,
- installs two systemd services bound to the **Tailscale IP only**
  (`lumpy-orchestrator` on `:4317`, `lumpy-web` on `:3000`) — never the public
  internet,
- enables them to start on boot and restart on failure.

It leaves any existing services (nginx, other apps) untouched.

## One command

On the box (it must already be on your tailnet):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/MattnCTRL/lumpy-microservices/main/scripts/install-orchestrator.sh)
```

By default it binds to the host's `tailscale ip -4`. Override with
`LUMPY_BIND=<ip>`.

## After deploy

- Open the UI from any tailnet device: `http://<tailnet-ip>:3000`.
- Point a browser bookmark / phone home-screen shortcut at that URL.
- Logs: `journalctl -u lumpy-orchestrator -u lumpy-web -f`.
- Update to the latest code: re-run the script (it pulls and rebuilds).

## Notes

- The deployed orchestrator has its own `data/` (separate from any local dev
  instance). Add servers and sessions against the deployed one.
- To run **Claude Code** sessions on the box, install and authenticate the
  `claude` CLI for the service user (see [getting-started.md](getting-started.md)
  and [security.md](security.md)). Monitoring and `bash` sessions work without it.
- Notifications: set `LUMPY_NTFY_TOPIC` (and `LUMPY_PUBLIC_URL`) in the
  `lumpy-orchestrator` service environment to enable ntfy push.
