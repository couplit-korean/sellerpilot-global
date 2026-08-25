import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { gatewayWorkerCompletionSchema } from "../../../../../lib/channels/gateway-contract";
import { normalizeChannelInquiries } from "../../../../../lib/channels/inquiry-sync";
import { normalizeChannelOrders } from "../../../../../lib/channels/order-sync";
import type { ActiveChannelKey } from "../../../../../lib/channels/catalog";
import type { ChannelOperationResult } from "../../../../../lib/channels/operations";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { dispatchPendingPushNotifications } from "../../../../../lib/push-notifications";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const listingLineageChannels = new Set(["qoo10", "shopee", "lazada", "ebay"]);
const listingLineageCompletionSchema = z.object({
  status: z.enum(["bound", "queued", "manual_required", "lease_lost"]),
  job_id: z.string().uuid(),
  listing_id: z.string().uuid().optional(),
  reused: z.boolean().optional(),
  reason: z.string().max(80).optional(),
}).strip();

type ListingLineageWorkerResult = {
  ok: true;
  channel: "qoo10" | "shopee" | "lazada" | "ebay";
  operation: "listing.lineage.verify";
  verificationStatus: "verified" | "manual_required";
  evidence: {
    expectedRemoteId: string;
    verifiedRemoteId: string | null;
    market: string;
    targetId: string;
    evidenceVersion: "provider_listing_readback_rebind_v1";
    marketplaceSku?: string;
    providerResourceId?: string;
    reasonCode?: "EBAY_MARKETPLACE_SKU_MISSING" | "EBAY_OFFER_AMBIGUOUS";
  };
};

function listingLineageFailureReason(message: string) {
  if (message.includes("PROVIDER_ACCOUNT_IDENTITY_MISSING")) return "legacy_main_reconnect_required";
  if (/PROVIDER_ACCOUNT_IDENTITY_MISMATCH|ACCOUNT_IDENTITY_VERIFICATION_FAILED/.test(message)) return "provider_identity_mismatch";
  if (/SHOP_NOT_AUTHORIZED|TARGET_MISMATCH/.test(message)) return "target_mismatch";
  if (message.includes("MARKET_MISMATCH")) return "market_mismatch";
  if (message.includes("MARKETPLACE_SKU_MISSING")) return "marketplace_sku_missing";
  if (message.includes("PROVIDER_RESOURCE_MISSING")) return "provider_resource_missing";
  if (message.includes("OFFER_AMBIGUOUS")) return "provider_resource_ambiguous";
  if (message.includes("REMOTE_ID_MISMATCH")) return "remote_id_mismatch";
  if (/NOT_FOUND|404/.test(message)) return "provider_not_found";
  return "provider_readback_rejected";
}

function listingLineageFailurePayload(channel: string, reason: string) {
  return {
    ok: false,
    channel,
    operation: "listing.lineage.verify",
    evidenceVersion: "provider_listing_readback_v1",
    reason,
  };
}

