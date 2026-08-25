import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { KakaoProviderError, refreshKakaoToken, sendKakaoMemo } from "../../../../../lib/kakao";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEST_LEASE_SECONDS = 180;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const preferences = z.object({
  kakao_enabled: z.boolean(), order_paid: z.boolean(), shipping_ready: z.boolean(), shipping_completed: z.boolean(),
  listing_published: z.boolean(), listing_failed: z.boolean(), low_stock: z.boolean(), cs_waiting: z.boolean(), settlement_rate_risk: z.boolean(),
});

const testRequest = z.object({
  action: z.literal("test"),
  requestId: z.string().uuid(),
});

type RpcResult = { ok: true; data: unknown } | { ok: false };

type TestClaim = {
  status: string;
  deliveryId?: string;
  claimToken?: string;
  terminal?: boolean;
  requestConflict?: boolean;
  secret?: Record<string, unknown>;
  expiresAt?: string | null;
  refreshCompleted?: boolean;
};

async function runRpc(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
  attempts = 1,
): Promise<RpcResult> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data, error } = await client.rpc(functionName, args);
      if (!error) return { ok: true, data };
    } catch {
      // Exact delivery and claim nonces make the explicitly retried RPCs idempotent.
    }
  }
  return { ok: false };
}

function parseTestClaim(value: unknown): TestClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== "string") return null;
  return {
    status: record.status,
    deliveryId: typeof record.deliveryId === "string" ? record.deliveryId : undefined,
    claimToken: typeof record.claimToken === "string" ? record.claimToken : undefined,
    terminal: record.terminal === true,
    requestConflict: record.requestConflict === true,
    secret: record.secret && typeof record.secret === "object" && !Array.isArray(record.secret)
      ? record.secret as Record<string, unknown>
      : undefined,
    expiresAt: typeof record.expiresAt === "string" || record.expiresAt === null
      ? record.expiresAt
      : undefined,
    refreshCompleted: record.refreshCompleted === true,
  };
}

function responseForExistingTest(claim: TestClaim) {
  if (claim.status === "sent") {
    return NextResponse.json({ ok: true, outcome: "sent", terminal: true, deduplicated: true });
  }
  if (claim.status === "in_progress" || claim.status === "preparing" || claim.status === "sending") {
    return NextResponse.json({
      ok: false,
      outcome: "in_progress",
      terminal: false,
      message: "기존 테스트 발송 결과를 확인하고 있습니다. 같은 요청은 다시 보내지 않습니다.",
    }, { status: 202 });
  }
  if (claim.status === "reconciliation_required") {
    return NextResponse.json({
      ok: false,
      outcome: "reconciliation_required",
      terminal: true,
      message: "카카오 수신 여부를 먼저 확인해야 합니다. 확인 전에는 새 테스트를 보내지 않습니다.",
    }, { status: 409 });
  }
  if (claim.status === "failed") {
    return NextResponse.json({
      ok: false,
      outcome: "failed",
      terminal: true,
      message: "카카오가 테스트 요청을 거절했습니다. 연결 상태를 확인해 주세요.",
    }, { status: 409 });
  }
  if (claim.status === "not_connected") {
    return NextResponse.json({ message: "연결된 사용자 카카오톡이 없습니다." }, { status: 409 });
  }
  if (claim.requestConflict) {
    return NextResponse.json({
      ok: false,
      outcome: claim.status,
      terminal: claim.terminal === true,
      message: "이전 테스트 발송의 결과를 먼저 확인해 주세요.",
    }, { status: 409 });
  }
  return null;
}

function expiresAtForToken(secret: Record<string, unknown>) {
  const seconds = Number(secret.expires_in ?? 21_600);
  const bounded = Number.isFinite(seconds)
    ? Math.max(60, Math.min(seconds, 31 * 24 * 60 * 60))
    : 21_600;
  return new Date(Date.now() + bounded * 1000).toISOString();
}

