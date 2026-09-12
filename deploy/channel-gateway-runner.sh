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
HEALTH_PORT="${SELLERPILOT_GATEWAY_HEALTH_PORT:-8080}"
HEALTH_URL="${SELLERPILOT_WORKER_HEALTH_URL:-http://127.0.0.1:${HEALTH_PORT}/healthz}"
NODE_BIN="${SELLERPILOT_NODE_BIN:-$(command -v node)}"
RELEASE_FILE="${SELLERPILOT_GATEWAY_RELEASE_FILE:-$HOME/Library/Application Support/SellerPilot/gateway-release}"
SUPERVISOR_LOCK_DIR="${SELLERPILOT_GATEWAY_SUPERVISOR_LOCK_DIR:-$HOME/Library/Application Support/SellerPilot/channel-gateway-supervisor.lock}"
SUPERVISOR_LOCK_FILE="$SUPERVISOR_LOCK_DIR/supervisor.lockf"
SUPERVISOR_OWNER_FILE="$SUPERVISOR_LOCK_DIR/owner"
SUPERVISOR_OWNER_TOKEN=""

# Readiness can become 503 while the process is safely retaining a claimed job
# through a transient database outage. Supervision only asks whether that exact
# process is alive; queue readiness remains observable at /readyz.
case "$HEALTH_URL" in
  */readyz) HEALTH_URL="${HEALTH_URL%/readyz}/healthz" ;;
esac

if [ -z "${SELLERPILOT_URL:-}" ]; then
  echo "[worker] SELLERPILOT_URL is required"
  exit 1
fi

release_supervisor_lock() {
  if [ -n "$SUPERVISOR_OWNER_TOKEN" ] \
    && [ -f "$SUPERVISOR_OWNER_FILE" ] \
    && grep -Fqx "token=$SUPERVISOR_OWNER_TOKEN" "$SUPERVISOR_OWNER_FILE" 2>/dev/null; then
    rm -f "$SUPERVISOR_OWNER_FILE"
  fi
}

supervisor_process_identity() {
  /bin/ps -p "$1" -o lstart= -o command= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'
}

acquire_supervisor_lock() {
  mkdir -p "$(dirname "$SUPERVISOR_LOCK_DIR")"
  legacy_empty_lock=0
  legacy_lock_mtime=""
  if [ ! -e "$SUPERVISOR_LOCK_DIR" ]; then
    mkdir "$SUPERVISOR_LOCK_DIR" 2>/dev/null || true
  elif [ -d "$SUPERVISOR_LOCK_DIR" ] \
    && [ ! -e "$SUPERVISOR_LOCK_FILE" ] \
    && [ ! -e "$SUPERVISOR_LOCK_DIR/pid" ] \
    && [ ! -e "$SUPERVISOR_OWNER_FILE" ]; then
    legacy_empty_lock=1
    legacy_lock_mtime="$(/usr/bin/stat -f %m "$SUPERVISOR_LOCK_DIR" 2>/dev/null || true)"
  fi
  [ -d "$SUPERVISOR_LOCK_DIR" ] || { echo "[worker] supervisor lock is unavailable"; return 1; }

  # lockf holds a kernel lock on this already-open descriptor for the lifetime
  # of this shell. There is no mkdir->PID publication window, stale files do
  # not hold the lock, and process exit releases it without PID-based cleanup.
  exec 9>>"$SUPERVISOR_LOCK_FILE" || { echo "[worker] supervisor lock is unavailable"; return 1; }
  if ! /usr/bin/lockf -s -t 0 9; then
    echo "[worker] supervisor already running"
    return 1
  fi

  # A pre-lockf runner may still own the legacy PID file. Verify both liveness
  # and command identity. An unrelated live PID is PID reuse, not a process to
  # kill; an unreadable identity is retained conservatively.
  existing_pid="$(cat "$SUPERVISOR_LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    existing_identity="$(supervisor_process_identity "$existing_pid")"
    if [ -z "$existing_identity" ]; then
      echo "[worker] legacy supervisor identity is unknown pid=${existing_pid}"
      return 1
    fi
    case "$existing_identity" in
      *channel-gateway-runner.sh*|*sellerpilot-worker-runner.sh*)
        echo "[worker] legacy supervisor already running pid=${existing_pid}"
        return 1
        ;;
      *)
        echo "[worker] stale legacy supervisor PID was reused pid=${existing_pid}; no process was signalled"
        ;;
    esac
  fi

  # A fresh empty legacy directory may be an older runner between mkdir and
  # PID publication. Never reap it during that initialization grace period.
  if [ "$legacy_empty_lock" = "1" ]; then
    now_epoch="$(date +%s)"
    if [[ "$legacy_lock_mtime" =~ ^[0-9]+$ ]] \
      && [ $((now_epoch - legacy_lock_mtime)) -lt "${SELLERPILOT_SUPERVISOR_LEGACY_INIT_GRACE_SECONDS:-5}" ]; then
      echo "[worker] legacy supervisor lock is still initializing"
      return 1
    fi
  fi

  rm -f "$SUPERVISOR_LOCK_DIR/pid"
  if [ "${SELLERPILOT_SUPERVISOR_TEST_MODE:-0}" = "1" ] \
    && [ -n "${SELLERPILOT_SUPERVISOR_TEST_LOCKED_FILE:-}" ]; then
    printf 'locked\n' > "$SELLERPILOT_SUPERVISOR_TEST_LOCKED_FILE"
  fi
  if [ "${SELLERPILOT_SUPERVISOR_TEST_MODE:-0}" = "1" ] \
    && [[ "${SELLERPILOT_SUPERVISOR_TEST_OWNER_DELAY_SECONDS:-0}" =~ ^[0-9]+$ ]] \
    && [ "${SELLERPILOT_SUPERVISOR_TEST_OWNER_DELAY_SECONDS:-0}" -gt 0 ]; then
    sleep "$SELLERPILOT_SUPERVISOR_TEST_OWNER_DELAY_SECONDS"
  fi
  SUPERVISOR_OWNER_TOKEN="$$:${RANDOM}:${RANDOM}"
  owner_staged="$SUPERVISOR_OWNER_FILE.staged-$$"
  {
    printf 'version=2\n'
    printf 'pid=%s\n' "$$"
    printf 'identity=%s\n' "$(supervisor_process_identity "$$")"
    printf 'token=%s\n' "$SUPERVISOR_OWNER_TOKEN"
  } > "$owner_staged"
  mv "$owner_staged" "$SUPERVISOR_OWNER_FILE"
  trap release_supervisor_lock EXIT
  trap 'exit 0' HUP INT TERM
}

case "$WORKER_DIR" in
  "$HOME/dev/sellerpilot-worker") ;;
  *) echo "[worker] use the dedicated ~/dev/sellerpilot-worker checkout"; exit 1 ;;
esac
[ -x "$NODE_BIN" ] || { echo "[worker] SELLERPILOT_NODE_BIN is required"; exit 1; }
acquire_supervisor_lock || exit 0

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
