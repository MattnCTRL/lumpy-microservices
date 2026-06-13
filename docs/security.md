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

- Session commands run with the orchestrator's user, environment, and
  permissions. Treat the orchestrator host as trusted infrastructure.
- Isolation per session (containers / restricted users) is on the roadmap.

## Remediation autonomy (planned)

Automated remediation is tiered by severity:

| Severity                | Behavior                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| info                    | Log only.                                                               |
| warning                 | Notify; auto-run only allow-listed safe playbooks.                      |
| critical                | Notify with one-tap approval; auto-run only if explicitly allow-listed. |
| emergency / destructive | Always require explicit confirmation. Never auto.                       |

Every action is recorded in an append-only audit log.

## Secrets

- `.env` is git-ignored; only `.env.example` is committed.
- Production secrets will be held in a secrets manager (SOPS+age or similar),
  never in the database in plaintext, and agents will authenticate over mTLS on
  the tailnet.

## Reporting

This is a personal project under active development. Do not expose it to the
public internet. If you find a security issue, open a private report on the
GitHub repository.
