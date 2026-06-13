#!/usr/bin/env bash
#
# Installs a systemd service that keeps a Mac's files mounted on the box over
# the tailnet, surviving reboots and reconnecting when the Mac wakes from sleep.
# This is the always-on counterpart to mount-mac.sh (which is a one-shot mount).
#
# Prerequisites (same as mount-mac.sh): Remote Login enabled on the Mac and the
# box's key (/root/.ssh/lumpy_mac_mount.pub) in the Mac's authorized_keys. Run
# mount-mac.sh once first to create the key and confirm connectivity.
#
# Usage (on the box, as root):
#   MAC_HOST=100.125.22.103 MAC_USER=matthewwhiteman bash install-mac-mount.sh
#
# Optional: MAC_PATH, NAME, SESSION_USER (see mount-mac.sh).
#
# Remove with:
#   systemctl disable --now lumpy-mac-mount && rm /etc/systemd/system/lumpy-mac-mount.service

set -euo pipefail

MAC_HOST="${MAC_HOST:-}"
MAC_USER="${MAC_USER:-}"
MAC_PATH="${MAC_PATH:-}"
SESSION_USER="${SESSION_USER:-lumpy}"
NAME="${NAME:-${MAC_HOST//[.:]/-}}"
KEY="/root/.ssh/lumpy_mac_mount"

if [ -z "$MAC_HOST" ] || [ -z "$MAC_USER" ]; then
  echo "error: set MAC_HOST=<tailnet-ip> and MAC_USER=<mac-login>" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (use sudo)" >&2
  exit 1
fi
if [ ! -f "$KEY" ]; then
  echo "error: $KEY not found — run mount-mac.sh once first to create it" >&2
  exit 1
fi
command -v sshfs >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y sshfs; }
grep -qs '^user_allow_other' /etc/fuse.conf || echo "user_allow_other" >>/etc/fuse.conf

owner_home="$(getent passwd "$SESSION_USER" | cut -d: -f6)"
owner_uid="$(id -u "$SESSION_USER")"
owner_gid="$(id -g "$SESSION_USER")"
MAC_PATH="${MAC_PATH:-/Users/$MAC_USER}"
MOUNT="$owner_home/macs/$NAME"

# Run sshfs in the foreground (-f) so systemd supervises it directly and
# restarts it if it dies; reconnect keeps the mount alive across Mac sleep.
cat >/etc/systemd/system/lumpy-mac-mount.service <<EOF
[Unit]
Description=Lumpy SSHFS mount of ${MAC_USER}@${MAC_HOST}
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p ${MOUNT}
ExecStartPre=/bin/chown ${owner_uid}:${owner_gid} ${MOUNT}
ExecStart=/usr/bin/sshfs ${MAC_USER}@${MAC_HOST}:${MAC_PATH} ${MOUNT} -f \\
  -o IdentityFile=${KEY} \\
  -o idmap=user -o uid=${owner_uid} -o gid=${owner_gid} \\
  -o allow_other -o reconnect \\
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \\
  -o StrictHostKeyChecking=accept-new
ExecStopPost=-/bin/fusermount -u ${MOUNT}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Replace any one-shot mount so the service can take over cleanly.
if mountpoint -q "$MOUNT"; then
  fusermount -u "$MOUNT" || true
fi

systemctl daemon-reload
systemctl enable --now lumpy-mac-mount

echo
echo "Installed lumpy-mac-mount. ${MAC_USER}@${MAC_HOST}:${MAC_PATH} -> ${MOUNT}"
echo "  status: systemctl status lumpy-mac-mount"
echo "  logs:   journalctl -u lumpy-mac-mount -f"
