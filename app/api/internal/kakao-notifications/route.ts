import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { KakaoProviderError, refreshKakaoToken, sendKakaoMemo } from "../../../../lib/kakao";
import {
  internalScheduleAuthorization,
  internalScheduleCanaryPayload,
  internalScheduleRequestMode,
  runtimeStatusMatchesCurrentRelease,
} from "../../../../lib/internal-scheduler-auth";
import { supabaseUrl } from "../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorMessage } from "../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;

type Delivery = {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  link_path: string;
  secret_payload: Record<string, unknown>;
  expires_at: string | null;
  kakao_user_id: string;
  nickname: string;
  claim_token: string;
};

type LifecycleRpcResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string };

type PreparedSecretResult =
  | { ok: true; secret: Record<string, unknown> }
  | {
      ok: false;
      errorCode: string;
      infrastructureFailure: boolean;
      claimHandled: boolean;
      reconciliationRequired: boolean;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KAKAO_SUPABASE_TIMEOUT_MS = 3_000;
const KAKAO_CLAIM_BATCH_SIZE = 1;
const KAKAO_CLAIM_LEASE_SECONDS = 180;
const KAKAO_PREPARATION_RETRY_SECONDS = 60;
const LIFECYCLE_RPC_RETRY_DELAYS_MS = [0, 125] as const;

function safeDeliveryError(error: unknown, fallback: string) {
  return error instanceof Error && /^[A-Z0-9_:-]{1,120}$/.test(error.message)
    ? error.message
    : fallback;
}

async function waitForRetry(delayMs: number) {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runLifecycleRpc(
  serviceClient: NonNullable<ReturnType<typeof serverClient>>,
  functionName: string,
  args: Record<string, unknown>,
): Promise<LifecycleRpcResult> {
  let code = "transport_error";
  for (const delayMs of LIFECYCLE_RPC_RETRY_DELAYS_MS) {
    await waitForRetry(delayMs);
    try {
      const { data, error } = await serviceClient.rpc(functionName, args);
      if (!error) return { ok: true, data };
      code = error.code ?? "unknown";
    } catch {
      code = "transport_error";
    }
  }
  return { ok: false, code };
}

async function releaseDeliveryClaim(
  serviceClient: NonNullable<ReturnType<typeof serverClient>>,
  row: Delivery,
  errorCode: string,
) {
  return runLifecycleRpc(serviceClient, "sellerpilot_service_release_kakao_notification_claim", {
    p_id: row.id,
    p_claim_token: row.claim_token,
    p_error: errorCode,
    p_delay_seconds: KAKAO_PREPARATION_RETRY_SECONDS,
  });
}

async function finishDeliveryPreparation(
  serviceClient: NonNullable<ReturnType<typeof serverClient>>,
  row: Delivery,
  outcome: "failed" | "reconciliation_required",
  errorCode: string,
) {
  return runLifecycleRpc(serviceClient, "sellerpilot_service_finish_kakao_notification_preparation", {
    p_delivery_id: row.id,
    p_claim_token: row.claim_token,
    p_outcome: outcome,
    p_error: errorCode,
  });
}

function tokenExpiry(secret: Record<string, unknown>) {
  const seconds = Number(secret.expires_in ?? 21_600);
  const bounded = Number.isFinite(seconds)
    ? Math.max(60, Math.min(seconds, 31 * 24 * 60 * 60))
    : 21_600;
  return new Date(Date.now() + bounded * 1000).toISOString();
}

function serverClient() {
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(KAKAO_SUPABASE_TIMEOUT_MS) },
  });
}

