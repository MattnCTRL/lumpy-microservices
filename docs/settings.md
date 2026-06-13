# Settings

The **Settings** page (gear icon in the header, `/settings`) is the home for
runtime configuration and a system overview. It groups:

- **Account** — GitHub sign-in status; sign in / sign out (see [auth.md](auth.md)).
- **Remediation** — the live policy (see [remediation.md](remediation.md)):
  - **Mode:** off / investigate / auto.
  - **Auto-remediate severities:** which severities run without approval; the rest
    require one-tap approval.
  - Changes apply immediately (no restart) and persist to `data/settings.json`.
- **Notifications** — ntfy status, topic, and server (read-only; configured via
  env).
- **System** — version, session user, workspace root, default command, public
  URL, and the loaded modules.

## Runtime vs env

Secrets and bindings (GitHub secret, host/port, ntfy topic, session user) are set
via environment for safety and read at startup. Operational toggles that are safe
to change live — currently the remediation policy — are editable on this page and
persisted to `data/settings.json`, which then takes precedence over the env
defaults on the next start.

## API

- `GET /api/settings` — current settings + system overview.
- `PATCH /api/settings` — update `remediationMode` and/or
  `remediationAutoSeverities`.
