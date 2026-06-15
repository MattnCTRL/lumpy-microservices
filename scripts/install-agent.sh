#!/usr/bin/env bash
#
# Installs the Lumpy metrics agent on a Debian/Ubuntu host as a systemd
# service, so it reports CPU/memory/disk/load to your orchestrator and
# restarts automatically on failure or reboot.
#
# Usage (run as root on the server you want to monitor):
#   LUMPY_URL=http://<orchestrator-tailnet-ip>:4317 bash install-agent.sh
#
# The orchestrator must be reachable from this host - put both on the same
# Tailscale tailnet and use the orchestrator's tailnet IP.

set -euo pipefail

LUMPY_URL="${LUMPY_URL:-}"
INSTALL_DIR="${LUMPY_DIR:-/opt/lumpy}"
REPO="${LUMPY_REPO:-https://github.com/MattnCTRL/lumpy-microservices.git}"

if [ -z "$LUMPY_URL" ]; then
  echo "error: set LUMPY_URL=http://<orchestrator-tailnet-ip>:4317" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (use sudo)" >&2
  exit 1
fi

# Node.js 20+
node_major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//' || echo 0)"
if [ "${node_major:-0}" -lt 20 ]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v git >/dev/null 2>&1 || apt-get install -y git

# Fetch or update the repo
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
# Only the agent workspace - avoids building the orchestrator's native deps.
npm install -w @lumpy/agent --no-audit --no-fund

cat >/etc/systemd/system/lumpy-agent.service <<EOF
[Unit]
Description=Lumpy metrics agent
After=network-online.target
Wants=network-online.target

[Service]
Environment=LUMPY_URL=${LUMPY_URL}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/npm run start -w @lumpy/agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now lumpy-agent

echo
echo "Lumpy agent installed and running."
echo "  status: systemctl status lumpy-agent"
echo "  logs:   journalctl -u lumpy-agent -f"
