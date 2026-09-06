export const SHOPEE_OAUTH_OPERATION = "oauth.exchange" as const;
export const SHOPEE_OAUTH_LOCAL_GATEWAY_FRESHNESS_MS = 180_000;
export const SHOPEE_OAUTH_LOCAL_GATEWAY_CLOCK_SKEW_MS = 5_000;
export const SHOPEE_OAUTH_LOCAL_GATEWAY_SCOPE = "gateway" as const;

const SERVERLESS_CS_WORKER_VERSION_PREFIX = "sellerpilot-vercel-gateway/";

export const SHOPEE_OAUTH_LOCAL_ROUTING_CONTRACT = {
  operation: SHOPEE_OAUTH_OPERATION,
  refreshExcluded: true,
  runtimeRpc: "sellerpilot_ai_runtime_status",
  runtimePath: "workers.gateway.last_seen_at",
  runtimeScopeKey: "workers.gateway",
  macClaimSource: "sellerpilot_11820_claim_gateway_unsafe",
  serverlessClaimSource: "sellerpilot_183000_claim_serverless_gateway_unsafe",
  serverlessOauthRequiresDatabaseStaticEgress: true,
  reconFence: "sellerpilot_enqueue_channel_gateway_job unresolved oauth.exchange recon",
  reconProbed: false,
  registeredIpHistoryIsNotAttestation: true,
} as const;

export type ShopeeOAuthExecutorReason =
  | "ready_serverless_static_egress"
  | "ready_local_mac_gateway"
  | "serverless_worker_required"
  | "static_egress_status_unavailable"
  | "executor_exclusive_unproven"
  | "local_gateway_status_unavailable"
  | "local_gateway_missing"
  | "local_gateway_wrong_scope"
  | "local_gateway_heartbeat_missing"
  | "local_gateway_heartbeat_stale"
  | "local_gateway_ability_unproven";

export type ShopeeOAuthExecutorMode =
  | "serverless_static_egress"
  | "local_mac_gateway";

export type ShopeeOAuthExecutorReadiness = {
  allowed: boolean;
  mode: ShopeeOAuthExecutorMode | null;
  reason: ShopeeOAuthExecutorReason;
  message: string;
  blockedReason:
    | "SERVERLESS_WORKER_REQUIRED"
    | "STATIC_EGRESS_STATUS_UNAVAILABLE"
    | "SHOPEE_OAUTH_EXECUTOR_UNPROVEN"
    | "LOCAL_GATEWAY_WORKER_REQUIRED"
    | null;
  prerequisites: string[];
  evidence: {
    envStaticEgress: boolean;
    databaseStaticEgress: boolean | null;
    localGatewayScopePresent: boolean;
    localGatewayHeartbeatAgeMs: number | null;
    reconProbed: false;
  };
};

