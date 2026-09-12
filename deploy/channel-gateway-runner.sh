#!/bin/bash
# Durable channel gateway supervisor.
#
# This file is versioned with the application on purpose: the poll interval and
# the concurrency live here, and a copy outside the repository silently fell
# back to the 5 second default whenever it was lost or replaced.
#
# It uses an explicitly verified Production release:
#   - If a worker already answers on the health port, do nothing.
#   - Otherwise fetch the pinned SHA, check out a clean runtime, and run it.
# Updating main alone is not proof that Vercel serves that commit.
#
# Install as a thin shim so repository updates apply without editing launchd:
#   ~/dev/sellerpilot-worker-runner.sh  ->  copies and execs this file
#   ~/Library/LaunchAgents/com.sellerpilot.channel-gateway.plist
#     ProgramArguments = /bin/bash ~/dev/sellerpilot-worker-runner.sh

set -u

export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

# One job at a time: the shared instance is small and parallel claims only add
# contention without finishing more channel work.
export SELLERPILOT_CHANNEL_WORKER_CONCURRENCY="${SELLERPILOT_CHANNEL_WORKER_CONCURRENCY:-1}"

# A claim costs hundreds of milliseconds of database CPU per call, so the idle
# loop must not run at the old 5 second cadence.
export SELLERPILOT_AI_WORKER_POLL_MS="${SELLERPILOT_AI_WORKER_POLL_MS:-15000}"
export SELLERPILOT_AI_WORKER_MAX_IDLE_POLL_MS="${SELLERPILOT_AI_WORKER_MAX_IDLE_POLL_MS:-60000}"

WORKER_DIR="${SELLERPILOT_WORKER_DIR:-$HOME/dev/sellerpilot-worker}"
HEALTH_URL="${SELLERPILOT_WORKER_HEALTH_URL:-http://127.0.0.1:8080/readyz}"
NODE_BIN="${SELLERPILOT_NODE_BIN:-$(command -v node)}"
RELEASE_FILE="${SELLERPILOT_GATEWAY_RELEASE_FILE:-$HOME/Library/Application Support/SellerPilot/gateway-release}"

case "$WORKER_DIR" in
  "$HOME/dev/sellerpilot-worker") ;;
  *) echo "[worker] use the dedicated ~/dev/sellerpilot-worker checkout"; exit 1 ;;
esac
[ -x "$NODE_BIN" ] || { echo "[worker] SELLERPILOT_NODE_BIN is required"; exit 1; }

cd "$WORKER_DIR" || { echo "[worker] missing checkout $WORKER_DIR"; exit 1; }

while true; do
  if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    sleep 20
    continue
  fi

  RELEASE_SHA="$(cat "$RELEASE_FILE" 2>/dev/null || true)"
  if ! [[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
    echo "[worker] verified Production release pin is missing"
    sleep 60
    continue
  fi
  if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "[worker] runtime has local changes; refusing to overwrite them"
    sleep 60
    continue
  fi
  fetched=0
  for attempt in 1 2 3; do
    if git fetch --depth 1 origin "$RELEASE_SHA" --quiet 2>/dev/null; then
      fetched=1
      break
    fi
    echo "[worker] fetch attempt ${attempt} failed; retrying in 5s"
    sleep 5
  done

  if [ "$fetched" = "1" ]; then
    git checkout --detach "$RELEASE_SHA" --quiet || { sleep 60; continue; }
  else
    if [ "$(git rev-parse HEAD)" != "$RELEASE_SHA" ]; then
      echo "[worker] fetch failed and local release differs from Production pin"
      sleep 60
      continue
    fi
  fi

  echo "[worker] release $(git rev-parse HEAD) fetched=${fetched} $(date -u +%FT%TZ)"
  "$NODE_BIN" --import tsx scripts/ai-cli-worker.mjs --gateway-only --no-scheduler || true
  echo "[worker] exited, restarting in 10s"
  sleep 10
done
