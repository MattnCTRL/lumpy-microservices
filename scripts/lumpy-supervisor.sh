#!/usr/bin/env bash
#
# lumpy-supervisor - a watchdog that runs OUTSIDE the orchestrator (its own
# systemd service) so it survives the orchestrator dying. It does two things:
#
#   1. While Lumpy is healthy and stable (and no deploy is in progress), it
#      records the running commit as "last known good".
#   2. If Lumpy stays unhealthy for too long (a crash-looping bad deploy that
#      safe-deploy didn't catch), it resets to the last-good commit, rebuilds,
#      restarts, and alerts - so the platform self-heals even if it can't be
#      reached from the UI.
#
# It deliberately does nothing while a `.deploying` lock exists (safe-deploy is
# running its own verify/rollback) to avoid fighting it.

set -uo pipefail

DIR="${LUMPY_DIR:-/opt/lumpy}"
HEALTH="${LUMPY_HEALTH_URL:-http://100.81.90.46:4317/api/health}"
WEB_URL="${NEXT_PUBLIC_ORCHESTRATOR_URL:-http://100.81.90.46:4317}"
DATA="$DIR/data"
GOOD_FILE="$DATA/.last-good-commit"
LOCK="$DATA/.deploying"
LOG="$DATA/supervisor.log"
NTFY_TOPIC="${LUMPY_NTFY_TOPIC:-}"

INTERVAL=15        # seconds between checks
STABLE_OK=4        # consecutive OK checks before recording last-good (~60s)
FAIL_LIMIT=8       # consecutive failures before rollback (~120s)

mkdir -p "$DATA"
log() { echo "[$(date -u +%FT%TZ)] $*" >>"$LOG"; }
notify() { [ -n "$NTFY_TOPIC" ] && curl -s -m 8 -d "$1" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true; }

ok_streak=0
fail_streak=0
log "supervisor started (health=$HEALTH)"

while true; do
  sleep "$INTERVAL"

  # Stand down while an intentional deploy is verifying itself.
  if [ -f "$LOCK" ]; then
    ok_streak=0
    fail_streak=0
    continue
  fi

  if curl -fsS -m 5 "$HEALTH" >/dev/null 2>&1; then
    fail_streak=0
    ok_streak=$((ok_streak + 1))
    if [ "$ok_streak" -ge "$STABLE_OK" ]; then
      git -C "$DIR" rev-parse HEAD >"$GOOD_FILE" 2>/dev/null
      ok_streak=0
    fi
    continue
  fi

  ok_streak=0
  fail_streak=$((fail_streak + 1))
  log "health fail ($fail_streak/$FAIL_LIMIT)"
  [ "$fail_streak" -lt "$FAIL_LIMIT" ] && continue

  # Sustained failure with no deploy in progress - self-heal.
  good="$(cat "$GOOD_FILE" 2>/dev/null)"
  cur="$(git -C "$DIR" rev-parse HEAD 2>/dev/null)"
  if [ -z "$good" ] || [ "$good" = "$cur" ]; then
    log "unhealthy but no earlier good commit to roll back to (good=$good cur=$cur)"
    notify "Lumpy is unhealthy and there is no good commit to roll back to. Manual help needed."
    fail_streak=0
    continue
  fi

  log "ROLLING BACK $cur -> $good"
  notify "Lumpy unhealthy - auto-rolling back $cur -> $good."
  git -C "$DIR" reset --hard "$good" >>"$LOG" 2>&1
  (
    cd "$DIR" || exit
    npm install --no-audit --no-fund >>"$LOG" 2>&1
    npm run build -w @lumpy/agent >>"$LOG" 2>&1
    NEXT_PUBLIC_ORCHESTRATOR_URL="$WEB_URL" npm run build -w @lumpy/web >>"$LOG" 2>&1
  )
  systemctl restart lumpy-orchestrator lumpy-web >>"$LOG" 2>&1
  fail_streak=0
done
