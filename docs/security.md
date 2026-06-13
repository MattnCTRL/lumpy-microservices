# Security

Lumpy runs code and is designed to operate on remote infrastructure. Its
security posture is therefore conservative. This document describes the model;
items marked _planned_ are specified but not yet implemented.

## Network posture

- **Private by default.** The orchestrator is intended to bind to a Tailscale /
  WireGuard interface and never to a public network. `LUMPY_HOST` controls the
  bind address; do not set it to `0.0.0.0` on a public host.
- **No public control ingress.** All control actions (creating sessions,
  sending input, future remediation) require being on the private mesh.

## Authentication (planned)

- OIDC + WebAuthn/passkeys for device login.
- Short-lived API tokens for programmatic access.
- Role-based access (`owner` / `operator` / `viewer`) with per-action scopes,
  so the system can support multiple operators without widening blast radius.

## Session execution

- Sessions can run as a dedicated **non-root user** (`LUMPY_SESSION_USER`). The
  orchestrator stays root but spawns each session as that user, so autonomous
  Claude is confined to that user's home with no `sudo` — anything requiring root
  requires you. This is the recommended setup; see [deploy.md](deploy.md).
- **Autonomous sessions** run commands without prompting
  (`--dangerously-skip-permissions`). Only point them at trusted workspaces, and
  run them as the non-root session user.
- Further isolation per session (containers) remains on the roadmap.

## Remediation autonomy (planned)

Automated remediation is tiered by severity:

| Severity                | Behavior                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| info                    | Log only.                                                               |
| warning                 | Notify; auto-run only allow-listed safe playbooks.                      |
| critical                | Notify with one-tap approval; auto-run only if explicitly allow-listed. |
| emergency / destructive | Always require explicit confirmation. Never auto.                       |

Every action is recorded in an append-only audit log.

## Notifications

Push notifications go through ntfy. On the public `ntfy.sh`, the **topic name is
the only access control** — anyone who knows it can read and publish. Use a long,
random topic and treat it as a secret, or self-host ntfy on the tailnet for
sensitive context. Approve/reject action buttons call the orchestrator's input
endpoint, so they only function from a device on the tailnet. See
[notifications.md](notifications.md).

## SSH credentials

Agentless monitoring stores each server's SSH credentials (private key or
password) in the orchestrator's `fleet.db` so it can poll on a schedule. They are
currently stored unencrypted, so the orchestrator host must be treated as trusted
infrastructure on the private network. Encryption at rest (and using a dedicated,
least-privilege SSH key per server) is planned. Prefer keys over passwords.

## Secrets

- `.env` is git-ignored; only `.env.example` is committed.
- Production secrets will be held in a secrets manager (SOPS+age or similar),
  never in the database in plaintext, and agents will authenticate over mTLS on
  the tailnet.

## Reporting

This is a personal project under active development. Do not expose it to the
public internet. If you find a security issue, open a private report on the
GitHub repository.
