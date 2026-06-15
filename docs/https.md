# HTTPS on the tailnet

Lumpy is served over trusted HTTPS on the box using the **Tailscale-issued
Let's Encrypt certificate** for the box's MagicDNS name, terminated by the box's
existing **nginx**. It is free (no paid CA), auto-renewing, and trusted by every
device on the tailnet with no per-device cert install.

- URL: `https://<device>.<tailnet>.ts.net` (e.g. `https://ubuntu-2gb-hil-1.tail83fdb2.ts.net`)
- nginx adds a dedicated `server` block matched by `server_name` (SNI), so any
  other vhost on the box (e.g. `vault.nublear.com`) is untouched.
- `/` proxies to the web (`:3000`); `/api`, `/ws`, and the agent bootstrap paths
  (`/enroll`, `/agent.mjs`, `/authorize-mount`) proxy to the orchestrator
  (`:4317`) under the one HTTPS origin. The web calls the API same-origin when
  loaded over HTTPS (see `apps/web/src/lib/api.ts`).
- The direct `:3000`/`:4317` ports still listen over plain HTTP on the tailnet,
  so existing agents (which post to the baked-in `http://<ip>:4317`) keep working.

## Setup / rebuild

1. Enable **HTTPS Certificates** in the Tailscale admin console (DNS page). One time.
2. On the box: `LUMPY_TS_NAME=<device>.<tailnet>.ts.net bash scripts/install-https.sh`
   (provisions the cert, writes `/etc/nginx/conf.d/lumpy.conf`, installs a weekly
   cert-renewal cron, and reloads nginx).
3. Point the orchestrator at the HTTPS origin and redeploy:
   - systemd unit: `Environment=LUMPY_PUBLIC_URL=https://<name>`
   - `.env`: `LUMPY_WEB_URL=https://<name>`
   - `systemctl daemon-reload`, then `scripts/safe-deploy.sh`.
4. Update the GitHub OAuth app's **Authorization callback URL** to
   `https://<name>/api/auth/github/callback`.

Renewal is handled by `/usr/local/bin/lumpy-renew-cert.sh` via `/etc/cron.d/lumpy-cert`
(weekly): it re-runs `tailscale cert` and reloads nginx.

## Why not a bare-IP cert or a paid service

Let's Encrypt won't issue for a bare IP, and the box's plain-HTTP tailnet origin
isn't a secure context (so the PWA wouldn't install). The Tailscale MagicDNS name
gives a real, free, browser-trusted cert with auto-renewal - the same CA, no cost,
riding the Tailscale mesh already in use.
