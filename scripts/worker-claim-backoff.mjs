export const WORKER_AUTH_BACKOFF_MS = 5 * 60_000;
export const WORKER_TRANSIENT_BACKOFF_MS = 60_000;

export function workerClaimBackoffMs(status) {
  if (status === 401) return WORKER_AUTH_BACKOFF_MS;
  if (status === 503) return WORKER_TRANSIENT_BACKOFF_MS;
  return 0;
}
