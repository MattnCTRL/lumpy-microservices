# Configuration

Lumpy is configured through environment variables. Copy `.env.example` to `.env`
and adjust. The orchestrator reads its own variables; the web app reads the
`NEXT_PUBLIC_`-prefixed ones at build/runtime.

## Orchestrator

| Variable                | Default           | Description                                                                                                              |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `LUMPY_HOST`            | `127.0.0.1`       | Interface the orchestrator binds to. Bind to the Tailscale interface in production; never `0.0.0.0` on a public network. |
| `LUMPY_PORT`            | `4317`            | HTTP/WebSocket port.                                                                                                     |
| `LUMPY_DATA_DIR`        | `./data`          | Directory for the SQLite metadata database.                                                                              |
| `LUMPY_LOG_LEVEL`       | `info`            | Log level (`trace`, `debug`, `info`, `warn`, `error`).                                                                   |
| `LUMPY_TMUX_PREFIX`     | `lumpy`           | Prefix applied to every managed `tmux` session name.                                                                     |
| `LUMPY_DEFAULT_COMMAND` | `claude`          | Command launched in a new session when none is supplied.                                                                 |
| `LUMPY_WORKSPACE_ROOT`  | `~/`              | Root used to resolve relative workspace paths.                                                                           |
| `LUMPY_NTFY_URL`        | `https://ntfy.sh` | ntfy server used for push notifications.                                                                                 |
| `LUMPY_NTFY_TOPIC`      | _(empty)_         | ntfy topic. Empty disables notifications. Treat it as a secret.                                                          |
| `LUMPY_PUBLIC_URL`      | _(empty)_         | Tailnet-reachable base URL for notification links and approve/reject buttons.                                            |

## Web

| Variable                       | Default                 | Description                                       |
| ------------------------------ | ----------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | `http://127.0.0.1:4317` | Base URL the web app uses for REST and WebSocket. |

## Notes

- `.env` is git-ignored. Only `.env.example` is committed.
- Production secrets (SSH keys, agent tokens, auth secrets) are out of scope for
  the current build and will be managed by a secrets manager, not `.env`. See
  [security.md](security.md).