export type ShopeeOAuthExecutorReadinessInput = {
  nowMs?: number;
  staticEgressRpcError: boolean;
  envConfigured: boolean;
  databaseAllows: boolean;
  serverlessCs?: { configured: boolean; active: boolean } | null;
  serverlessCsError?: boolean;
  runtimeStatus: unknown;
  runtimeStatusAvailable: boolean;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function blocked(
  reason: Exclude<ShopeeOAuthExecutorReason, "ready_serverless_static_egress" | "ready_local_mac_gateway">,
  message: string,
  blockedReason: NonNullable<ShopeeOAuthExecutorReadiness["blockedReason"]>,
  prerequisites: string[],
  evidence: ShopeeOAuthExecutorReadiness["evidence"],
): ShopeeOAuthExecutorReadiness {
  return {
    allowed: false,
    mode: null,
    reason,
    message,
    blockedReason,
    prerequisites,
    evidence,
  };
}

function localPrerequisites(extra: string[]) {
  return [
    ...extra,
    "등록 IP 이력만으로는 Shopee OAuth를 시작하지 않습니다.",
    "이 경로는 oauth.exchange 만 허용하며 refresh는 포함하지 않습니다.",
    "미해결 OAuth recon이 있으면 기존 enqueue fence가 그대로 차단합니다. 이 프리플라이트는 recon을 조회하지 않습니다.",
  ];
}

function readGatewayWorker(runtimeStatus: unknown) {
  const root = objectRecord(runtimeStatus);
  const workers = objectRecord(root?.workers);
  const workerKeys = workers ? Object.keys(workers) : [];
  const gateway = objectRecord(workers?.[SHOPEE_OAUTH_LOCAL_GATEWAY_SCOPE]);
  return { workers, workerKeys, gateway };
}

function resolveLocalGatewayReadiness(
  input: ShopeeOAuthExecutorReadinessInput,
  evidenceBase: Omit<ShopeeOAuthExecutorReadiness["evidence"], "localGatewayScopePresent" | "localGatewayHeartbeatAgeMs">,
): ShopeeOAuthExecutorReadiness {
  const nowMs = input.nowMs ?? Date.now();
  const evidence = (
    localGatewayScopePresent: boolean,
    localGatewayHeartbeatAgeMs: number | null,
  ): ShopeeOAuthExecutorReadiness["evidence"] => ({
    ...evidenceBase,
    localGatewayScopePresent,
    localGatewayHeartbeatAgeMs,
  });

  if (!input.runtimeStatusAvailable) {
    return blocked(
      "local_gateway_status_unavailable",
      "로컬 Mac gateway 작업자 상태를 확인하지 못해 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        "관리자 세션으로 sellerpilot_ai_runtime_status.workers.gateway.last_seen_at 를 다시 확인하세요.",
      ]),
      evidence(false, null),
    );
  }

  const { workers, workerKeys, gateway } = readGatewayWorker(input.runtimeStatus);
  if (!workers) {
    return blocked(
      "local_gateway_missing",
      "로컬 Mac gateway 작업자가 없어 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        "Mac에서 scope=gateway 워커를 실행해 workers.gateway 하트비트를 남기세요.",
      ]),
      evidence(false, null),
    );
  }
  if (!gateway) {
    const wrongScope = workerKeys.some((scope) => scope !== SHOPEE_OAUTH_LOCAL_GATEWAY_SCOPE);
    return blocked(
      wrongScope ? "local_gateway_wrong_scope" : "local_gateway_missing",
      wrongScope
        ? "활성 작업자가 gateway 스코프가 아니어서 Shopee OAuth를 시작하지 않았습니다."
        : "로컬 Mac gateway 작업자가 활성 상태가 아니어서 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        wrongScope
          ? "serverless_cs 또는 ai 스코프가 아니라 활성 scope=gateway 토큰이 필요합니다."
          : "만료/비활성 토큰이 아니라 활성 scope=gateway 워커가 필요합니다.",
      ]),
      evidence(false, null),
    );
  }

  const declaredScope = gateway.scope;
  if (declaredScope != null && declaredScope !== SHOPEE_OAUTH_LOCAL_GATEWAY_SCOPE) {
    return blocked(
      "local_gateway_wrong_scope",
      "활성 작업자가 gateway 스코프가 아니어서 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        "workers.gateway 스냅샷의 scope 가 gateway 여야 합니다.",
      ]),
      evidence(true, null),
    );
  }

  const lastSeenAt = gateway.last_seen_at;
  if (typeof lastSeenAt !== "string" || !lastSeenAt.trim()) {
    return blocked(
      "local_gateway_heartbeat_missing",
      "로컬 Mac gateway 작업자의 최근 연결 신호가 없어 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        "gateway 워커가 claim 루프를 돌아 workers.gateway.last_seen_at 을 갱신하게 하세요.",
      ]),
      evidence(true, null),
    );
  }

  const lastSeenMs = Date.parse(lastSeenAt);
  const heartbeatAgeMs = nowMs - lastSeenMs;
  if (!Number.isFinite(lastSeenMs)
      || heartbeatAgeMs < -SHOPEE_OAUTH_LOCAL_GATEWAY_CLOCK_SKEW_MS
      || heartbeatAgeMs >= SHOPEE_OAUTH_LOCAL_GATEWAY_FRESHNESS_MS) {
    return blocked(
      "local_gateway_heartbeat_stale",
      "로컬 Mac gateway 작업자의 연결 신호가 만료되어 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        `workers.gateway.last_seen_at 이 ${SHOPEE_OAUTH_LOCAL_GATEWAY_FRESHNESS_MS / 1000}초 이내여야 합니다. 과거 하트비트는 실행 증명이 아닙니다.`,
      ]),
      evidence(true, Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : null),
    );
  }

  const lastVersion = typeof gateway.last_version === "string" ? gateway.last_version.trim() : "";
  if (!lastVersion || lastVersion.startsWith(SERVERLESS_CS_WORKER_VERSION_PREFIX)) {
    return blocked(
      "local_gateway_ability_unproven",
      "로컬 Mac gateway 작업자의 실행 신원을 증명하지 못해 Shopee OAuth를 시작하지 않았습니다.",
      "LOCAL_GATEWAY_WORKER_REQUIRED",
      localPrerequisites([
        "workers.gateway.last_version 이 비어 있거나 serverless CS 버전이면 로컬 실행기로 보지 않습니다.",
      ]),
      evidence(true, heartbeatAgeMs),
    );
  }

  return {
    allowed: true,
    mode: "local_mac_gateway",
    reason: "ready_local_mac_gateway",
    message: "로컬 Mac gateway 작업자가 Shopee OAuth 코드 교환을 실행할 수 있습니다.",
    blockedReason: null,
    prerequisites: localPrerequisites([]),
    evidence: evidence(true, heartbeatAgeMs),
  };
}

