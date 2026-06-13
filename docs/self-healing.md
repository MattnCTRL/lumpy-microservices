# Self-healing deploys

Lumpy can change its own code (via the Conductor) without risking the platform.
Two cooperating pieces make a self-restart safe.

## safe-deploy.sh

`scripts/safe-deploy.sh` is the controlled deploy pipeline. Run on the box:

```bash
sudo /opt/lumpy/scripts/safe-deploy.sh [pull]
```

It:

1. Snapshots the last-known-good commit.
2. Optionally `pull`s `origin/main` (otherwise deploys the working tree).
3. **Typechecks and builds** — a build failure rolls back *before* any restart,
   so broken code never runs.
4. Restarts the services and **health-checks** for ~60s.
5. On success, records the new commit as last-good. On failure, resets to the
   snapshot, rebuilds, restarts, and sends an ntfy alert.

## lumpy-supervisor

`scripts/lumpy-supervisor.sh` runs as its own systemd service **outside** the
orchestrator, so it survives the orchestrator dying. It:

- records the running commit as last-good while Lumpy is healthy and stable, and
- if Lumpy stays unhealthy too long (a crash-loop the deploy script didn't
  catch), resets to last-good, rebuilds, restarts, and alerts.

It stands down while a `.deploying` lock exists so it never fights an in-progress
`safe-deploy.sh`.

## Install

```bash
sudo /opt/lumpy/scripts/install-supervisor.sh
```

This installs the watchdog service and a **scoped sudoers** rule that lets the
non-root session user run *only* `safe-deploy.sh` as root — so the Conductor can
self-update and do nothing else privileged. State lives in `data/`
(`.last-good-commit`, `.deploying`, `deploy.log`, `supervisor.log`).
