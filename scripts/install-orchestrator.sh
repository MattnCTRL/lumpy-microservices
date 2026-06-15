#!/usr/bin/env bash
#
# Deploys the Lumpy orchestrator + web UI on a Debian/Ubuntu host as systemd
# services, bound to the host's Tailscale IP (never the public internet). Run as
# root on the box you want Lumpy to live on.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/MattnCTRL/lumpy-microservices/main/scripts/install-orchestrator.sh)
#
# Override the bind address with LUMPY_BIND=<ip>; by default it uses the
# host's Tailscale IPv4.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (use sudo)" >&2
  exit 1
fi

INSTALL_DIR="${LUMPY_DIR:-/opt/lumpy}"
REPO="${LUMPY_REPO:-https://github.com/MattnCTRL/lumpy-microservices.git}"
BIND="${LUMPY_BIND:-$(tailscale ip -4 2>/dev/null | head -1)}"

if [ -z "$BIND" ]; then
  echo "error: could not determine a bind address. Install Tailscale or set LUMPY_BIND=<ip>" >&2
  exit 1
fi
echo "Binding Lumpy to ${BIND} (tailnet only)"

# Swap so the web build does not OOM on small (<=2GB) boxes.
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q "/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >>/etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential python3 git tmux ca-certificates curl >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm install --no-audit --no-fund
# Build WITHOUT baking the orchestrator URL: the web derives it from the page host
# at runtime, so a Tailscale IP change or MagicDNS switch never strands the client.
npm run build -w @lumpy/web
mkdir -p "$INSTALL_DIR/data"

# Persist a stable auth-cookie secret so sign-in survives restarts. Without it the
# secret is random per boot and every deploy/reboot logs the operator out.
ENV_FILE="$INSTALL_DIR/.env"
touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
if ! grep -q '^LUMPY_AUTH_SECRET=' "$ENV_FILE"; then
  # Capture first so a node failure can't write an empty value (which set -u won't
  # catch inside a command substitution, and the anchored guard would never repair).
  SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  if [ -n "$SECRET" ]; then
    echo "LUMPY_AUTH_SECRET=$SECRET" >>"$ENV_FILE"
  else
    echo "warning: could not generate LUMPY_AUTH_SECRET; set it manually in $ENV_FILE" >&2
  fi
fi

cat >/etc/systemd/system/lumpy-orchestrator.service <<EOF
[Unit]
Description=Lumpy orchestrator
After=network-online.target
Wants=network-online.target

[Service]
Environment=NODE_ENV=production
Environment=LUMPY_HOST=${BIND}
Environment=LUMPY_PORT=4317
Environment=LUMPY_DATA_DIR=${INSTALL_DIR}/data
Environment=LUMPY_PUBLIC_URL=http://${BIND}:4317
# Admission control so a storm of alerts/schedules/derives can't fan out enough
# Claude processes to OOM this small box. MemAvailable (/proc/meminfo) is accurate
# here, unlike on macOS, so the free-memory guard is enabled. Tune for box size.
Environment=LUMPY_MAX_SESSIONS=${LUMPY_MAX_SESSIONS:-5}
Environment=LUMPY_MIN_FREE_MEMORY_MB=${LUMPY_MIN_FREE_MEMORY_MB:-350}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/npm run start -w @lumpy/orchestrator
Restart=always
RestartSec=5
# Soft memory pressure: reclaim before the kernel OOM-kills. Accounting lets the
# box-level limit apply to the orchestrator and the tmux/Claude processes it owns.
MemoryAccounting=yes
MemoryHigh=${LUMPY_MEMORY_HIGH:-1500M}

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/lumpy-web.service <<EOF
[Unit]
Description=Lumpy web UI
After=network-online.target lumpy-orchestrator.service
Wants=network-online.target

[Service]
Environment=NODE_ENV=production
WorkingDirectory=${INSTALL_DIR}/apps/web
ExecStart=${INSTALL_DIR}/node_modules/.bin/next start -H ${BIND} -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now lumpy-orchestrator lumpy-web

echo
echo "Lumpy is running:"
echo "  UI:           http://${BIND}:3000"
echo "  Orchestrator: http://${BIND}:4317"
echo "  Logs:         journalctl -u lumpy-orchestrator -u lumpy-web -f"
echo
echo "To update later: re-run this script (it pulls and rebuilds)."