async function finishTestPreparation(
  client: SupabaseClient,
  deliveryId: string,
  claimToken: string,
  outcome: "failed" | "reconciliation_required",
  errorCode: string,
) {
  return runRpc(client, "sellerpilot_service_finish_kakao_notification_preparation", {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_error: errorCode,
  }, 2);
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_notification_settings");
  if (error) return NextResponse.json({ message: "알림 설정을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const body = await request.json().catch(() => null) as { action?: unknown; requestId?: unknown; preferences?: unknown } | null;
  if (body?.action === "test") {
    const parsedTest = testRequest.safeParse(body);
    if (!parsedTest.success) {
      return NextResponse.json({ message: "테스트 요청 식별값을 확인해 주세요." }, { status: 400 });
    }
    const claimed = await runRpc(admin.serviceClient, "sellerpilot_service_claim_kakao_test_delivery", {
      p_owner_id: admin.user.id,
      p_request_id: parsedTest.data.requestId,
      p_lease_seconds: TEST_LEASE_SECONDS,
    });
    if (!claimed.ok) {
      return NextResponse.json({ message: "테스트 발송 원장을 준비하지 못했습니다." }, { status: 503 });
    }
    const claim = parseTestClaim(claimed.data);
    if (!claim) return NextResponse.json({ message: "테스트 발송 원장 응답을 확인하지 못했습니다." }, { status: 503 });
    const existingResponse = responseForExistingTest(claim);
    if (existingResponse) return existingResponse;
    if (
      claim.status !== "claimed"
      || !claim.deliveryId
      || !claim.claimToken
      || !UUID_PATTERN.test(claim.deliveryId)
      || !UUID_PATTERN.test(claim.claimToken)
      || !claim.secret
    ) {
      return NextResponse.json({ message: "테스트 발송 원장 소유권을 확인하지 못했습니다." }, { status: 503 });
    }

    const deliveryId = claim.deliveryId;
    const claimToken = claim.claimToken;
    let secret = claim.secret;
    const accessTokenMissing = typeof secret.access_token !== "string" || secret.access_token.length < 8;
    const expiryTime = claim.expiresAt ? Date.parse(claim.expiresAt) : Number.NaN;
    const refreshRequired = accessTokenMissing || !Number.isFinite(expiryTime) || expiryTime <= Date.now() + 60_000;
    if (refreshRequired) {
      if (claim.refreshCompleted) {
        await finishTestPreparation(
          admin.serviceClient,
          deliveryId,
          claimToken,
          "failed",
          "KAKAO_REFRESHED_TOKEN_UNUSABLE",
        );
        return NextResponse.json({ message: "갱신된 카카오 연결 정보가 유효하지 않습니다." }, { status: 409 });
      }
      const refreshBegun = await runRpc(admin.serviceClient, "sellerpilot_service_begin_kakao_notification_refresh", {
        p_delivery_id: deliveryId,
        p_claim_token: claimToken,
      });
      if (!refreshBegun.ok || refreshBegun.data !== true) {
        await finishTestPreparation(
          admin.serviceClient,
          deliveryId,
          claimToken,
          "failed",
          "KAKAO_REFRESH_BEGIN_UNCERTAIN",
        );
        return NextResponse.json({
          message: "카카오 토큰 갱신 상태를 확인하고 있습니다. 같은 테스트를 다시 보내지 않습니다.",
        }, { status: 503 });
      }
      try {
        secret = await refreshKakaoToken(secret);
      } catch (error) {
        const rejected = error instanceof KakaoProviderError && error.kind === "rejected";
        await finishTestPreparation(
          admin.serviceClient,
          deliveryId,
          claimToken,
          rejected ? "failed" : "reconciliation_required",
          error instanceof KakaoProviderError ? error.message : "KAKAO_REFRESH_OUTCOME_UNKNOWN",
        );
        return NextResponse.json({
          outcome: rejected ? "failed" : "reconciliation_required",
          terminal: true,
          message: rejected
            ? "카카오가 토큰 갱신을 거절했습니다. 다시 연결해 주세요."
            : "카카오 토큰 갱신 결과를 확정할 수 없어 수동 확인이 필요합니다.",
        }, { status: rejected ? 409 : 503 });
      }
      const refreshStaged = await runRpc(admin.serviceClient, "sellerpilot_service_stage_kakao_notification_refresh", {
        p_delivery_id: deliveryId,
        p_claim_token: claimToken,
        p_secret_payload: secret,
        p_expires_at: expiresAtForToken(secret),
      }, 2);
      if (!refreshStaged.ok || refreshStaged.data !== true) {
        await finishTestPreparation(
          admin.serviceClient,
          deliveryId,
          claimToken,
          "reconciliation_required",
          "KAKAO_REFRESH_STAGE_UNCERTAIN",
        );
        return NextResponse.json({
          message: "갱신 토큰 저장 결과를 확인하고 있습니다. 테스트 메시지는 보내지 않았습니다.",
        }, { status: 503 });
      }
    }

    const sendBegun = await runRpc(admin.serviceClient, "sellerpilot_service_begin_kakao_notification_send", {
      p_id: deliveryId,
      p_claim_token: claimToken,
    });
    if (!sendBegun.ok || sendBegun.data !== true) {
      return NextResponse.json({
        message: "테스트 발송 시작 상태를 확인하고 있습니다. 같은 메시지는 다시 보내지 않습니다.",
      }, { status: 503 });
    }

    let sendFailure: unknown = null;
    try {
      await sendKakaoMemo(
        String(secret.access_token ?? ""),
        "SellerPilot 카카오 알림 테스트",
        "가입한 사용자 본인의 ‘나와의 채팅’ 연결이 정상입니다.",
        "/?view=notifications",
        new URL(request.url).origin,
      );
    } catch (error) {
      sendFailure = error;
    }
    const rejected = sendFailure instanceof KakaoProviderError && sendFailure.kind === "rejected";
    const outcome = sendFailure ? (rejected ? "failed" : "reconciliation_required") : "sent";
    const completed = await runRpc(admin.serviceClient, "sellerpilot_service_complete_kakao_notification", {
      p_id: deliveryId,
      p_claim_token: claimToken,
      p_outcome: outcome,
      p_error: sendFailure instanceof KakaoProviderError
        ? sendFailure.message
        : sendFailure
          ? "KAKAO_TEST_SEND_OUTCOME_UNKNOWN"
          : null,
    }, 2);
    if (!completed.ok || completed.data !== true) {
      return NextResponse.json({
        message: "테스트 발송 결과 원장을 확인하고 있습니다. 같은 메시지는 다시 보내지 않습니다.",
      }, { status: 503 });
    }
    if (outcome === "sent") {
      return NextResponse.json({ ok: true, outcome, terminal: true });
    }
    return NextResponse.json({
      ok: false,
      outcome,
      terminal: true,
      message: rejected
        ? "카카오가 테스트 발송을 거절했습니다. 연결 상태를 확인해 주세요."
        : "카카오 수신 여부를 확정할 수 없어 재전송하지 않았습니다.",
    }, { status: rejected ? 409 : 503 });
  }

  const parsed = preferences.safeParse(body?.preferences);
  if (!parsed.success) return NextResponse.json({ message: "알림 세부 설정을 확인해 주세요." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_save_notification_preferences", { p_values: parsed.data });
  if (error || data !== true) return NextResponse.json({ message: "알림 설정을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
