import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { expandStudioCleanupStoragePaths } from "../../../../lib/studio-image-paths";
import { supabaseUrl } from "../../../../lib/supabase/config";
import {
  dispatchPendingPushNotifications,
  getPushPublicConfiguration,
} from "../../../../lib/push-notifications";
import { createBoundedSupabaseFetch } from "../../../../lib/worker-rpc";
import {
  internalScheduleAuthorization,
  internalScheduleCanaryPayload,
  internalScheduleRequestMode,
  runtimeStatusMatchesCurrentRelease,
} from "../../../../lib/internal-scheduler-auth";
import { deadlineAfter, deadlineRemaining } from "../../../../lib/time-deadline";

export const runtime = "nodejs";
export const maxDuration = 300;

type PrunedJob = {
  job_id: string;
  input_paths: string[] | null;
  result_paths: string[] | null;
};

type AiStorageCleanupClaim = {
  claimToken: string;
  bucket: "sellerpilot-ai";
  paths: string[];
};

type MarketplaceStorageCleanupClaim = {
  claimToken: string;
  bucket: "sellerpilot-marketplace";
  paths: string[];
};

type StaleAiJobRecovery = {
  ok: boolean;
  queuedExpired: number;
  runningExpired: number;
  total: number;
};

type StaleGatewayJobRecovery = {
  ok: boolean;
  retried: number;
  failed: number;
  reconciliationRequired: number;
  oauthCompleted: number;
  total: number;
};

type StalePushDeliveryRecovery = {
  ok: boolean;
  retried: number;
  reconciliationRequired: number;
  total: number;
};

const STALE_AI_QUEUED_TIMEOUT_MS = 24 * 60 * 60_000;
const STALE_AI_RECOVERY_LIMIT = 100;
const STALE_GATEWAY_RECOVERY_LIMIT = 100;
const STALE_PUSH_DELIVERY_RECOVERY_LIMIT = 100;
const MAINTENANCE_SUPABASE_TIMEOUT_MS = 8_000;
const RUNTIME_NOISE_RETENTION_DAYS = 7;
const MAINTENANCE_WORK_BUDGET_MS = 240_000;
const MAINTENANCE_RPC_STAGE_RESERVE_MS = 25_000;
const MAINTENANCE_STORAGE_STAGE_RESERVE_MS = 45_000;
const MAINTENANCE_PUSH_START_RESERVE_MS = 60_000;
const MAINTENANCE_PUSH_FINALIZATION_RESERVE_MS = 15_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function aiStorageCleanupClaim(value: unknown): AiStorageCleanupClaim | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_storage_cleanup_claim");
  const candidate = value as Record<string, unknown>;
  if (!UUID_PATTERN.test(String(candidate.claimToken ?? "")) || candidate.bucket !== "sellerpilot-ai") {
    throw new Error("invalid_storage_cleanup_claim");
  }
  if (!Array.isArray(candidate.paths) || candidate.paths.length < 1 || candidate.paths.length > 500) {
    throw new Error("invalid_storage_cleanup_claim");
  }
  const paths = candidate.paths.filter((path): path is string => typeof path === "string");
  if (paths.length !== candidate.paths.length
      || new Set(paths).size !== paths.length
      || paths.some((path) => path.length > 1_000
        || path.startsWith("/")
        || path.split("/").some((segment) => segment === "." || segment === ".."))) {
    throw new Error("invalid_storage_cleanup_claim");
  }
  return { claimToken: String(candidate.claimToken), bucket: "sellerpilot-ai", paths };
}

function marketplaceStorageCleanupClaim(value: unknown): MarketplaceStorageCleanupClaim | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_marketplace_storage_cleanup_claim");
  }
  const candidate = value as Record<string, unknown>;
  if (!UUID_PATTERN.test(String(candidate.claimToken ?? "")) || candidate.bucket !== "sellerpilot-marketplace") {
    throw new Error("invalid_marketplace_storage_cleanup_claim");
  }
  if (!Array.isArray(candidate.paths) || candidate.paths.length < 1 || candidate.paths.length > 500) {
    throw new Error("invalid_marketplace_storage_cleanup_claim");
  }
  const paths = candidate.paths.filter((path): path is string => typeof path === "string");
  if (paths.length !== candidate.paths.length
      || new Set(paths).size !== paths.length
      || paths.some((path) => path.length > 1_000
        || !/^normalized\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/.test(path))) {
    throw new Error("invalid_marketplace_storage_cleanup_claim");
  }
  return { claimToken: String(candidate.claimToken), bucket: "sellerpilot-marketplace", paths };
}

