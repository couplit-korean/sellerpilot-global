export const AI_HEARTBEAT_INTERVAL_MS = 20_000;
export const AI_HEARTBEAT_TRANSIENT_GRACE_MS = 2 * 60_000;
export const WORKER_COMPLETION_TRANSIENT_GRACE_MS = 60_000;
export const GATEWAY_COMPLETION_TRANSIENT_GRACE_MS = 10 * 60_000;

export class WorkerRequestTerminalError extends Error {
  constructor(message, { status = 0, reconciliation = false } = {}) {
    super(message);
    this.name = "WorkerRequestTerminalError";
    this.status = status;
    this.reconciliation = reconciliation;
  }
}

export function workerLifecycleRetryDelayMs(attempt) {
  const normalizedAttempt = Math.max(1, Number.isFinite(attempt) ? Math.trunc(attempt) : 1);
  return Math.min(10_000, 2_000 * (2 ** (normalizedAttempt - 1)));
}

export function isTransientWorkerResponseStatus(status) {
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

export async function requestWithTransientRetry({
  request,
  delay,
  graceMs,
  terminalStatuses,
  label,
  now = Date.now,
  onTransient,
}) {
  const startedAt = now();
  let attempt = 0;
  let lastStatus = 0;
  while (true) {
    let response = null;
    try {
      response = await request();
    } catch {
      // A transport timeout can happen after the server accepted the request.
      // Retrying the exact same payload is safer than changing remote state.
    }
    if (response?.ok) return response;

    lastStatus = response?.status ?? 0;
    if (terminalStatuses.includes(lastStatus)) {
      throw new WorkerRequestTerminalError(`${label} · HTTP ${lastStatus}`, {
        status: lastStatus,
        reconciliation: lastStatus === 409,
      });
    }
    if (response && !isTransientWorkerResponseStatus(lastStatus)) {
      throw new Error(`${label} · HTTP ${lastStatus}`);
    }

    const elapsedMs = Math.max(0, now() - startedAt);
    const remainingMs = graceMs - elapsedMs;
    if (remainingMs <= 0) {
      throw new WorkerRequestTerminalError(`${label} · 일시적 응답 재시도 한도 초과`, {
        status: lastStatus || 503,
        reconciliation: true,
      });
    }
    attempt += 1;
    const waitMs = Math.min(workerLifecycleRetryDelayMs(attempt), remainingMs);
    onTransient?.({ attempt, status: lastStatus || 503, waitMs });
    await delay(waitMs);
  }
}
