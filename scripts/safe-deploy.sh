#!/usr/bin/env bash
#
# safe-deploy.sh - apply Lumpy's current code, verify it, and AUTO-ROLLBACK if
# the build fails or the platform doesn't come back healthy. This is what lets
# the Conductor change Lumpy's own code without bricking the platform.
#
# Flow: snapshot the known-good commit -> (optionally pull) -> typecheck+build
# (rollback here never restarts with bad code) -> restart -> health-check ->
# on failure, reset to the snapshot, rebuild, restart, and alert.
#
# Usage (on the box):  sudo /opt/lumpy/scripts/safe-deploy.sh [pull]
#   pull = fetch and reset to origin/main first; otherwise deploy the working tree.

set -uo pipefail

DIR="${LUMPY_DIR:-/opt/lumpy}"
HEALTH="${LUMPY_HEALTH_URL:-http://100.81.90.46:4317/api/health}"
DATA="$DIR/data"
GOOD_FILE="$DATA/.last-good-commit"
LOCK="$DATA/.deploying"
LOG="$DATA/deploy.log"
NTFY_TOPIC="${LUMPY_NTFY_TOPIC:-}"

mkdir -p "$DATA"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }
notify() { [ -n "$NTFY_TOPIC" ] && curl -s -m 8 -d "$1" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true; }

cd "$DIR" || { echo "no $DIR"; exit 1; }

build() {
  npm install --no-audit --no-fund >>"$LOG" 2>&1 || return 1
  npm run typecheck >>"$LOG" 2>&1 || return 1
  npm run build -w @lumpy/agent >>"$LOG" 2>&1 || return 1
  # No baked orchestrator URL: the web derives it from the page host at runtime so
  # an IP/MagicDNS change can't strand the client. An exported NEXT_PUBLIC_ORCHESTRATOR_URL
  # still overrides if set.
  npm run build -w @lumpy/web >>"$LOG" 2>&1 || return 1
}

restart() { systemctl restart lumpy-orchestrator lumpy-web; }

healthy() {
  for _ in $(seq 1 30); do
    sleep 2
    curl -fsS -m 5 "$HEALTH" >/dev/null 2>&1 && return 0
  done
  return 1
}

# Snapshot the last-known-good commit to roll back to.
SNAPSHOT="$(cat "$GOOD_FILE" 2>/dev/null || git rev-parse HEAD)"
echo "$$" >"$LOCK"
trap 'rm -f "$LOCK"' EXIT
log "deploy start (snapshot=$SNAPSHOT)"

if [ "${1:-}" = "pull" ]; then
  git fetch -q origin && git reset -q --hard origin/main
fi
TARGET="$(git rev-parse HEAD)"
log "target=$TARGET"

# 1) Build the new code. A build failure never reaches a restart.
if ! build; then
  log "BUILD FAILED at $TARGET - rolling back to $SNAPSHOT"
  git reset -q --hard "$SNAPSHOT"
  build || log "WARNING: rollback build also failed"
  restart
  notify "Lumpy deploy BUILD FAILED ($TARGET). Rolled back to $SNAPSHOT."
  exit 1
fi

# 2) Restart and verify health.
restart
if healthy; then
  echo "$TARGET" >"$GOOD_FILE"
  log "deploy OK at $TARGET"
  notify "Lumpy deployed OK ($TARGET)."
  exit 0
fi

# 3) Unhealthy after restart - roll back and recover.
log "HEALTH CHECK FAILED at $TARGET - rolling back to $SNAPSHOT"
git reset -q --hard "$SNAPSHOT"
build
restart
if healthy; then
  echo "$SNAPSHOT" >"$GOOD_FILE"
  log "rollback to $SNAPSHOT OK"
  notify "Lumpy deploy FAILED health check ($TARGET). Rolled back to $SNAPSHOT (healthy)."
  exit 1
fi
log "CRITICAL: rollback to $SNAPSHOT is also unhealthy"
notify "Lumpy CRITICAL: deploy and rollback both unhealthy. Manual help needed."
exit 2