async function cleanupPrunedAiStorage(serviceClient: SupabaseClient) {
  const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_ai_storage_cleanup", {
    p_limit: 200,
    p_lease_seconds: 120,
  });
  if (error) throw new Error("storage_cleanup_claim_failed");
  const claim = aiStorageCleanupClaim(data);
  if (!claim) return { claimed: 0, removed: 0, requeued: 0, failed: false };

  const storagePaths = expandStudioCleanupStoragePaths(claim.paths);
  const { error: removeError } = await serviceClient.storage.from(claim.bucket).remove(storagePaths);
  const removedPaths = removeError ? [] : claim.paths;
  const { data: completion, error: completionError } = await serviceClient.rpc(
    "sellerpilot_service_complete_ai_storage_cleanup",
    {
      p_claim_token: claim.claimToken,
      p_removed_paths: removedPaths,
      p_error: removeError ? "storage_remove_failed" : null,
    },
  );
  if (completionError || !completion || typeof completion !== "object" || Array.isArray(completion)) {
    throw new Error("storage_cleanup_completion_failed");
  }
  const outcome = completion as Record<string, unknown>;
  const removed = Number(outcome.removed ?? 0);
  const requeued = Number(outcome.requeued ?? 0);
  if (!Number.isInteger(removed) || removed < 0 || !Number.isInteger(requeued) || requeued < 0) {
    throw new Error("storage_cleanup_completion_invalid");
  }
  return { claimed: claim.paths.length, removed, requeued, failed: Boolean(removeError) };
}

async function cleanupPrunedMarketplaceStorage(serviceClient: SupabaseClient) {
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_service_claim_marketplace_normalized_asset_cleanup",
    { p_limit: 200, p_lease_seconds: 120 },
  );
  if (error) throw new Error("marketplace_storage_cleanup_claim_failed");
  const claim = marketplaceStorageCleanupClaim(data);
  if (!claim) return { claimed: 0, removed: 0, requeued: 0, failed: false };

  const { error: removeError } = await serviceClient.storage.from(claim.bucket).remove(claim.paths);
  const removedPaths = removeError ? [] : claim.paths;
  const { data: completion, error: completionError } = await serviceClient.rpc(
    "sellerpilot_service_complete_marketplace_normalized_asset_cleanup",
    {
      p_claim_token: claim.claimToken,
      p_removed_paths: removedPaths,
      p_error: removeError ? "storage_remove_failed" : null,
    },
  );
  if (completionError || !completion || typeof completion !== "object" || Array.isArray(completion)) {
    throw new Error("marketplace_storage_cleanup_completion_failed");
  }
  const outcome = completion as Record<string, unknown>;
  const removed = Number(outcome.removed ?? 0);
  const requeued = Number(outcome.requeued ?? 0);
  if (!Number.isInteger(removed) || removed < 0 || !Number.isInteger(requeued) || requeued < 0) {
    throw new Error("marketplace_storage_cleanup_completion_invalid");
  }
  return { claimed: claim.paths.length, removed, requeued, failed: Boolean(removeError) };
}

function staleAiJobRecovery(value: unknown): Omit<StaleAiJobRecovery, "ok"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_stale_ai_job_recovery");
  }
  const candidate = value as Record<string, unknown>;
  const queuedExpired = Number(candidate.queuedExpired);
  const runningExpired = Number(candidate.runningExpired);
  const total = Number(candidate.total);
  if (!Number.isInteger(queuedExpired)
      || queuedExpired < 0
      || !Number.isInteger(runningExpired)
      || runningExpired < 0
      || !Number.isInteger(total)
      || total !== queuedExpired + runningExpired
      || total > STALE_AI_RECOVERY_LIMIT) {
    throw new Error("invalid_stale_ai_job_recovery");
  }
  return { queuedExpired, runningExpired, total };
}

