#!/bin/bash
# Durable channel gateway supervisor.
#
# This file is versioned with the application on purpose: the poll interval and
# the concurrency live here, and a copy outside the repository silently fell
# back to the 5 second default whenever it was lost or replaced.
#
# It keeps the worker on the release Production is serving:
#   - If a worker already answers on the health port, do nothing.
#   - Otherwise fetch main (with retries), check it out, and run the worker.
# A stale checkout silently keeps old behaviour, so the fetch result is logged.
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

cd "$WORKER_DIR" || { echo "[worker] missing checkout $WORKER_DIR"; exit 1; }

while true; do
  if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    sleep 20
    continue
  fi

  fetched=0
  for attempt in 1 2 3; do
    if git fetch --depth 1 origin main --quiet 2>/dev/null; then
      fetched=1
      break
    fi
    echo "[worker] fetch attempt ${attempt} failed; retrying in 5s"
    sleep 5
  done

  if [ "$fetched" = "1" ]; then
    git checkout --detach --force FETCH_HEAD --quiet || true
  else
    echo "[worker] fetch failed; using the local checkout"
  fi
  git clean -fdq -e node_modules || true

  echo "[worker] release $(git rev-parse HEAD) fetched=${fetched} $(date -u +%FT%TZ)"
  "$NODE_BIN" --import tsx scripts/ai-cli-worker.mjs --gateway-only --no-scheduler || true
  echo "[worker] exited, restarting in 10s"
  sleep 10
done
