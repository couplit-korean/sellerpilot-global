// An idle worker can legitimately wait for about 31 seconds (30-second
// exponential backoff plus jitter) before the next claim updates last_seen_at.
// Keep enough room for one bounded 30-second claim request as well, otherwise a
// healthy worker is intermittently rejected exactly when the queue is idle.
export const studioWorkerHeartbeatFreshnessMs = 90_000;
const studioWorkerClockSkewToleranceMs = 5_000;

export type StudioWorkerReadinessReason =
  | "ready"
  | "worker_missing"
  | "heartbeat_missing"
  | "heartbeat_stale"
  | "status_unavailable"
  | "configuration_missing"
  | "token_missing_or_expired"
  | "token_mismatch";

export type StudioWorkerReadiness = {
  available: boolean;
  reason: StudioWorkerReadinessReason;
  message: string;
  checkedAt: string;
};

type StudioWorkerReadinessOptions = {
  nowMs?: number;
  statusAvailable?: boolean;
};

function unavailableReadiness(
  reason: Exclude<StudioWorkerReadinessReason, "ready">,
  message: string,
  nowMs: number,
): StudioWorkerReadiness {
  return {
    available: false,
    reason,
    message,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

export function resolveStudioWorkerReadiness(
  runtimeStatus: unknown,
  options: StudioWorkerReadinessOptions = {},
): StudioWorkerReadiness {
  const nowMs = options.nowMs ?? Date.now();
  if (options.statusAvailable === false) {
    return unavailableReadiness(
      "status_unavailable",
      "AI 제작 작업자 연결 상태를 확인할 수 없어 상품 분석을 시작하지 않았습니다. 잠시 후 다시 확인해 주세요.",
      nowMs,
    );
  }
  if (!runtimeStatus || typeof runtimeStatus !== "object" || Array.isArray(runtimeStatus)) {
    return unavailableReadiness(
      "worker_missing",
      "AI 제작 작업자가 연결되지 않았습니다. 운영 설정에서 AI 작업자를 실행한 뒤 다시 확인해 주세요.",
      nowMs,
    );
  }

  const workers = (runtimeStatus as Record<string, unknown>).workers;
  if (!workers || typeof workers !== "object" || Array.isArray(workers)) {
    return unavailableReadiness(
      "worker_missing",
      "AI 제작 작업자가 연결되지 않았습니다. 운영 설정에서 AI 작업자를 실행한 뒤 다시 확인해 주세요.",
      nowMs,
    );
  }
  const worker = (workers as Record<string, unknown>).ai;
  if (!worker || typeof worker !== "object" || Array.isArray(worker)) {
    return unavailableReadiness(
      "worker_missing",
      "AI 제작 작업자가 연결되지 않았습니다. 운영 설정에서 AI 작업자를 실행한 뒤 다시 확인해 주세요.",
      nowMs,
    );
  }

  const lastSeenAt = (worker as Record<string, unknown>).last_seen_at;
  if (typeof lastSeenAt !== "string" || !lastSeenAt.trim()) {
    return unavailableReadiness(
      "heartbeat_missing",
      "AI 제작 작업자의 최근 연결 신호가 없습니다. 작업자를 실행한 뒤 다시 확인해 주세요.",
      nowMs,
    );
  }
  const lastSeenMs = Date.parse(lastSeenAt);
  const heartbeatAgeMs = nowMs - lastSeenMs;
  if (!Number.isFinite(lastSeenMs)
      || heartbeatAgeMs < -studioWorkerClockSkewToleranceMs
      || heartbeatAgeMs >= studioWorkerHeartbeatFreshnessMs) {
    return unavailableReadiness(
      "heartbeat_stale",
      "AI 제작 작업자의 연결 신호가 90초 이상 지나 상품 분석을 시작하지 않았습니다. 작업자를 다시 실행해 주세요.",
      nowMs,
    );
  }

  return {
    available: true,
    reason: "ready",
    message: "AI 제작 작업자가 연결되어 상품 분석을 시작할 수 있습니다.",
    checkedAt: new Date(nowMs).toISOString(),
  };
}
