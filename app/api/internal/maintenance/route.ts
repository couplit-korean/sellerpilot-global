import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { expandStudioCleanupStoragePaths } from "../../../../lib/studio-image-paths";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { dispatchPendingPushNotifications } from "../../../../lib/push-notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const authorization = request.headers.get("authorization") ?? "";
  if (!cronSecret) {
    return NextResponse.json({ message: "정리 작업 인증값이 설정되지 않았습니다." }, { status: 503 });
  }
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "정리 작업 인증이 필요합니다." }, { status: 401 });
  }

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "Supabase 서버 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
    return NextResponse.json({ message: "채널 OAuth 토큰 자동 갱신을 완료하지 못했습니다." }, { status: 502 });
  }
  const retentionDays = 30;
  const completedBefore = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const runtimeCompletedBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [
    { data, error },
    { data: personalData, error: personalDataError },
    { data: runtimeData, error: runtimeDataError },
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
    serviceClient.rpc("sellerpilot_prune_personal_data", {
      p_completed_before: completedBefore,
    }),
    serviceClient.rpc("sellerpilot_service_prune_runtime_noise", {
      p_completed_before: runtimeCompletedBefore,
    }),
    serviceClient.rpc("sellerpilot_service_sweep_stale_kakao_notifications"),
    serviceClient.rpc("sellerpilot_service_sweep_kakao_oauth_callbacks"),
    serviceClient.rpc("sellerpilot_service_sweep_stale_tracx_mutations"),
    serviceClient.rpc("sellerpilot_service_sweep_stale_lazada_replies"),
    serviceClient.rpc("sellerpilot_service_expire_pending_worker_token_sets"),
  ]);
  if (error
      || personalDataError
      || runtimeDataError
      || kakaoSweepError
      || kakaoOauthSweepError
      || tracxSweepError
      || lazadaReplySweepError
      || pendingWorkerTokenExpiryError) {
    return NextResponse.json({ message: "30일 보관기간 정리를 완료하지 못했습니다." }, { status: 500 });
  }

  const rows = (data ?? []) as PrunedJob[];
  const storagePaths = rows.flatMap((row) => [
    ...(Array.isArray(row.input_paths) ? row.input_paths : []),
    ...(Array.isArray(row.result_paths) ? row.result_paths : []),
  ]);
  let storageCleanup: Awaited<ReturnType<typeof cleanupPrunedAiStorage>>;
  try {
    storageCleanup = await cleanupPrunedAiStorage(serviceClient);
  } catch {
    return NextResponse.json({
      message: "AI 이미지 보관기간 정리 대기열을 완료하지 못했습니다. 삭제 대상은 재시도용으로 보존됩니다.",
      retentionDays,
      jobsPruned: rows.length,
      storageQueued: storagePaths.length,
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
    }, { status: 502, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const push = await dispatchPendingPushNotifications(serviceClient, 100).catch(() => ({ configured: true, claimed: 0, sent: 0, failed: 1 }));

  return NextResponse.json({
    ok: true,
    retentionDays,
    jobsPruned: rows.length,
    storageQueued: storagePaths.length,
    storageClaimed: storageCleanup.claimed,
    storageRemoved: storageCleanup.removed,
    storageRequeued: storageCleanup.requeued,
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
    push: { configured: push.configured, sent: push.sent, failed: push.failed },
    completedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
