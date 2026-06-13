/**
 * Generates the one-line enrollment script served at GET /enroll. Running it on
 * a machine (`curl -fsSL <box>/enroll | sh`) downloads the self-contained agent
 * bundle and installs it as a background service — no git clone, no npm, just
 * Node. The orchestrator's base URL is baked in so the agent reports home.
 */
export function enrollScript(baseUrl: string): string {
  return `#!/bin/sh
set -e
LUMPY_URL="${baseUrl}"
NAME="\${LUMPY_AGENT_NAME:-$(hostname)}"
DIR="$HOME/.lumpy"
mkdir -p "$DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Lumpy: Node.js is required. Install Node 18+ (e.g. 'brew install node' on macOS) and re-run." >&2
  exit 1
fi
NODE="$(command -v node)"

echo "Lumpy: downloading agent..."
curl -fsSL "$LUMPY_URL/agent.mjs" -o "$DIR/agent.mjs"

OS="$(uname)"
if [ "$OS" = "Darwin" ]; then
  PL="$HOME/Library/LaunchAgents/com.lumpy.agent.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lumpy.agent</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/agent.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LUMPY_URL</key><string>$LUMPY_URL</string>
    <key>LUMPY_AGENT_NAME</key><string>$NAME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/lumpy-agent.log</string>
  <key>StandardErrorPath</key><string>/tmp/lumpy-agent.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$PL" 2>/dev/null || true
  launchctl load -w "$PL" 2>/dev/null || true
  # Start immediately too, so it appears without waiting for a relaunch.
  ( LUMPY_URL="$LUMPY_URL" LUMPY_AGENT_NAME="$NAME" nohup "$NODE" "$DIR/agent.mjs" >/tmp/lumpy-agent.log 2>&1 & ) 2>/dev/null || true
  echo "Lumpy: agent installed as \\"$NAME\\". It should appear under Machines within ~10s."
elif [ "$OS" = "Linux" ]; then
  if [ "$(id -u)" = "0" ]; then
    cat > /etc/systemd/system/lumpy-agent.service <<UNIT
[Unit]
Description=Lumpy metrics agent
After=network-online.target
Wants=network-online.target
[Service]
Environment=LUMPY_URL=$LUMPY_URL
Environment=LUMPY_AGENT_NAME=$NAME
ExecStart=$NODE $DIR/agent.mjs
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now lumpy-agent
    echo "Lumpy: agent installed as \\"$NAME\\" (systemd)."
  else
    ( LUMPY_URL="$LUMPY_URL" LUMPY_AGENT_NAME="$NAME" nohup "$NODE" "$DIR/agent.mjs" >/tmp/lumpy-agent.log 2>&1 & ) 2>/dev/null || true
    echo "Lumpy: agent started (foreground/no systemd — re-run as root for a boot service)."
  fi
else
  echo "Lumpy: unsupported OS $OS" >&2
  exit 1
fi
`;
}
