#!/usr/bin/env bash
#
# Mounts a Mac's files onto the orchestrator box over the tailnet, so a
# Lumpy session running on the box can read and edit that Mac's working
# tree (including uncommitted changes) as if the files were local.
#
# The box is the SSHFS client; the Mac is the SSH server. Run this ON THE
# BOX as root.
#
# One-time setup on the Mac (owner):
#   1. System Settings -> General -> Sharing -> enable "Remote Login".
#   2. Add the box's public key (printed by this script on first run) to
#      ~/.ssh/authorized_keys on the Mac.
#
# Usage (on the box, as root):
#   MAC_HOST=100.125.22.103 MAC_USER=matt bash mount-mac.sh
#
# Optional:
#   MAC_PATH   remote path to mount (default: the Mac user's home)
#   NAME       mount label under the session user's home (default: derived
#              from MAC_HOST)
#   SESSION_USER  local user that owns the mount (default: lumpy)
#
# Unmount with:  fusermount -u /home/<session-user>/macs/<name>

set -euo pipefail

MAC_HOST="${MAC_HOST:-}"
MAC_USER="${MAC_USER:-}"
MAC_PATH="${MAC_PATH:-}"
SESSION_USER="${SESSION_USER:-lumpy}"
NAME="${NAME:-${MAC_HOST//[.:]/-}}"

if [ -z "$MAC_HOST" ] || [ -z "$MAC_USER" ]; then
  echo "error: set MAC_HOST=<tailnet-ip> and MAC_USER=<mac-login>" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "error: run as root (use sudo)" >&2
  exit 1
fi

# Resolve the owning user's home, uid, gid — the mount is owned by them so
# Lumpy sessions (which run as this user) can read and write.
if ! owner_home="$(getent passwd "$SESSION_USER" | cut -d: -f6)" || [ -z "$owner_home" ]; then
  echo "error: user '$SESSION_USER' not found" >&2
  exit 1
fi
owner_uid="$(id -u "$SESSION_USER")"
owner_gid="$(id -g "$SESSION_USER")"
MAC_PATH="${MAC_PATH:-/Users/$MAC_USER}"
MOUNT="$owner_home/macs/$NAME"

# Dependencies: sshfs (pulls in fuse).
if ! command -v sshfs >/dev/null 2>&1; then
  echo "Installing sshfs..."
  apt-get update -qq
  apt-get install -y sshfs
fi
# allow_other requires this to be enabled in the FUSE config.
if ! grep -qs '^user_allow_other' /etc/fuse.conf; then
  echo "user_allow_other" >>/etc/fuse.conf
fi

# A dedicated box->Mac key so this connection is independent of any human
# key and easy to revoke. Owned by root; only used for these mounts.
KEY="/root/.ssh/lumpy_mac_mount"
if [ ! -f "$KEY" ]; then
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -N "" -C "lumpy-mac-mount@box" -f "$KEY" >/dev/null
fi

# If we can't reach the Mac yet, print the key for the owner to authorize.
if ! ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
        -o ConnectTimeout=8 "$MAC_USER@$MAC_HOST" true 2>/dev/null; then
  echo
  echo "Cannot SSH to $MAC_USER@$MAC_HOST yet."
  echo "On the Mac: enable Remote Login, then add this line to"
  echo "~/.ssh/authorized_keys for user '$MAC_USER':"
  echo
  cat "$KEY.pub"
  echo
  echo "Then re-run this script."
  exit 1
fi

# (Re)mount cleanly.
mkdir -p "$MOUNT"
chown "$owner_uid:$owner_gid" "$MOUNT"
if mountpoint -q "$MOUNT"; then
  fusermount -u "$MOUNT" || true
fi

sshfs "$MAC_USER@$MAC_HOST:$MAC_PATH" "$MOUNT" \
  -o IdentityFile="$KEY" \
  -o idmap=user -o uid="$owner_uid" -o gid="$owner_gid" \
  -o allow_other \
  -o reconnect -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new

echo
echo "Mounted $MAC_USER@$MAC_HOST:$MAC_PATH -> $MOUNT"
echo "Lumpy sessions (user '$SESSION_USER') can now edit these files."
echo "Unmount: fusermount -u $MOUNT"
