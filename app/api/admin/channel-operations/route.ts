import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  channelOperationCapabilities,
  channelOperationNames,
  executeChannelOperation,
  writeChannelOperations,
} from "../../../../lib/channels/operations";
import { channelCatalog } from "../../../../lib/channels/catalog";
import { executeViaChannelGateway } from "../../../../lib/channels/gateway";
import { ensureEbayAccessToken } from "../../../../lib/channels/protocols";
import { supabasePublishableKey, supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid(),
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay"]),
  operation: z.enum(channelOperationNames),
  idempotencyKey: z.string().trim().min(16).max(160),
  confirmWrite: z.boolean().default(false),
  productId: z.string().uuid().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  price: z.number().nonnegative().max(999_999_999).optional(),
  market: z.string().trim().max(80).optional().default(""),
  targetId: z.string().trim().max(160).optional().default(""),
  arguments: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 128_000, "payload too large"),
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("CHANNEL_ARGUMENT_REQUIRED:")) return `필수 작업값이 누락됐습니다 · ${message.split(":")[1]}`;
  if (message.startsWith("CHANNEL_ARGUMENT_INVALID:")) return `작업값 형식이 올바르지 않습니다 · ${message.split(":")[1]}`;
  if (message.startsWith("CHANNEL_OPERATION_UNSUPPORTED:")) return "해당 채널에서 지원하지 않는 작업입니다.";
  if (message.startsWith("CHANNEL_VENDOR_SPEC_REQUIRED:")) return "판매자 전용 상세 API 명세를 확정한 뒤 사용할 수 있습니다.";
  if (/CREDENTIALS_MISSING|ACCESS_TOKEN_MISSING|TOKEN_EXCHANGE_FAILED|TOKEN_REFRESH_FAILED|REFRESH_TOKEN_EXPIRED|REFRESH_CREDENTIALS_MISSING|CREDENTIAL_REFRESH_STORE_FAILED/.test(message)) return "필수 인증값 또는 OAuth 토큰이 누락됐거나 만료됐습니다.";
  if (message.startsWith("CHANNEL_GATEWAY_TIMEOUT")) return "허용 IP 채널 작업자의 응답 제한시간을 초과했습니다. 작업자 상태를 확인해 주세요.";
  if (message.startsWith("CHANNEL_GATEWAY_")) return "허용 IP 채널 작업 경로에서 안전하게 처리된 오류가 발생했습니다.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "판매채널 응답 제한시간(15초)을 초과했습니다.";
  return "판매채널 작업 중 안전하게 처리된 오류가 발생했습니다.";
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "채널 작업 요청 형식이 올바르지 않습니다." }, { status: 400 });

  const { channel, operation } = parsed.data;
  const capability = channelCatalog[channel].capabilities[channelOperationCapabilities[operation]];
  if (capability.mode === "unsupported") {
    return NextResponse.json({ message: capability.note, mode: capability.mode }, { status: 409 });
  }
  if (capability.mode === "vendor_docs_required" || channel === "elevenst") {
    return NextResponse.json({ message: capability.note, mode: "vendor_docs_required" }, { status: 409 });
  }
  if (writeChannelOperations.has(operation) && !parsed.data.confirmWrite) {
    return NextResponse.json({ message: "외부 판매채널을 변경하는 작업은 실행 확인이 필요합니다." }, { status: 428 });
  }

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentialRows, error: credentialError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const credentialMetadata = Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === parsed.data.credentialId)
    : null;
  if (!credentialMetadata || !("channel" in credentialMetadata) || credentialMetadata.channel !== channel || !("status" in credentialMetadata) || credentialMetadata.status !== "active") {
    return NextResponse.json({ message: "활성 키와 채널 정보가 일치하지 않습니다." }, { status: 409 });
  }

  const environment = "environment" in credentialMetadata && credentialMetadata.environment === "sandbox" ? "sandbox" : "production";
  const requestFingerprint = createHash("sha256")
    .update(canonicalJson({
      channel,
      operation,
      environment,
      productId: parsed.data.productId ?? null,
      currency: parsed.data.currency ?? null,
      price: parsed.data.price ?? null,
      market: parsed.data.market,
      targetId: parsed.data.targetId,
      arguments: parsed.data.arguments,
    }))
    .digest("hex");
  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: claimData, error: claimError } = await userClient.rpc("sellerpilot_claim_channel_operation", {
    p_credential_id: parsed.data.credentialId,
    p_channel: channel,
    p_operation: operation,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_request_fingerprint: requestFingerprint,
  });
  if (claimError || !claimData || typeof claimData !== "object" || Array.isArray(claimData)) {
    return NextResponse.json({ message: "중복 방지 작업을 생성하지 못했습니다. 같은 키에 다른 요청을 사용했는지 확인해 주세요." }, { status: 409 });
  }
  const claim = claimData as Record<string, unknown>;
  const attemptId = typeof claim.attempt_id === "string" ? claim.attempt_id : "";
  if (!attemptId) return NextResponse.json({ message: "작업 추적 ID를 만들지 못했습니다." }, { status: 500 });
  if (claim.duplicate === true) {
    const duplicateRemoteId = typeof claim.remote_id === "string" ? claim.remote_id : undefined;
    const duplicateMessage = typeof claim.safe_message === "string" ? claim.safe_message : "같은 작업이 이미 완료됐습니다.";
    if (claim.status === "succeeded") {
      let duplicateListingId = "";
      if (parsed.data.productId && ["listing.create", "listing.update", "listing.stop"].includes(operation)) {
        const { data: preparedListingId, error: prepareError } = await userClient.rpc("sellerpilot_prepare_product_market_listing", {
          p_product_id: parsed.data.productId,
          p_channel: channel,
          p_operation: operation,
          p_market: parsed.data.market,
          p_target_id: parsed.data.targetId,
          p_currency: parsed.data.currency ?? "KRW",
          p_price: parsed.data.price ?? 0,
        });
        if (prepareError || typeof preparedListingId !== "string") {
          return NextResponse.json({ message: "완료된 원격 작업을 상품 원장과 다시 연결하지 못했습니다.", attemptId, remoteId: duplicateRemoteId }, { status: 409 });
        }
        duplicateListingId = preparedListingId;
        const { data: reconciled, error: reconcileError } = await serviceClient.rpc("sellerpilot_service_complete_product_listing", {
          p_listing_id: duplicateListingId,
          p_attempt_id: attemptId,
          p_operation: operation,
          p_success: true,
          p_remote_id: duplicateRemoteId ?? null,
          p_safe_message: duplicateMessage,
        });
        if (reconcileError || reconciled !== true) {
          return NextResponse.json({ message: "원격 성공 이력을 상품 원장과 조정하지 못했습니다.", attemptId, remoteId: duplicateRemoteId }, { status: 500 });
        }
      }
      return NextResponse.json({
        ok: true,
        duplicate: true,
        message: "이미 성공한 동일 작업을 다시 호출하지 않고 기존 결과를 반환했습니다.",
        safeMessage: duplicateMessage,
        remoteId: duplicateRemoteId,
        attemptId,
        listingId: duplicateListingId || undefined,
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({
      message: "같은 작업이 이미 접수됐습니다. 외부 상품·주문 중복 처리를 막기 위해 다시 실행하지 않았습니다.",
      attemptId,
      status: claim.status,
    }, { status: 409 });
  }

  let listingId = "";
  if (parsed.data.productId && ["listing.create", "listing.update", "listing.stop"].includes(operation)) {
    const { data: preparedListingId, error: prepareError } = await userClient.rpc("sellerpilot_prepare_product_market_listing", {
      p_product_id: parsed.data.productId,
      p_channel: channel,
      p_operation: operation,
      p_market: parsed.data.market,
      p_target_id: parsed.data.targetId,
      p_currency: parsed.data.currency ?? "KRW",
      p_price: parsed.data.price ?? 0,
    });
    if (prepareError || typeof preparedListingId !== "string") {
      await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
        p_attempt_id: attemptId,
        p_status: "failed",
        p_http_status: 409,
        p_remote_id: null,
        p_safe_message: "상품·카테고리·채널 연결 사전조건을 충족하지 못했습니다.",
      });
      return NextResponse.json({
        message: "상품 원장과 확정된 채널 카테고리, 활성 API 키를 먼저 확인해 주세요.",
        attemptId,
      }, { status: 409 });
    }
    listingId = preparedListingId;
  }

  const completeListing = async (input: { success: boolean; remoteId?: string; safeMessage: string }) => {
    if (!listingId) return true;
    const { data, error } = await serviceClient.rpc("sellerpilot_service_complete_product_listing", {
      p_listing_id: listingId,
      p_attempt_id: attemptId,
      p_operation: operation,
      p_success: input.success,
      p_remote_id: input.remoteId ?? null,
      p_safe_message: input.safeMessage,
    });
    return !error && data === true;
  };

  if (channel === "shopee" || channel === "lazada") {
    try {
      const result = await executeViaChannelGateway({
        serviceClient,
        credentialId: parsed.data.credentialId,
        attemptId,
        channel,
        operation,
        arguments: parsed.data.arguments,
      });
      const remoteStatus = result.steps.find((item) => !item.ok)?.status ?? result.steps.at(-1)?.status ?? 200;
      await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
        p_attempt_id: attemptId,
        p_status: result.ok ? "succeeded" : "failed",
        p_http_status: remoteStatus,
        p_remote_id: result.remoteId ?? null,
        p_safe_message: result.safeMessage,
      });
      const listingRecorded = await completeListing({ success: result.ok, remoteId: result.remoteId, safeMessage: result.safeMessage });
      if (!listingRecorded) {
        return NextResponse.json({
          message: "원격 작업은 완료됐지만 상품 원장 조정이 필요합니다. 같은 멱등키로 다시 요청하면 원격 재호출 없이 복구합니다.",
          attemptId,
          remoteId: result.remoteId,
          reconciliationRequired: true,
        }, { status: 500, headers: { "cache-control": "no-store, max-age=0" } });
      }
      return NextResponse.json({ ...result, attemptId, listingId: listingId || undefined, gateway: "allowlisted-local-worker" }, {
        status: result.ok ? 200 : 422,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    } catch (error) {
      const message = errorMessage(error);
      await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
        p_attempt_id: attemptId,
        p_status: "failed",
        p_http_status: 422,
        p_remote_id: null,
        p_safe_message: message,
      });
      await completeListing({ success: false, safeMessage: message });
      return NextResponse.json({ message, attemptId }, { status: 422 });
    }
  }

  const { data: secretPayload, error: secretError } = await serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: parsed.data.credentialId,
  });
  if (secretError || !secretPayload || typeof secretPayload !== "object" || Array.isArray(secretPayload)) {
    await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
      p_attempt_id: attemptId,
      p_status: "failed",
      p_http_status: 404,
      p_remote_id: null,
      p_safe_message: "활성 키를 안전하게 불러오지 못했습니다.",
    });
    await completeListing({ success: false, safeMessage: "활성 키를 안전하게 불러오지 못했습니다." });
    return NextResponse.json({ message: "활성 키를 안전하게 불러오지 못했습니다.", attemptId }, { status: 404 });
  }

  try {
    let executionPayload = secretPayload as Record<string, unknown>;
    let credentialRefreshed = false;
    if (channel === "ebay") {
      const ensured = await ensureEbayAccessToken(executionPayload, environment);
      executionPayload = ensured.payload;
      if (ensured.refreshed) {
        const { error: refreshStoreError } = await serviceClient.rpc("sellerpilot_service_refresh_ebay", {
          p_credential_id: parsed.data.credentialId,
          p_secret_payload: ensured.payload,
          p_expires_at: ensured.credentialExpiresAt,
        });
        if (refreshStoreError) throw new Error("EBAY_CREDENTIAL_REFRESH_STORE_FAILED");
        credentialRefreshed = true;
      }
    }
    const result = await executeChannelOperation({
      channel,
      operation,
      payload: executionPayload,
      arguments: parsed.data.arguments,
      environment,
    });
    const remoteStatus = result.steps.find((item) => !item.ok)?.status ?? result.steps.at(-1)?.status ?? 200;
    await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
      p_attempt_id: attemptId,
      p_status: result.ok ? "succeeded" : "failed",
      p_http_status: remoteStatus,
      p_remote_id: result.remoteId ?? null,
      p_safe_message: result.safeMessage,
    });
    const listingRecorded = await completeListing({ success: result.ok, remoteId: result.remoteId, safeMessage: result.safeMessage });
    if (!listingRecorded) {
      return NextResponse.json({
        message: "원격 작업은 완료됐지만 상품 원장 조정이 필요합니다. 같은 멱등키로 다시 요청하면 원격 재호출 없이 복구합니다.",
        attemptId,
        remoteId: result.remoteId,
        reconciliationRequired: true,
      }, { status: 500, headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({ ...result, attemptId, listingId: listingId || undefined, credentialRefreshed }, {
      status: result.ok ? 200 : 422,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = errorMessage(error);
    await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
      p_attempt_id: attemptId,
      p_status: "failed",
      p_http_status: 422,
      p_remote_id: null,
      p_safe_message: message,
    });
    await completeListing({ success: false, safeMessage: message });
    return NextResponse.json({ message, attemptId }, { status: 422 });
  }
}