async function expireStaleAiJobs(serviceClient: SupabaseClient): Promise<StaleAiJobRecovery> {
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_expire_stale_ai_jobs", {
      p_queued_before: new Date(Date.now() - STALE_AI_QUEUED_TIMEOUT_MS).toISOString(),
      p_limit: STALE_AI_RECOVERY_LIMIT,
    });
    if (error) throw new Error("stale_ai_job_recovery_failed");
    return { ok: true, ...staleAiJobRecovery(data) };
  } catch {
    return { ok: false, queuedExpired: 0, runningExpired: 0, total: 0 };
  }
}

function staleGatewayJobRecovery(value: unknown): Omit<StaleGatewayJobRecovery, "ok"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_stale_gateway_job_recovery");
  }
  const candidate = value as Record<string, unknown>;
  const retried = Number(candidate.retried);
  const failed = Number(candidate.failed);
  const reconciliationRequired = Number(candidate.reconciliationRequired);
  const oauthCompleted = Number(candidate.oauthCompleted);
  const total = Number(candidate.total);
  const counts = [retried, failed, reconciliationRequired, oauthCompleted];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)
      || !Number.isInteger(total)
      || total !== retried + failed + reconciliationRequired + oauthCompleted
      || total > STALE_GATEWAY_RECOVERY_LIMIT) {
    throw new Error("invalid_stale_gateway_job_recovery");
  }
  return { retried, failed, reconciliationRequired, oauthCompleted, total };
}

async function reapStaleGatewayJobs(serviceClient: SupabaseClient): Promise<StaleGatewayJobRecovery> {
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_reap_stale_channel_gateway_jobs", {
      p_limit: STALE_GATEWAY_RECOVERY_LIMIT,
    });
    if (error) throw new Error("stale_gateway_job_recovery_failed");
    return { ok: true, ...staleGatewayJobRecovery(data) };
  } catch {
    return {
      ok: false,
      retried: 0,
      failed: 0,
      reconciliationRequired: 0,
      oauthCompleted: 0,
      total: 0,
    };
  }
}

function stalePushDeliveryRecovery(value: unknown): Omit<StalePushDeliveryRecovery, "ok"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_stale_push_delivery_recovery");
  }
  const candidate = value as Record<string, unknown>;
  const retried = Number(candidate.retried);
  const reconciliationRequired = Number(candidate.reconciliationRequired);
  const total = Number(candidate.total);
  if (!Number.isInteger(retried)
      || retried < 0
      || !Number.isInteger(reconciliationRequired)
      || reconciliationRequired < 0
      || !Number.isInteger(total)
      || total !== retried + reconciliationRequired
      || total > STALE_PUSH_DELIVERY_RECOVERY_LIMIT) {
    throw new Error("invalid_stale_push_delivery_recovery");
  }
  return { retried, reconciliationRequired, total };
}

async function reapStalePushDeliveries(serviceClient: SupabaseClient): Promise<StalePushDeliveryRecovery> {
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_reap_stale_push_deliveries", {
      p_limit: STALE_PUSH_DELIVERY_RECOVERY_LIMIT,
    });
    if (error) throw new Error("stale_push_delivery_recovery_failed");
    return { ok: true, ...stalePushDeliveryRecovery(data) };
  } catch {
    return { ok: false, retried: 0, reconciliationRequired: 0, total: 0 };
  }
}

function maintenanceHasBudget(deadlineMs: number, reserveMs: number) {
  return deadlineRemaining(deadlineMs) >= reserveMs;
}

function maintenanceDeadlineResponse(
  stage: string,
  staleAiJobsRecovery: StaleAiJobRecovery,
  staleGatewayJobsRecovery: StaleGatewayJobRecovery,
  stalePushDeliveryRecovery: StalePushDeliveryRecovery,
) {
  return NextResponse.json({
    ok: false,
    message: "정리 작업의 안전 실행 시간이 부족해 남은 단계는 다음 일정으로 이월했습니다.",
    stage,
    staleAiJobsRecovery,
    staleGatewayJobsRecovery,
    stalePushDeliveryRecovery,
  }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
}

type MaintenanceRetentionStage =
  | "ai_jobs_prune"
  | "personal_data_prune"
  | "runtime_noise_prune"
  | "kakao_notification_sweep"
  | "kakao_oauth_sweep"
  | "tracx_mutation_sweep"
  | "lazada_reply_sweep"
  | "worker_token_expiry";

function safeMaintenanceRpcErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z0-9_.-]{1,32}$/i.test(code)
    ? code
    : "unknown";
}

