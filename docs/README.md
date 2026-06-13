# Lumpy Documentation

Technical documentation for Lumpy Micro Services. These documents are committed
and maintained alongside the code — keep them current as the system evolves.

## Index

| Document                                           | What it covers                                          |
| -------------------------------------------------- | ------------------------------------------------------- |
| [spec.md](spec.md)                                 | Full product & system specification (the north star).   |
| [architecture.md](architecture.md)                 | How the running system fits together.                   |
| [getting-started.md](getting-started.md)           | Install, configure, and run locally.                    |
| [session-engine.md](session-engine.md)             | How `tmux` + PTY session orchestration works.           |
| [connectors.md](connectors.md)                     | Per-session data sources: MCP servers, secrets, repo.   |
| [playbooks.md](playbooks.md)                       | Vetted, reusable remediation instructions per alert.    |
| [remediation.md](remediation.md)                   | Alert-triggered autonomous investigation/fixing.        |
| [alerts.md](alerts.md)                             | Metric threshold alerts feeding notifications.          |
| [fleet.md](fleet.md)                               | Remote server registry, metrics ingestion, and status.  |
| [agent.md](agent.md)                               | The metrics-collecting agent that runs on a host.       |
| [notifications.md](notifications.md)               | Push notifications (ntfy) and phone approve/reject.     |
| [modules.md](modules.md)                           | The module/extension contract for adding bespoke tools. |
| [api.md](api.md)                                   | REST and WebSocket surface of the orchestrator.         |
| [configuration.md](configuration.md)               | Environment variables and runtime options.              |
| [settings.md](settings.md)                         | The Settings page: runtime config + system overview.    |
| [auth.md](auth.md)                                 | Sign in with GitHub and profile mirroring.              |
| [security.md](security.md)                         | Access model, network posture, and hardening.           |
| [deploy.md](deploy.md)                             | Deploy Lumpy always-on on a tailnet host.               |
| [self-healing.md](self-healing.md)                 | Safe self-restart: validated deploys + rollback watchdog. |
| [sshfs.md](sshfs.md)                               | Edit a Mac's files from a box session over the tailnet. |
| [roadmap.md](roadmap.md)                           | Phased delivery plan and current status.                |
| [documentation-policy.md](documentation-policy.md) | How docs, notes, and code stay separated and clean.     |

## Maintenance

Documentation is part of "done." When a change alters behavior, an interface,
or the way the system is operated, update the relevant document in the same
change set. The [documentation policy](documentation-policy.md) explains what
belongs here versus in the (untracked) working notes.
