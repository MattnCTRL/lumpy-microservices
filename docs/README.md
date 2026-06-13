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
| [fleet.md](fleet.md)                               | Remote server registry, metrics ingestion, and status.  |
| [modules.md](modules.md)                           | The module/extension contract for adding bespoke tools. |
| [api.md](api.md)                                   | REST and WebSocket surface of the orchestrator.         |
| [configuration.md](configuration.md)               | Environment variables and runtime options.              |
| [security.md](security.md)                         | Access model, network posture, and hardening.           |
| [roadmap.md](roadmap.md)                           | Phased delivery plan and current status.                |
| [documentation-policy.md](documentation-policy.md) | How docs, notes, and code stay separated and clean.     |

## Maintenance

Documentation is part of "done." When a change alters behavior, an interface,
or the way the system is operated, update the relevant document in the same
change set. The [documentation policy](documentation-policy.md) explains what
belongs here versus in the (untracked) working notes.
