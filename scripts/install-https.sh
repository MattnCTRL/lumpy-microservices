#!/usr/bin/env bash
#
# Put Lumpy behind trusted HTTPS on the tailnet, for free, using the
# Tailscale-issued Let's Encrypt cert + the box's existing nginx. Lumpy is added
# as its OWN SNI vhost, so any other vhost on the box (e.g. vault.nublear.com) is
# left completely untouched. No paid CA, auto-renewing.
#
# Prereqs:
#   1. HTTPS Certificates enabled in the Tailscale admin console (DNS page).
#   2. The Lumpy web (:3000) + orchestrator (:4317) running on the bind address.
#   3. nginx installed and including /etc/nginx/conf.d/*.conf.
#
# Usage (on the box, as root):
#   LUMPY_TS_NAME=ubuntu-2gb-hil-1.tail83fdb2.ts.net bash scripts/install-https.sh
#
# After it runs, also point the orchestrator at the HTTPS origin and update the
# GitHub OAuth callback:
#   - systemd unit:  Environment=LUMPY_PUBLIC_URL=https://<name>
#   - .env:          LUMPY_WEB_URL=https://<name>
#   - GitHub OAuth app callback: https://<name>/api/auth/github/callback
#   then `systemctl daemon-reload` + redeploy.

set -euo pipefail

NAME="${LUMPY_TS_NAME:?set LUMPY_TS_NAME to the device MagicDNS name, e.g. ubuntu-2gb-hil-1.tail83fdb2.ts.net}"
BIND="${LUMPY_BIND:-$(tailscale ip -4 2>/dev/null | head -1)}"
[ -n "$BIND" ] || { echo "error: could not determine bind IP; set LUMPY_BIND" >&2; exit 1; }
echo "HTTPS for https://${NAME}  ->  web ${BIND}:3000 / orchestrator ${BIND}:4317"

# Issue (or renew) the Tailscale cert into a stable location.
install -d -m 700 /etc/lumpy-tls
tailscale cert --cert-file /etc/lumpy-tls/cert.pem --key-file /etc/lumpy-tls/key.pem "$NAME"

# A dedicated vhost matched by server_name; other vhosts are unaffected.
cat >/etc/nginx/conf.d/lumpy.conf <<EOF
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${NAME};

    ssl_certificate     /etc/lumpy-tls/cert.pem;
    ssl_certificate_key /etc/lumpy-tls/key.pem;
    client_max_body_size 25m;

    location /api {
        proxy_pass http://${BIND}:4317;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_read_timeout 300s;
    }
    location /ws {
        proxy_pass http://${BIND}:4317;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
    location = /enroll          { proxy_pass http://${BIND}:4317; proxy_set_header Host \$host; }
    location = /agent.mjs       { proxy_pass http://${BIND}:4317; proxy_set_header Host \$host; }
    location = /authorize-mount { proxy_pass http://${BIND}:4317; proxy_set_header Host \$host; }

    location / {
        proxy_pass http://${BIND}:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF

# Weekly auto-renew of the Tailscale cert + nginx reload (cert is ~90 days).
cat >/usr/local/bin/lumpy-renew-cert.sh <<EOF
#!/bin/sh
set -e
tailscale cert --cert-file /etc/lumpy-tls/cert.pem --key-file /etc/lumpy-tls/key.pem ${NAME}
nginx -t && nginx -s reload
EOF
chmod +x /usr/local/bin/lumpy-renew-cert.sh
printf '0 3 * * 1 root /usr/local/bin/lumpy-renew-cert.sh >> /var/log/lumpy-cert.log 2>&1\n' >/etc/cron.d/lumpy-cert

nginx -t && nginx -s reload
echo "HTTPS is live at https://${NAME}"