function maintenanceRetentionFailureResponse(
  stage: MaintenanceRetentionStage,
  error: unknown,
  staleAiJobsRecovery: StaleAiJobRecovery,
  staleGatewayJobsRecovery: StaleGatewayJobRecovery,
  stalePushDeliveryRecovery: StalePushDeliveryRecovery,
) {
  const code = safeMaintenanceRpcErrorCode(error);
  console.error("maintenance retention RPC failed", { stage, code, status: 500 });
  return NextResponse.json({
    ok: false,
    message: "보관기간 정리를 완료하지 못했습니다.",
    stage,
    code,
    staleAiJobsRecovery,
    staleGatewayJobsRecovery,
    stalePushDeliveryRecovery,
  }, { status: 500, headers: { "cache-control": "no-store, max-age=0" } });
}

type ActiveCredential = {
  credential_id?: unknown;
  secret_payload?: unknown;
};

function textValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

type RefreshChannel = "shopee" | "lazada" | "ebay";

const refreshBufferMs: Record<RefreshChannel, number> = {
  shopee: 60 * 60 * 1000,
  lazada: 72 * 60 * 60 * 1000,
  ebay: 30 * 60 * 1000,
};

function refreshPrerequisiteStatus(channel: RefreshChannel, secret: Record<string, unknown>) {
  const refreshToken = textValue(secret, "refresh_token");
  const refreshExpiresAt = Date.parse(textValue(secret, "refresh_token_expires_at"));
  if (!refreshToken) return "awaiting_oauth" as const;
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= Date.now()) return "refresh_expired" as const;
  if (channel === "shopee") {
    if (!textValue(secret, "partner_id") || !textValue(secret, "partner_key") || !textValue(secret, "shop_id")) {
      return "awaiting_oauth" as const;
    }
    const authorizationExpiresAt = Date.parse(textValue(secret, "authorization_expires_at"));
    if (Number.isFinite(authorizationExpiresAt) && authorizationExpiresAt <= Date.now()) return "authorization_expired" as const;
  }
  if (channel === "lazada" && (!textValue(secret, "app_key") || !textValue(secret, "app_secret"))) {
    return "awaiting_oauth" as const;
  }
  if (channel === "ebay" && (
    !textValue(secret, "client_id")
    || !textValue(secret, "client_secret")
    || !textValue(secret, "ru_name")
  )) {
    return "awaiting_oauth" as const;
  }
  return null;
}

