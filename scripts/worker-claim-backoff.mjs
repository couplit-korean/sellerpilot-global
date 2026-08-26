export const WORKER_AUTH_BACKOFF_MS = 5 * 60_000;
export const WORKER_TRANSIENT_BACKOFF_MS = 60_000;

export function isWorkerTokenConfigured(token) {
  return typeof token === "string" && /^spw_[A-Za-z0-9_-]{43}$/.test(token);
}

export function canRunPeriodicChannelSync({
  once,
  gatewayConfigured,
  schedulerConfigured,
  queueIdle,
  activeGatewayJobs,
  now,
  nextPeriodicSyncAt,
  schedulerBackoffUntil,
}) {
  return !once
    && gatewayConfigured
    && schedulerConfigured
    && queueIdle
    && activeGatewayJobs === 0
    && now >= nextPeriodicSyncAt
    && now >= schedulerBackoffUntil;
}

export function canRunGatewayClaim({
  configured,
  activeGatewayJobs,
  maxGatewayConcurrency,
  now,
  claimBackoffUntil,
  authBackoffUntil,
}) {
  return configured
    && activeGatewayJobs < maxGatewayConcurrency
    && now >= claimBackoffUntil
    && now >= authBackoffUntil;
}

export function workerClaimBackoffMs(status) {
  if (status === 401) return WORKER_AUTH_BACKOFF_MS;
  if (status === 503) return WORKER_TRANSIENT_BACKOFF_MS;
  return 0;
}

export function workerFailureBackoffMs(status) {
  return workerClaimBackoffMs(status) || WORKER_TRANSIENT_BACKOFF_MS;
}
