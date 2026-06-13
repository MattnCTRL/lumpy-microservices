#!/usr/bin/env bash
#
# Installs the Lumpy self-healing layer on the box (run as root):
#   - the lumpy-supervisor watchdog systemd service
#   - a SCOPED sudoers rule letting the non-root session user run ONLY
#     safe-deploy.sh as root (so the Conductor can self-update, nothing else)
#   - seeds the last-known-good commit

set -euo pipefail

DIR="${LUMPY_DIR:-/opt/lumpy}"
SU="${LUMPY_SESSION_USER:-lumpy}"

[ "$(id -u)" -eq 0 ] || { echo "error: run as root" >&2; exit 1; }

chmod +x "$DIR/scripts/safe-deploy.sh" "$DIR/scripts/lumpy-supervisor.sh"

# The ONE privileged action the session user (Conductor) is granted.
echo "$SU ALL=(root) NOPASSWD: $DIR/scripts/safe-deploy.sh" >/etc/sudoers.d/lumpy-deploy
chmod 440 /etc/sudoers.d/lumpy-deploy
visudo -cf /etc/sudoers.d/lumpy-deploy >/dev/null

# Seed last-known-good with the current commit.
mkdir -p "$DIR/data"
git -C "$DIR" rev-parse HEAD >"$DIR/data/.last-good-commit"

cat >/etc/systemd/system/lumpy-supervisor.service <<EOF
[Unit]
Description=Lumpy supervisor (self-healing watchdog)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=-$DIR/.env
ExecStart=/usr/bin/env bash $DIR/scripts/lumpy-supervisor.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now lumpy-supervisor

echo "Installed lumpy-supervisor + scoped sudoers (safe-deploy.sh) for user '$SU'."
echo "  watchdog: systemctl status lumpy-supervisor"
echo "  deploy:   sudo $DIR/scripts/safe-deploy.sh [pull]"
