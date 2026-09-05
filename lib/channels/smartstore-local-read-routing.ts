export const SMARTSTORE_LOCAL_READ_OPERATIONS = [
  "diagnostic.test",
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "inquiries.list",
  "listing.publication.verify",
] as const;

export type SmartstoreLocalReadOperation =
  (typeof SMARTSTORE_LOCAL_READ_OPERATIONS)[number];

const smartstoreLocalReadOperationSet = new Set<string>(
  SMARTSTORE_LOCAL_READ_OPERATIONS,
);

// Gateway idle poll can reach 30s plus jitter, and one claim itself is
// bounded near 30s. A historical Mac GET 200 is not proof the current
// scope=gateway worker is alive.
export const localGatewayReadHeartbeatFreshnessMs = 90_000;
const localGatewayReadClockSkewToleranceMs = 5_000;
const SERVERLESS_CS_WORKER_VERSION_PREFIX = "sellerpilot-vercel-gateway/";

export type LocalGatewayReadReadyReason =
  | "ready"
  | "worker_missing"
  | "heartbeat_missing"
  | "heartbeat_stale"
  | "status_unavailable"
  | "ability_unproven";

export type LocalGatewayReadReady = {
  available: boolean;
  reason: LocalGatewayReadReadyReason;
  message: string;
  checkedAt: string;
};

export function isSmartstoreLocalReadOperation(
  operation: string,
): operation is SmartstoreLocalReadOperation {
  return smartstoreLocalReadOperationSet.has(operation);
}

type LocalGatewayReadReadyOptions = {
  nowMs?: number;
  statusAvailable?: boolean;
};

function unavailableReadiness(
  reason: Exclude<LocalGatewayReadReadyReason, "ready">,
  message: string,
  nowMs: number,
): LocalGatewayReadReady {
  return {
    available: false,
    reason,
    message,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

export function resolveLocalGatewayReadReady(
  runtimeStatus: unknown,
  options: LocalGatewayReadReadyOptions = {},
): LocalGatewayReadReady {
  const nowMs = options.nowMs ?? Date.now();
  if (options.statusAvailable === false) {
    return unavailableReadiness(
      "status_unavailable",
      "등록된 Mac 게이트웨이 작업자 연결 상태를 확인하지 못해 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }
  if (
    !runtimeStatus
    || typeof runtimeStatus !== "object"
    || Array.isArray(runtimeStatus)
  ) {
    return unavailableReadiness(
      "worker_missing",
      "등록된 Mac 게이트웨이 작업자가 연결되어 있지 않아 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }

  const workers = (runtimeStatus as Record<string, unknown>).workers;
  if (!workers || typeof workers !== "object" || Array.isArray(workers)) {
    return unavailableReadiness(
      "worker_missing",
      "등록된 Mac 게이트웨이 작업자가 연결되어 있지 않아 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }

  const gateway = (workers as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) {
    return unavailableReadiness(
      "worker_missing",
      "등록된 Mac 게이트웨이 작업자가 연결되어 있지 않아 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }

  const lastSeenAt = (gateway as Record<string, unknown>).last_seen_at;
  if (typeof lastSeenAt !== "string" || !lastSeenAt.trim()) {
    return unavailableReadiness(
      "heartbeat_missing",
      "등록된 Mac 게이트웨이 작업자의 최근 연결 신호가 없어 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }
  const lastSeenMs = Date.parse(lastSeenAt);
  const heartbeatAgeMs = nowMs - lastSeenMs;
  if (
    !Number.isFinite(lastSeenMs)
    || heartbeatAgeMs < -localGatewayReadClockSkewToleranceMs
    || heartbeatAgeMs >= localGatewayReadHeartbeatFreshnessMs
  ) {
    return unavailableReadiness(
      "heartbeat_stale",
      "등록된 Mac 게이트웨이 작업자의 연결 신호가 오래되어 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }

  const lastVersion = typeof (gateway as Record<string, unknown>).last_version === "string"
    ? String((gateway as Record<string, unknown>).last_version).trim()
    : "";
  if (!lastVersion || lastVersion.startsWith(SERVERLESS_CS_WORKER_VERSION_PREFIX)) {
    return unavailableReadiness(
      "ability_unproven",
      "등록된 Mac 게이트웨이 작업자의 실행 신원을 증명하지 못해 스마트스토어 읽기 작업을 대기열에 넣지 않았습니다.",
      nowMs,
    );
  }

  return {
    available: true,
    reason: "ready",
    message: "등록된 Mac 게이트웨이 작업자가 연결되어 스마트스토어 읽기 작업을 대기열에 넣을 수 있습니다.",
    checkedAt: new Date(nowMs).toISOString(),
  };
}