async function queueRefreshIfNeeded(serviceClient: SupabaseClient, channel: RefreshChannel) {
  const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: channel,
    p_environment: "production",
  });
  if (error) throw new Error("credential_read_failed");
  const active = data as ActiveCredential | null;
  if (!active?.credential_id
      || typeof active.credential_id !== "string"
      || !active.secret_payload
      || typeof active.secret_payload !== "object"
      || Array.isArray(active.secret_payload)) {
    return { status: "not_connected" as const };
  }

  const secret = active.secret_payload as Record<string, unknown>;
  const accessExpiresAt = Date.parse(textValue(secret, "access_token_expires_at"));
  if (Number.isFinite(accessExpiresAt) && accessExpiresAt > Date.now() + refreshBufferMs[channel]) {
    return { status: "current" as const };
  }
  const prerequisiteStatus = refreshPrerequisiteStatus(channel, secret);
  if (prerequisiteStatus) return { status: prerequisiteStatus };

  // Token exchange is a provider mutation. Queue an exact-claim gateway job so
  // the worker stages every received token in Vault before any later work and
  // leaves a lost response in reconciliation instead of retrying the exchange.
  const { data: jobId, error: enqueueError } = await serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
    p_credential_id: active.credential_id,
    p_attempt_id: null,
    p_channel: channel,
    p_operation: "diagnostic.test",
    p_request_payload: {},
  });
  if (enqueueError || typeof jobId !== "string") throw new Error("credential_refresh_enqueue_failed");
  return { status: "queued" as const };
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = internalScheduleAuthorization(
    request.headers.get("authorization"),
    cronSecret,
  );
  if (authorization === "missing") {
    return NextResponse.json({ message: "정리 작업 인증값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (authorization !== "authorized") {
    return NextResponse.json({ message: "정리 작업 인증이 필요합니다." }, { status: 401 });
  }
  const requestedMode = internalScheduleRequestMode(request);
  if (requestedMode === "invalid") {
    return NextResponse.json({ message: "정리 작업 실행 모드를 확인하지 못했습니다." }, { status: 400 });
  }
  if (requestedMode === "canary") {
    return NextResponse.json(internalScheduleCanaryPayload());
  }

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(MAINTENANCE_SUPABASE_TIMEOUT_MS) },
  });
  const { data: runtimeStatus, error: runtimeStatusError } = await serviceClient.rpc(
    "sellerpilot_service_serverless_cs_wakeup_status",
  );
  if (runtimeStatusError || !runtimeStatusMatchesCurrentRelease(runtimeStatus)) {
    return NextResponse.json(
      { message: "서버 일정이 활성화되지 않아 정리 작업을 실행하지 않았습니다." },
      { status: 503, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
  const maintenanceDeadline = deadlineAfter(MAINTENANCE_WORK_BUDGET_MS);
  // Run independently of OAuth and retention work. A missing AI worker must
  // not leave registration cards in `analyzing` forever, and a recovery error
  // must not prevent the unrelated cleanup steps below from being attempted.
  const [staleAiJobsRecovery, staleGatewayJobsRecovery, stalePushDeliveryRecovery] = await Promise.all([
    expireStaleAiJobs(serviceClient),
    reapStaleGatewayJobs(serviceClient),
    reapStalePushDeliveries(serviceClient),
  ]);
  if (!maintenanceHasBudget(maintenanceDeadline, MAINTENANCE_RPC_STAGE_RESERVE_MS)) {
    return maintenanceDeadlineResponse(
      "oauth_maintenance",
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    );
  }
  let lazadaToken: Awaited<ReturnType<typeof queueRefreshIfNeeded>>;
  let ebayToken: Awaited<ReturnType<typeof queueRefreshIfNeeded>>;
  let shopeeToken: Awaited<ReturnType<typeof queueRefreshIfNeeded>>;
  try {
    [shopeeToken, lazadaToken, ebayToken] = await Promise.all([
      queueRefreshIfNeeded(serviceClient, "shopee"),
      queueRefreshIfNeeded(serviceClient, "lazada"),
      queueRefreshIfNeeded(serviceClient, "ebay"),
    ]);
  } catch {
    return NextResponse.json({
      message: "채널 OAuth 토큰 자동 갱신을 완료하지 못했습니다.",
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (!maintenanceHasBudget(maintenanceDeadline, MAINTENANCE_RPC_STAGE_RESERVE_MS)) {
    return maintenanceDeadlineResponse(
      "retention_ledger",
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    );
  }
  const retentionDays = 30;
  const completedBefore = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const runtimeCompletedBefore = new Date(
    Date.now() - RUNTIME_NOISE_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const [
    { data, error },
    { data: kakaoReconciliationRequired, error: kakaoSweepError },
    { data: kakaoOauthReconciliationRequired, error: kakaoOauthSweepError },
    { data: tracxReconciliationRequired, error: tracxSweepError },
    { data: lazadaReplyReconciliationRequired, error: lazadaReplySweepError },
    { data: pendingWorkerTokensExpired, error: pendingWorkerTokenExpiryError },
  ] = await Promise.all([
    serviceClient.rpc("sellerpilot_prune_ai_jobs", {
      p_completed_before: completedBefore,
      p_limit: 200,
    }),
    serviceClient.rpc("sellerpilot_service_sweep_stale_kakao_notifications"),
    serviceClient.rpc("sellerpilot_service_sweep_kakao_oauth_callbacks"),
    serviceClient.rpc("sellerpilot_service_sweep_stale_tracx_mutations"),
    serviceClient.rpc("sellerpilot_service_sweep_stale_lazada_replies"),
    serviceClient.rpc("sellerpilot_service_expire_pending_worker_token_sets"),
  ]);
  // These two functions can delete overlapping terminal gateway rows. Keep
  // them sequential while still attempting every independent retention sweep.
  const { data: personalData, error: personalDataError } = await serviceClient.rpc(
    "sellerpilot_prune_personal_data",
    { p_completed_before: completedBefore },
  );
  const { data: runtimeData, error: runtimeDataError } = await serviceClient.rpc(
    "sellerpilot_service_prune_runtime_noise",
    { p_completed_before: runtimeCompletedBefore },
  );
  const retentionFailure = ([
    ["ai_jobs_prune", error],
    ["personal_data_prune", personalDataError],
    ["runtime_noise_prune", runtimeDataError],
    ["kakao_notification_sweep", kakaoSweepError],
    ["kakao_oauth_sweep", kakaoOauthSweepError],
    ["tracx_mutation_sweep", tracxSweepError],
    ["lazada_reply_sweep", lazadaReplySweepError],
    ["worker_token_expiry", pendingWorkerTokenExpiryError],
  ] as const).find(([, candidate]) => candidate);
  if (retentionFailure) {
    return maintenanceRetentionFailureResponse(
      retentionFailure[0],
      retentionFailure[1],
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    );
  }

  const rows = (data ?? []) as PrunedJob[];
  const storagePaths = rows.flatMap((row) => [
    ...(Array.isArray(row.input_paths) ? row.input_paths : []),
    ...(Array.isArray(row.result_paths) ? row.result_paths : []),
  ]);
  if (!maintenanceHasBudget(maintenanceDeadline, MAINTENANCE_STORAGE_STAGE_RESERVE_MS)) {
    return maintenanceDeadlineResponse(
      "ai_storage_cleanup",
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    );
  }
  let storageCleanup: Awaited<ReturnType<typeof cleanupPrunedAiStorage>>;
  try {
    storageCleanup = await cleanupPrunedAiStorage(serviceClient);
  } catch {
    return NextResponse.json({
      message: "AI 이미지 보관기간 정리 대기열을 완료하지 못했습니다. 삭제 대상은 재시도용으로 보존됩니다.",
      retentionDays,
      jobsPruned: rows.length,
      storageQueued: storagePaths.length,
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (storageCleanup.failed) {
    return NextResponse.json({
      message: "AI 이미지 저장소 정리가 지연되어 삭제 대상을 다시 대기열에 넣었습니다.",
      retentionDays,
      jobsPruned: rows.length,
      storageQueued: storagePaths.length,
      storageClaimed: storageCleanup.claimed,
      storageRemoved: storageCleanup.removed,
      storageRequeued: storageCleanup.requeued,
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (!maintenanceHasBudget(maintenanceDeadline, MAINTENANCE_STORAGE_STAGE_RESERVE_MS)) {
    return maintenanceDeadlineResponse(
      "marketplace_storage_cleanup",
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    );
  }
  let marketplaceStorageCleanup: Awaited<ReturnType<typeof cleanupPrunedMarketplaceStorage>>;
  try {
    marketplaceStorageCleanup = await cleanupPrunedMarketplaceStorage(serviceClient);
  } catch {
    return NextResponse.json({
      message: "판매채널용 이미지 보관기간 정리 대기열을 완료하지 못했습니다. 삭제 대상은 재시도용으로 보존됩니다.",
      retentionDays,
      jobsPruned: rows.length,
      storageQueued: storagePaths.length,
      storageClaimed: storageCleanup.claimed,
      storageRemoved: storageCleanup.removed,
      storageRequeued: storageCleanup.requeued,
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (marketplaceStorageCleanup.failed) {
    return NextResponse.json({
      message: "판매채널용 이미지 저장소 정리가 지연되어 삭제 대상을 다시 대기열에 넣었습니다.",
      retentionDays,
      jobsPruned: rows.length,
      storageQueued: storagePaths.length,
      storageClaimed: storageCleanup.claimed,
      storageRemoved: storageCleanup.removed,
      storageRequeued: storageCleanup.requeued,
      marketplaceStorageClaimed: marketplaceStorageCleanup.claimed,
      marketplaceStorageRemoved: marketplaceStorageCleanup.removed,
      marketplaceStorageRequeued: marketplaceStorageCleanup.requeued,
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const pushDeferred = !maintenanceHasBudget(
    maintenanceDeadline,
    MAINTENANCE_PUSH_START_RESERVE_MS,
  );
  const push = pushDeferred
    ? {
        configured: getPushPublicConfiguration().configured,
        claimed: 0,
        sent: 0,
        failed: 0,
        reconciliationRequired: 0,
        deferred: 0,
        finalizationFailed: 0,
      }
    : await dispatchPendingPushNotifications(serviceClient, 100, {
        deadlineMs: maintenanceDeadline,
        finalizationReserveMs: MAINTENANCE_PUSH_FINALIZATION_RESERVE_MS,
      }).catch(() => ({
        configured: true,
        claimed: 0,
        sent: 0,
        failed: 0,
        reconciliationRequired: 0,
        deferred: 0,
        finalizationFailed: 1,
      }));
  const pushRequiresAttention = push.reconciliationRequired > 0 || push.finalizationFailed > 0;

  if (!staleAiJobsRecovery.ok || !staleGatewayJobsRecovery.ok || !stalePushDeliveryRecovery.ok) {
    return NextResponse.json({
      ok: false,
      message: "멈춘 AI 분석·채널 작업 또는 알림 전송의 자동 복구를 완료하지 못했습니다. 다른 정리 작업 결과는 아래에 보존했습니다.",
      retentionDays,
      jobsPruned: rows.length,
      storageQueued: storagePaths.length,
      storageClaimed: storageCleanup.claimed,
      storageRemoved: storageCleanup.removed,
      storageRequeued: storageCleanup.requeued,
      marketplaceStorageClaimed: marketplaceStorageCleanup.claimed,
      marketplaceStorageRemoved: marketplaceStorageCleanup.removed,
      marketplaceStorageRequeued: marketplaceStorageCleanup.requeued,
      staleAiJobsRecovery,
      staleGatewayJobsRecovery,
      stalePushDeliveryRecovery,
      personalData,
      runtimeData,
      kakaoReconciliationRequired,
      kakaoOauthReconciliationRequired,
      tracxReconciliationRequired,
      lazadaReplyReconciliationRequired,
      pendingWorkerTokensExpired,
      shopeeToken: shopeeToken.status,
      lazadaToken: lazadaToken.status,
      ebayToken: ebayToken.status,
      push: {
        configured: push.configured,
        sent: push.sent,
        failed: push.failed,
        reconciliationRequired: push.reconciliationRequired,
        deferred: pushDeferred || push.deferred > 0,
        finalizationFailed: push.finalizationFailed,
      },
      completedAt: new Date().toISOString(),
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }

  return NextResponse.json({
    ok: !pushRequiresAttention,
    retentionDays,
    jobsPruned: rows.length,
    storageQueued: storagePaths.length,
    storageClaimed: storageCleanup.claimed,
    storageRemoved: storageCleanup.removed,
    storageRequeued: storageCleanup.requeued,
    marketplaceStorageClaimed: marketplaceStorageCleanup.claimed,
    marketplaceStorageRemoved: marketplaceStorageCleanup.removed,
    marketplaceStorageRequeued: marketplaceStorageCleanup.requeued,
    staleAiJobsRecovery,
    staleGatewayJobsRecovery,
    stalePushDeliveryRecovery,
    personalData,
    runtimeData,
    kakaoReconciliationRequired,
    kakaoOauthReconciliationRequired,
    tracxReconciliationRequired,
    lazadaReplyReconciliationRequired,
    pendingWorkerTokensExpired,
    shopeeToken: shopeeToken.status,
    lazadaToken: lazadaToken.status,
    ebayToken: ebayToken.status,
    push: {
      configured: push.configured,
      sent: push.sent,
      failed: push.failed,
      reconciliationRequired: push.reconciliationRequired,
      deferred: pushDeferred || push.deferred > 0,
      finalizationFailed: push.finalizationFailed,
    },
    completedAt: new Date().toISOString(),
  }, {
    status: pushRequiresAttention ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