export function resolveShopeeOAuthExecutorReadiness(
  input: ShopeeOAuthExecutorReadinessInput,
): ShopeeOAuthExecutorReadiness {
  const evidenceBase = {
    envStaticEgress: input.envConfigured,
    databaseStaticEgress: input.staticEgressRpcError ? null : input.databaseAllows,
    reconProbed: false as const,
  };

  if (input.staticEgressRpcError) {
    return blocked(
      "static_egress_status_unavailable",
      "Shopee static egress 정책 상태를 확인하지 못해 OAuth 실행기를 증명하지 못했습니다.",
      "STATIC_EGRESS_STATUS_UNAVAILABLE",
      [
        "sellerpilot_service_serverless_static_egress_status 를 다시 확인하세요.",
        "정책 상태를 모르는 채 로컬/서버리스 실행을 가정하지 않습니다.",
        "등록 IP 이력만으로는 Shopee OAuth를 시작하지 않습니다.",
      ],
      {
        ...evidenceBase,
        localGatewayScopePresent: false,
        localGatewayHeartbeatAgeMs: null,
      },
    );
  }

  if (input.envConfigured && input.databaseAllows) {
    const cs = input.serverlessCs;
    const csReady = input.serverlessCsError !== true
      && cs?.configured === true
      && cs?.active === true;
    if (!csReady) {
      return blocked(
        "serverless_worker_required",
        "Shopee OAuth 작업자가 활성 상태가 아니어서 판매자 승인을 시작하지 않았습니다. 작업자 상태를 확인해 주세요.",
        "SERVERLESS_WORKER_REQUIRED",
        [
          "서버리스 static egress 증적이 있어 CS wakeup configured=true 이고 active=true 여야 합니다.",
          "이 모드에서는 로컬 last_seen 만으로 우회하지 않습니다.",
        ],
        {
          ...evidenceBase,
          localGatewayScopePresent: false,
          localGatewayHeartbeatAgeMs: null,
        },
      );
    }
    return {
      allowed: true,
      mode: "serverless_static_egress",
      reason: "ready_serverless_static_egress",
      message: "서버리스 static egress 증적과 CS 작업자가 Shopee OAuth 코드 교환을 실행할 수 있습니다.",
      blockedReason: null,
      prerequisites: [
        "이 경로는 oauth.exchange 만 허용하며 refresh는 포함하지 않습니다.",
        "미해결 OAuth recon이 있으면 기존 enqueue fence가 그대로 차단합니다. 이 프리플라이트는 recon을 조회하지 않습니다.",
      ],
      evidence: {
        ...evidenceBase,
        localGatewayScopePresent: false,
        localGatewayHeartbeatAgeMs: null,
      },
    };
  }

  if (input.databaseAllows && !input.envConfigured) {
    return blocked(
      "executor_exclusive_unproven",
      "Shopee OAuth 실행기를 배타적으로 증명하지 못해 시작하지 않았습니다.",
      "SHOPEE_OAUTH_EXECUTOR_UNPROVEN",
      [
        "DB serverless static egress 가 shopee=true 인데 env 증적이 없어 서버리스가 oauth.exchange 를 가져갈 수 있습니다.",
        "서버리스 모드를 쓰려면 env와 DB 증적이 모두 필요하고 CS wakeup이 active여야 합니다.",
        "로컬 Mac 모드를 쓰려면 DB shopee static egress 가 false 이고 workers.gateway.last_seen_at 이 신선해야 합니다.",
        "env만 켜서 static egress를 가장하지 마세요.",
        "등록 IP 이력만으로는 Shopee OAuth를 시작하지 않습니다.",
      ],
      {
        ...evidenceBase,
        localGatewayScopePresent: false,
        localGatewayHeartbeatAgeMs: null,
      },
    );
  }

  return resolveLocalGatewayReadiness(input, evidenceBase);
}