function listingLineageSuccessPayload(result: ListingLineageWorkerResult) {
  const evidence = result.evidence;
  return {
    ok: true,
    channel: result.channel,
    operation: result.operation,
    evidenceVersion: "provider_listing_readback_v1",
    expectedRemoteId: evidence.expectedRemoteId,
    verifiedRemoteId: evidence.verifiedRemoteId,
    market: evidence.market,
    targetId: evidence.targetId,
    verification: "exact_provider_readback",
    ...(result.channel === "ebay" && evidence.marketplaceSku && evidence.providerResourceId
      ? {
        marketplaceSku: evidence.marketplaceSku,
        providerResourceId: evidence.providerResourceId,
      }
      : {}),
  };
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("channel gateway completion server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const parsed = gatewayWorkerCompletionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "채널 작업 완료 형식이 올바르지 않습니다." }, { status: 400 });

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data: snapshot, error: snapshotError } = await serviceClient.rpc("sellerpilot_service_begin_channel_gateway_completion", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
  });
  const job = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : null;
  if (snapshotError) {
    const status = workerRpcErrorStatus(snapshotError);
    console.error("channel gateway completion snapshot RPC failed", {
      code: snapshotError.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!job || job.status !== "running") {
    return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }

  let storedResponse: Record<string, unknown> | null = null;
  let refreshedCredentialId = "";
  const completionResult = parsed.data.status === "succeeded"
    ? parsed.data.result
    : parsed.data.status === "reconciliation_required"
      ? parsed.data.result
      : undefined;
  if (completionResult
      && (job.channel !== completionResult.channel || job.operation !== completionResult.operation)) {
    return NextResponse.json({ message: "채널 작업 결과가 요청과 일치하지 않습니다." }, { status: 409 });
  }
  const oauthResult = parsed.data.status === "succeeded" && parsed.data.result.operation === "oauth.exchange"
    ? parsed.data.result
    : null;
  const credentialRefresh = oauthResult
    ? { payload: oauthResult.credentialPayload, expiresAt: oauthResult.expiresAt, oauthComplete: true }
    : parsed.data.credentialRefresh;
  if (credentialRefresh) {
    if (job.channel !== "shopee" && job.channel !== "lazada" && job.channel !== "ebay") {
      return NextResponse.json({ message: "이 채널에는 OAuth 인증값 갱신을 적용할 수 없습니다." }, { status: 409 });
    }
    const { data: preparation, error: preparationError } = await serviceClient.rpc(
      "sellerpilot_service_prepare_gateway_credential_refresh",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
        p_secret_payload: credentialRefresh.payload,
        p_expires_at: credentialRefresh.expiresAt,
        p_recovery_only: credentialRefresh.recoveryOnly === true,
        p_oauth_complete: credentialRefresh.oauthComplete === true,
      },
    );
    if (preparationError) {
      const status = workerRpcErrorStatus(preparationError);
      console.error("channel gateway credential refresh preparation RPC failed", {
        code: preparationError.code ?? "unknown",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (!preparation) {
      return NextResponse.json({ message: "실행 중인 채널 작업과 인증 갱신 요청이 일치하지 않습니다." }, { status: 409 });
    }
    const prepared = typeof preparation === "object" && !Array.isArray(preparation)
      ? preparation as Record<string, unknown>
      : null;
    if (prepared?.status === "conflict" || prepared?.status === "invalid" || prepared?.status === "identity_mismatch") {
      return NextResponse.json({ message: "채널 인증 갱신 요청이 현재 작업 상태와 일치하지 않습니다." }, { status: 409 });
    }
    const recoveryPreserved = prepared?.status === "recovery_preserved"
      && credentialRefresh.recoveryOnly === true
      && parsed.data.status === "reconciliation_required";
    const fullyPrepared = prepared?.status === "prepared"
      && typeof prepared.credential_id === "string"
      && uuidPattern.test(prepared.credential_id)
      && (!oauthResult || prepared.oauth_complete === true);
    if (!fullyPrepared && !recoveryPreserved) {
      console.error("channel gateway credential refresh preparation returned an invalid contract");
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    if (fullyPrepared) refreshedCredentialId = prepared.credential_id as string;
  }
  const effectiveCredentialId = refreshedCredentialId || (typeof job.credential_id === "string" ? job.credential_id : "");
  if (parsed.data.status === "succeeded") {
    if (refreshedCredentialId && parsed.data.result.operation === "diagnostic.test") {
      const { error: diagnosticError } = await serviceClient.rpc("sellerpilot_record_credential_test", {
        p_credential_id: refreshedCredentialId,
        p_status: parsed.data.result.diagnostic.status,
        p_safe_message: parsed.data.result.diagnostic.message,
      });
      if (diagnosticError) {
        return NextResponse.json({ message: "갱신된 채널 인증값에 연결 검사 결과를 기록하지 못했습니다." }, { status: 500 });
      }
    }
    if (parsed.data.result.operation === "orders.list") {
      const credentialId = effectiveCredentialId;
      const orderResult = parsed.data.result as ChannelOperationResult;
      if (orderResult.ok) {
        const orders = normalizeChannelOrders(job.channel as ActiveChannelKey, orderResult);
        const { error: ingestError } = await serviceClient.rpc("sellerpilot_service_ingest_orders", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_orders: orders,
        });
        if (ingestError) {
          await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
            p_credential_id: credentialId,
            p_channel: job.channel,
            p_data_type: "orders",
            p_status: "failed",
            p_error: "정규화된 주문을 운영 원장에 저장하지 못했습니다.",
          });
          return NextResponse.json({ message: "채널 주문을 운영 원장에 저장하지 못했습니다." }, { status: 500 });
        }
      } else {
        await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_data_type: "orders",
          p_status: "failed",
          p_error: orderResult.safeMessage,
        });
      }
    }
    if (parsed.data.result.operation === "inquiries.list") {
      const credentialId = effectiveCredentialId;
      const inquiryResult = parsed.data.result as ChannelOperationResult;
      if (inquiryResult.ok) {
        const inquiries = normalizeChannelInquiries(job.channel as ActiveChannelKey, inquiryResult);
        const { error: ingestError } = await serviceClient.rpc("sellerpilot_service_ingest_inquiries", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_inquiries: inquiries,
        });
        if (ingestError) {
          if (job.channel === "lazada") {
            await serviceClient.rpc("sellerpilot_service_record_lazada_im_bootstrap_result", {
              p_job_id: parsed.data.jobId,
              p_effective_credential_id: credentialId,
              p_succeeded: false,
            });
          }
          await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
            p_credential_id: credentialId,
            p_channel: job.channel,
            p_data_type: "inquiries",
            p_status: "failed",
            p_error: "정규화된 고객 문의를 운영 원장에 저장하지 못했습니다.",
          });
          return NextResponse.json({ message: "채널 고객 문의를 운영 원장에 저장하지 못했습니다." }, { status: 500 });
        }
        if (job.channel === "lazada") {
          // `false` is an expected no-op for a non-bootstrap or stale job;
          // only an RPC transport/database error makes completion unsafe.
          const { error: bootstrapError } = await serviceClient.rpc("sellerpilot_service_record_lazada_im_bootstrap_result", {
            p_job_id: parsed.data.jobId,
            p_effective_credential_id: credentialId,
            p_succeeded: true,
          });
          if (bootstrapError) {
            return NextResponse.json({ message: "Lazada 문의 초기 동기화 완료 상태를 저장하지 못했습니다." }, { status: 500 });
          }
        }
      } else {
        if (job.channel === "lazada") {
          await serviceClient.rpc("sellerpilot_service_record_lazada_im_bootstrap_result", {
            p_job_id: parsed.data.jobId,
            p_effective_credential_id: credentialId,
            p_succeeded: false,
          });
        }
        const { error: syncError } = await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
          p_credential_id: credentialId,
          p_channel: job.channel,
          p_data_type: "inquiries",
          p_status: "failed",
          p_error: inquiryResult.safeMessage,
        });
        if (syncError) return NextResponse.json({ message: "채널 문의 실패 상태를 기록하지 못했습니다." }, { status: 500 });
      }
    }
    storedResponse = oauthResult
      ? { ok: true, channel: oauthResult.channel, operation: oauthResult.operation, safeMessage: oauthResult.safeMessage }
      : parsed.data.result;
  } else if (parsed.data.status === "reconciliation_required" && parsed.data.result) {
    storedResponse = parsed.data.result;
  } else if (job.operation === "orders.list" || job.operation === "inquiries.list") {
    const dataType = job.operation === "orders.list" ? "orders" : "inquiries";
    await serviceClient.rpc("sellerpilot_service_mark_channel_sync", {
      p_credential_id: effectiveCredentialId,
      p_channel: job.channel,
      p_data_type: dataType,
      p_status: "failed",
      p_error: parsed.data.error,
    });
  }

  if (job.operation === "listing.lineage.verify") {
    if (!listingLineageChannels.has(String(job.channel))) {
      return NextResponse.json({ message: "상품 계보 검증 채널이 현재 작업과 일치하지 않습니다." }, { status: 409 });
    }

    let lineageStatus: "succeeded" | "failed" | "retryable";
    let lineagePayload: Record<string, unknown> | null;
    let lineageError: string | null = null;
    if (parsed.data.status === "succeeded") {
      const lineageResult = parsed.data.result as ListingLineageWorkerResult;
      if (lineageResult.operation !== "listing.lineage.verify"
          || lineageResult.channel !== job.channel) {
        return NextResponse.json({ message: "상품 계보 검증 결과가 현재 작업과 일치하지 않습니다." }, { status: 409 });
      }
      if (lineageResult.verificationStatus === "verified") {
        lineageStatus = "succeeded";
        lineagePayload = listingLineageSuccessPayload(lineageResult);
      } else {
        const reason = lineageResult.evidence.reasonCode === "EBAY_MARKETPLACE_SKU_MISSING"
          ? "marketplace_sku_missing"
          : "provider_resource_ambiguous";
        lineageStatus = "failed";
        lineagePayload = listingLineageFailurePayload(String(job.channel), reason);
        lineageError = reason;
      }
    } else if (parsed.data.status === "reconciliation_required") {
      lineageStatus = "retryable";
      lineagePayload = null;
      lineageError = "provider_readback_retryable";
    } else {
      const reason = listingLineageFailureReason(parsed.data.error);
      lineageStatus = "failed";
      lineagePayload = listingLineageFailurePayload(String(job.channel), reason);
      lineageError = reason;
    }

    const { data: lineageData, error: lineageCompletionError } = await serviceClient.rpc(
      "sellerpilot_complete_listing_lineage_verification",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
        p_status: lineageStatus,
        p_response_payload: lineagePayload,
        p_error_message: lineageError,
      },
    );
    const lineageCompletion = listingLineageCompletionSchema.safeParse(lineageData);
    if (lineageCompletionError || !lineageCompletion.success
        || lineageCompletion.data.job_id !== parsed.data.jobId) {
      const status = lineageCompletionError ? workerRpcErrorStatus(lineageCompletionError) : 503;
      console.error("listing lineage verification completion RPC failed", {
        code: lineageCompletionError?.code ?? "invalid_contract",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (lineageCompletion.data.status === "lease_lost") {
      return NextResponse.json({ message: "실행 중인 상품 계보 검증 claim이 만료됐습니다." }, { status: 409 });
    }
    return NextResponse.json({
      message: lineageCompletion.data.status === "bound"
        ? "원격 상품과 판매자 계정 계보를 정확히 확인해 결속했습니다."
        : lineageCompletion.data.status === "queued"
          ? "읽기 전용 상품 계보 검증을 안전하게 다시 대기열에 등록했습니다."
          : "원격 상품 계보를 자동 확정하지 않고 수동 확인 상태로 보존했습니다.",
    });
  }

  const { data, error } = await serviceClient.rpc("sellerpilot_complete_channel_gateway_job", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
    p_status: parsed.data.status,
    p_response_payload: storedResponse,
    p_error_message: parsed.data.status === "succeeded" ? null : parsed.data.error,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway final completion RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (data !== true) return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  if (job.operation === "orders.list" && parsed.data.status === "succeeded") {
    await dispatchPendingPushNotifications(serviceClient).catch(() => null);
  }
  return NextResponse.json({
    message: parsed.data.status === "reconciliation_required"
      ? "채널 작업을 수동 확인 필요 상태로 안전하게 보존했습니다."
      : "채널 작업 결과가 안전하게 저장됐습니다.",
  });
}