async function runKakaoNotifications(request: Request, serviceClient: NonNullable<ReturnType<typeof serverClient>>) {
  try {
    const { data: enqueued, error: enqueueError } = await serviceClient.rpc("sellerpilot_service_enqueue_kakao_summaries");
    if (enqueueError || typeof enqueued !== "number" || !Number.isFinite(enqueued) || enqueued < 0) {
      console.error("kakao summary enqueue RPC failed", { code: enqueueError?.code ?? "invalid_result", status: 503 });
      return NextResponse.json({ message: "카카오 알림 작업을 예약하지 못했습니다." }, { status: 503 });
    }
  } catch {
    console.error("kakao summary enqueue RPC threw", { status: 503 });
    return NextResponse.json({ message: "카카오 알림 작업을 예약하지 못했습니다." }, { status: 503 });
  }

  let claimData: unknown;
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_kakao_notifications", {
      p_limit: KAKAO_CLAIM_BATCH_SIZE,
      p_lease_seconds: KAKAO_CLAIM_LEASE_SECONDS,
    });
    if (error) {
      console.error("kakao notification claim RPC failed", { code: error.code ?? "unknown", status: 503 });
      return NextResponse.json({ message: "카카오 알림 작업을 가져오지 못했습니다." }, { status: 503 });
    }
    claimData = data;
  } catch {
    console.error("kakao notification claim RPC threw", { status: 503 });
    return NextResponse.json({ message: "카카오 알림 작업을 가져오지 못했습니다." }, { status: 503 });
  }
  if (!Array.isArray(claimData)) {
    console.error("kakao notification claim RPC returned an invalid shape", { status: 503 });
    return NextResponse.json({ message: "카카오 알림 작업 형식을 확인하지 못했습니다." }, { status: 503 });
  }
  const rows = claimData.filter((item): item is Delivery => (
    Boolean(item)
    && typeof item === "object"
    && typeof item.id === "string"
    && typeof item.owner_id === "string"
    && typeof item.title === "string"
    && typeof item.body === "string"
    && typeof item.link_path === "string"
    && item.secret_payload
    && typeof item.secret_payload === "object"
    && !Array.isArray(item.secret_payload)
    && (item.expires_at === null || typeof item.expires_at === "string")
    && typeof item.kakao_user_id === "string"
    && typeof item.nickname === "string"
    && typeof item.claim_token === "string"
    && UUID_PATTERN.test(item.claim_token)
  ));
  if (rows.length !== claimData.length) {
    console.error("kakao notification claim RPC returned invalid rows", {
      invalid: claimData.length - rows.length,
      total: claimData.length,
      status: 503,
    });
    return NextResponse.json({ message: "카카오 알림 작업 형식을 확인하지 못했습니다." }, { status: 503 });
  }
  let sent = 0;
  let failed = 0;
  let infrastructureFailures = 0;
  let deferred = 0;
  let reconciliationRequired = 0;
  let completionPersistenceUncertain = 0;
  let preparationReleaseUncertain = 0;
  let haltAfterIndex: number | null = null;
  const preparedSecretsByOwner = new Map<string, PreparedSecretResult>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    let preparedSecret = preparedSecretsByOwner.get(row.owner_id);
    if (!preparedSecret) {
      let secret = row.secret_payload;
      if (!row.expires_at || Date.parse(row.expires_at) <= Date.now() + 60_000) {
        const refreshBegun = await runLifecycleRpc(
          serviceClient,
          "sellerpilot_service_begin_kakao_notification_refresh",
          { p_delivery_id: row.id, p_claim_token: row.claim_token },
        );
        if (!refreshBegun.ok || refreshBegun.data !== true) {
          const finalized = await finishDeliveryPreparation(
            serviceClient,
            row,
            "failed",
            "KAKAO_REFRESH_BEGIN_UNCERTAIN",
          );
          preparedSecret = {
            ok: false,
            errorCode: "KAKAO_REFRESH_BEGIN_UNCERTAIN",
            infrastructureFailure: !finalized.ok || finalized.data !== true,
            claimHandled: true,
            reconciliationRequired: false,
          };
        } else {
          try {
            secret = await refreshKakaoToken(secret);
            const staged = await runLifecycleRpc(
              serviceClient,
              "sellerpilot_service_stage_kakao_notification_refresh",
              {
                p_delivery_id: row.id,
                p_claim_token: row.claim_token,
                p_secret_payload: secret,
                p_expires_at: tokenExpiry(secret),
              },
            );
            if (!staged.ok || staged.data !== true) {
              const finalized = await finishDeliveryPreparation(
                serviceClient,
                row,
                "reconciliation_required",
                "KAKAO_REFRESH_STAGE_UNCERTAIN",
              );
              preparedSecret = {
                ok: false,
                errorCode: "KAKAO_REFRESH_STAGE_UNCERTAIN",
                infrastructureFailure: true,
                claimHandled: true,
                reconciliationRequired: true,
              };
              if (!finalized.ok || finalized.data !== true) preparationReleaseUncertain += 1;
            } else {
              preparedSecret = { ok: true, secret };
            }
          } catch (refreshError) {
            const rejected = refreshError instanceof KakaoProviderError && refreshError.kind === "rejected";
            const errorCode = safeDeliveryError(refreshError, "KAKAO_REFRESH_OUTCOME_UNKNOWN");
            const finalized = await finishDeliveryPreparation(
              serviceClient,
              row,
              rejected ? "failed" : "reconciliation_required",
              errorCode,
            );
            preparedSecret = {
              ok: false,
              errorCode,
              infrastructureFailure: !finalized.ok || finalized.data !== true,
              claimHandled: true,
              reconciliationRequired: !rejected,
            };
          }
        }
      } else {
        preparedSecret = { ok: true, secret };
      }
      preparedSecretsByOwner.set(row.owner_id, preparedSecret);
    }

    if (!preparedSecret.ok) {
      failed += 1;
      if (preparedSecret.reconciliationRequired) reconciliationRequired += 1;
      if (preparedSecret.infrastructureFailure) infrastructureFailures += 1;
      if (!preparedSecret.claimHandled) {
        const released = await releaseDeliveryClaim(serviceClient, row, preparedSecret.errorCode);
        if (!released.ok || released.data !== true) {
          infrastructureFailures += 1;
          preparationReleaseUncertain += 1;
        }
      }
      continue;
    }

    const begun = await runLifecycleRpc(serviceClient, "sellerpilot_service_begin_kakao_notification_send", {
      p_id: row.id,
      p_claim_token: row.claim_token,
    });
    if (!begun.ok) {
      const released = await releaseDeliveryClaim(serviceClient, row, "KAKAO_SEND_BEGIN_UNCERTAIN");
      failed += 1;
      infrastructureFailures += 1;
      if (!released.ok || released.data !== true) {
        reconciliationRequired += 1;
        preparationReleaseUncertain += 1;
      }
      haltAfterIndex = index;
      break;
    }
    if (begun.data !== true) {
      failed += 1;
      infrastructureFailures += 1;
      continue;
    }

    let sendError: unknown = null;
    try {
      await sendKakaoMemo(String(preparedSecret.secret.access_token ?? ""), row.title, row.body, row.link_path, process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin);
    } catch (error) {
      sendError = error;
    }
    const sendRejected = sendError instanceof KakaoProviderError && sendError.kind === "rejected";
    const outcome = sendError ? (sendRejected ? "failed" : "reconciliation_required") : "sent";
    const completionError = sendError
      ? safeDeliveryError(sendError, "KAKAO_DELIVERY_OUTCOME_UNKNOWN")
      : null;
    const completed = await runLifecycleRpc(serviceClient, "sellerpilot_service_complete_kakao_notification", {
      p_id: row.id,
      p_claim_token: row.claim_token,
      p_outcome: outcome,
      p_error: completionError,
    });
    if (!completed.ok || completed.data !== true) {
      infrastructureFailures += 1;
      failed += 1;
      reconciliationRequired += 1;
      completionPersistenceUncertain += 1;
      haltAfterIndex = index;
      break;
    }
    if (sendError) {
      failed += 1;
      if (!sendRejected) reconciliationRequired += 1;
    } else {
      sent += 1;
    }
  }

  if (haltAfterIndex !== null) {
    const remainingClaims = rows.length - haltAfterIndex - 1;
    deferred += remainingClaims;
    failed += remainingClaims;
  }
  if (infrastructureFailures > 0) {
    console.error("kakao notification database operations failed", {
      failed: infrastructureFailures,
      claimed: rows.length,
      completionPersistenceUncertain,
      preparationReleaseUncertain,
    });
  }
  return NextResponse.json({
    ok: failed === 0 && infrastructureFailures === 0 && reconciliationRequired === 0,
    claimed: rows.length,
    sent,
    failed,
    deferred,
    reconciliationRequired,
    completionPersistenceUncertain,
    preparationReleaseUncertain,
    infrastructureFailures,
  }, {
    status: infrastructureFailures > 0 ? 503 : failed ? 207 : 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = internalScheduleAuthorization(
    request.headers.get("authorization"),
    cronSecret,
  );
  if (authorization === "missing") return NextResponse.json({ message: "카카오 알림 작업 인증값이 설정되지 않았습니다." }, { status: 503 });
  if (authorization !== "authorized") return NextResponse.json({ message: "카카오 알림 작업 인증이 필요합니다." }, { status: 401 });
  const requestedMode = internalScheduleRequestMode(request);
  if (requestedMode === "invalid") {
    return NextResponse.json({ message: "카카오 알림 실행 모드를 확인하지 못했습니다." }, { status: 400 });
  }
  if (requestedMode === "canary") {
    return NextResponse.json(internalScheduleCanaryPayload());
  }
  const serviceClient = serverClient();
  if (!serviceClient) return NextResponse.json({ message: "Supabase 서버 설정이 없습니다." }, { status: 503 });
  const { data: runtimeStatus, error: runtimeStatusError } = await serviceClient.rpc(
    "sellerpilot_service_serverless_cs_wakeup_status",
  );
  if (runtimeStatusError || !runtimeStatusMatchesCurrentRelease(runtimeStatus)) {
    return NextResponse.json({ message: "서버 일정이 활성화되지 않았습니다." }, { status: 503 });
  }
  return runKakaoNotifications(request, serviceClient);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) return NextResponse.json({ message: "카카오 작업자 인증이 필요합니다." }, { status: 401 });
  const serviceClient = serverClient();
  if (!serviceClient) return NextResponse.json({ message: "Supabase 서버 설정이 없습니다." }, { status: 503 });
  let validationData: unknown;
  try {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_validate_worker_token", {
      p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
      p_worker_version: "kakao-notification-scheduler",
    });
    if (error) {
      console.error("kakao worker validation RPC failed", { code: error.code ?? "unknown", status: 503 });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    validationData = data;
  } catch {
    console.error("kakao worker validation RPC threw", { status: 503 });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  if (validationData !== true) return NextResponse.json({ message: "카카오 작업자 인증이 유효하지 않습니다." }, { status: 401 });
  return runKakaoNotifications(request, serviceClient);
}
