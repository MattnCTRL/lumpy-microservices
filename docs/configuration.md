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

## Sessions & remediation

| Variable                          | Default       | Description                                                                                      |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `LUMPY_SESSION_USER`              | _(empty)_     | OS user to run sessions as (non-root sandboxing). Empty = the orchestrator's own user.           |
| `LUMPY_REMEDIATION_MODE`          | `off`         | `off`, `investigate` (diagnose only), or `auto` (also fix). Live-editable from Settings.          |
| `LUMPY_REMEDIATION_AUTO_SEVERITIES` | `warning`   | Comma-separated severities that remediate automatically; others need one-tap approval.           |

## Authentication (Sign in with GitHub)

| Variable                     | Default   | Description                                                                                       |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `LUMPY_GITHUB_CLIENT_ID`     | _(empty)_ | GitHub OAuth app Client ID (starts with `Ov23li…`). Empty = sign-in disabled.                     |
| `LUMPY_GITHUB_CLIENT_SECRET` | _(empty)_ | GitHub OAuth app client secret. Treat as a secret.                                                |
| `LUMPY_WEB_URL`              | _(empty)_ | Web UI URL to return to after sign-in.                                                            |
| `LUMPY_AUTH_SECRET`          | _(random)_ | Secret for signing auth cookies. Set it to stay signed in across restarts.                       |
| `LUMPY_REQUIRE_AUTH`         | `false`   | Opt-in: require a signed-in user for the API. Only enforced when sign-in is also configured.       |
| `LUMPY_ADMIN_LOGINS`         | _(empty)_ | Comma-separated GitHub logins with the admin role. Empty = everyone who signs in is an admin.      |

## Web

| Variable                       | Default                 | Description                                       |
| ------------------------------ | ----------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | `http://127.0.0.1:4317` | Base URL the web app uses for REST and WebSocket. |

## Notes

- Put `.env` at the **repository root** (`cp .env.example .env`). The orchestrator
  loads it automatically on startup; real environment variables take precedence,
  so `LUMPY_HOST=0.0.0.0 npm run dev` also works without a file.
- `.env` is git-ignored. Only `.env.example` is committed.
- Production secrets (SSH keys, agent tokens, auth secrets) are out of scope for
  the current build and will be managed by a secrets manager, not `.env`. See
  [security.md](security.md).
