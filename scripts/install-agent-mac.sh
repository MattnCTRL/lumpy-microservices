#!/usr/bin/env bash
#
# Installs the Lumpy metrics agent on a Mac as a launchd agent, so it reports
# CPU/memory/disk/load to your orchestrator and restarts on login/crash.
#
# Prerequisite: this Mac must be able to reach the orchestrator. The box binds
# to the tailnet, so install Tailscale and sign into the same tailnet first.
#
# Usage (on the Mac you want to monitor):
#   LUMPY_URL=http://100.81.90.46:4317 LUMPY_AGENT_NAME="My MacBook" \
#     bash install-agent-mac.sh
#
# LUMPY_AGENT_NAME defaults to this Mac's name. Re-run any time to update.
#
# Uninstall:
#   launchctl unload ~/Library/LaunchAgents/com.lumpy.agent.plist
#   rm ~/Library/LaunchAgents/com.lumpy.agent.plist

set -euo pipefail

LUMPY_URL="${LUMPY_URL:-http://100.81.90.46:4317}"
LUMPY_DIR="${LUMPY_DIR:-$HOME/.lumpy}"
REPO="${LUMPY_REPO:-https://github.com/MattnCTRL/lumpy-microservices.git}"
DEFAULT_NAME="$(scutil --get ComputerName 2>/dev/null || hostname)"
LUMPY_AGENT_NAME="${LUMPY_AGENT_NAME:-$DEFAULT_NAME}"
PLIST="$HOME/Library/LaunchAgents/com.lumpy.agent.plist"

if [ "$(uname)" != "Darwin" ]; then
  echo "error: this installer is for macOS; use install-agent.sh on Linux" >&2
  exit 1
fi

# Node 20+ (don't auto-install Homebrew; just point the way).
node_major="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//' || echo 0)"
if [ "${node_major:-0}" -lt 20 ]; then
  echo "error: Node.js 20+ is required and was not found." >&2
  echo "Install it (e.g. 'brew install node') and re-run." >&2
  exit 1
fi
command -v git >/dev/null 2>&1 || { echo "error: git is required" >&2; exit 1; }

# Fetch or update the repo, then install only the agent workspace.
if [ -d "$LUMPY_DIR/.git" ]; then
  git -C "$LUMPY_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$LUMPY_DIR"
fi
cd "$LUMPY_DIR"
npm install -w @lumpy/agent --no-audit --no-fund

mkdir -p "$HOME/Library/LaunchAgents"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.lumpy.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>exec ./node_modules/.bin/tsx apps/agent/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${LUMPY_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LUMPY_URL</key>
    <string>${LUMPY_URL}</string>
    <key>LUMPY_AGENT_NAME</key>
    <string>${LUMPY_AGENT_NAME}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/lumpy-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/lumpy-agent.log</string>
</dict>
</plist>
EOF

# Reload cleanly so re-runs pick up changes.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo
echo "Lumpy agent installed as \"${LUMPY_AGENT_NAME}\" -> ${LUMPY_URL}"
echo "  it should appear in Lumpy's Machines list within ~10s."
echo "  logs: tail -f /tmp/lumpy-agent.log"
echo "  stop: launchctl unload ${PLIST}"
