
import { NextResponse } from "next/server";
import { z } from "zod";
import { gatewayJobCompletionStatusAtJobBoundary, gatewayResultRequiresAdditionalEvidence, smartstoreContentRepairWorkerResultSchema, smartstoreManualAdoptionLineageResultSchema } from "./gateway-contract";
import { smartstoreContentRepairCompletionSchema } from "../server-smartstore-content-repair";
import { workerRpcErrorMessage, workerRpcErrorStatus } from "../worker-rpc";

const listingLineageChannels = new Set(["qoo10", "shopee", "lazada", "ebay"]);
const smartstoreManualAdoptionCompletionBase = z.object({
  contract: z.literal("smartstore_manual_adoption_readback_completion_v1"),
  jobId: z.string().uuid(),
  readbackSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  reused: z.boolean(),
}).strict();
const smartstoreManualAdoptionCompletionSchema = z.union([
  smartstoreManualAdoptionCompletionBase.extend({
    status: z.enum([
      "verified",
      "queued",
      "failed",
      "reconciliation_required",
      "lease_lost",
    ]),
    receiptId: z.string().uuid().nullable(),
    attestationId: z.string().uuid().nullable(),
    // The pre-repair completion RPC omitted this key. Accept only omission or
    // null while code and migration roll independently.
    baselineId: z.null().optional(),
    reason: z.string().min(1).max(160).nullable(),
  }),
  smartstoreManualAdoptionCompletionBase.extend({
    status: z.literal("repair_required"),
    receiptId: z.null(),
    attestationId: z.null(),
    baselineId: z.string().uuid(),
    readbackSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    reason: z.literal("APPROVED_CONTENT_REPAIR_REQUIRED"),
  }),
]);
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

function completionNormalizationTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayWorkerCompletion } from "./gateway-contract";
export async function completeCommerceWorker({ serviceClient, tokenHash, job, completion: completionInput }: { serviceClient: SupabaseClient; tokenHash: string; job: Record<string, unknown>; completion: GatewayWorkerCompletion }) {
  if (/^(orders|shipment)\./.test(String(job.operation)) || job.operation === "inquiries.list" || job.operation === "inquiries.reply") return NextResponse.json({ message: "상품 작업 계보가 일치하지 않습니다." }, { status: 409 });
  const parsed = { data: completionInput };
  const publicationVerificationBoundary = completionNormalizationTimestamp(
    job.publication_verification_boundary,
  );
  const succeededResult = parsed.data.status === "succeeded" ? parsed.data.result : null;
  const succeededResultRecord = succeededResult as unknown as Record<string, unknown> | null;
  const effectiveCompletionStatus = gatewayJobCompletionStatusAtJobBoundary(
    parsed.data.status,
    succeededResultRecord,
    publicationVerificationBoundary,
  );
  const effectiveCompletionError = effectiveCompletionStatus === "reconciliation_required" && parsed.data.status === "succeeded"
    ? (gatewayResultRequiresAdditionalEvidence("steps" in parsed.data.result ? parsed.data.result.steps : [])
      ? "LISTING_ADDITIONAL_EVIDENCE_REQUIRED"
      : "LISTING_REMOTE_STATE_PROVIDER_MUTATION_BOUNDARY_MISMATCH") : parsed.data.status === "succeeded" ? null : parsed.data.error;

  let storedResponse: Record<string, unknown> | null = null;
  const completionResult = parsed.data.status === "succeeded"
    ? parsed.data.result
    : parsed.data.status === "reconciliation_required"
      ? parsed.data.result
      : parsed.data.result;
  if (completionResult
    && (job.channel !== completionResult.channel || job.operation !== completionResult.operation)) {
    return NextResponse.json({ message: "채널 작업 결과가 요청과 일치하지 않습니다." }, { status: 409 });
  }
  const oauthResult = parsed.data.status === "succeeded" && parsed.data.result.operation === "oauth.exchange"
    ? parsed.data.result
    : null;
  const credentialRefresh = parsed.data.credentialRefresh;
  if (credentialRefresh
    && job.channel !== "shopee"
    && job.channel !== "lazada"
    && job.channel !== "ebay") {
    return NextResponse.json({ message: "이 채널에는 OAuth 인증값 갱신을 적용할 수 없습니다." }, { status: 409 });
  }

  if (job.channel === "smartstore" && job.operation === "listing.lineage.verify") {
    const verifiedResult = parsed.data.status === "succeeded"
      ? smartstoreManualAdoptionLineageResultSchema.safeParse(parsed.data.result)
      : null;
    if (verifiedResult && !verifiedResult.success) {
      return NextResponse.json({ message: "스마트스토어 기존 상품 조회 결과 형식이 올바르지 않습니다." }, { status: 409 });
    }
    const adoptionStatus = parsed.data.status === "succeeded"
      ? "succeeded"
      : parsed.data.status === "reconciliation_required"
        ? "retryable"
        : "failed";
    const { data: adoptionData, error: adoptionCompletionError } = await serviceClient.rpc(
      "sellerpilot_complete_smartstore_manual_adoption_readback",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
        p_status: adoptionStatus,
        p_readback: verifiedResult?.success
          ? verifiedResult.data.evidence.readback
          : null,
        p_error_message: parsed.data.status === "succeeded" ? null : parsed.data.error,
      },
    );
    const adoptionCompletion = smartstoreManualAdoptionCompletionSchema.safeParse(adoptionData);
    if (adoptionCompletionError || !adoptionCompletion.success
      || adoptionCompletion.data.jobId !== parsed.data.jobId) {
      const status = adoptionCompletionError
        ? workerRpcErrorStatus(adoptionCompletionError)
        : 503;
      console.error("smartstore manual adoption readback completion RPC failed", {
        code: adoptionCompletionError?.code ?? "invalid_contract",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (adoptionCompletion.data.status === "lease_lost") {
      return NextResponse.json({ message: "실행 중인 스마트스토어 기존 상품 조회 claim이 만료됐습니다." }, { status: 409 });
    }
    return NextResponse.json({
      message: adoptionCompletion.data.status === "verified"
        ? "스마트스토어 기존 상품을 공식 조회하고 SellerPilot 원장에 안전하게 연결했습니다."
        : adoptionCompletion.data.status === "repair_required"
          ? "스마트스토어 기존 상품 신원을 확인했으며 승인 내용 복구 확인이 필요한 상태로 보존했습니다."
          : adoptionCompletion.data.status === "queued"
            ? "스마트스토어 기존 상품 읽기 검증을 동일 작업으로 다시 대기시켰습니다."
            : adoptionCompletion.data.status === "reconciliation_required"
              ? "스마트스토어 읽기 결과를 재전송하지 않고 확인 필요 상태로 보존했습니다."
              : "스마트스토어 기존 상품을 연결하지 않고 조회 실패 상태를 저장했습니다.",
    });
  }

  if (job.channel === "smartstore"
    && job.operation === "listing.update"
    && job.smartstoreContentRepairContract === "smartstore_existing_content_repair_job_v1") {
    const repairResult = parsed.data.status === "succeeded"
      ? smartstoreContentRepairWorkerResultSchema.safeParse(parsed.data.result)
      : null;
    if (repairResult && !repairResult.success) {
      return NextResponse.json({ message: "스마트스토어 승인 내용 복구 결과 형식이 올바르지 않습니다." }, { status: 409 });
    }
    const repairStatus = parsed.data.status === "succeeded"
      ? "succeeded"
      : parsed.data.status === "reconciliation_required"
        ? "reconciliation_required"
        : "failed";
    const { data: repairData, error: repairCompletionError } = await serviceClient.rpc(
      "sellerpilot_complete_smartstore_content_repair",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
        p_status: repairStatus,
        p_readback: repairResult?.success ? repairResult.data.evidence : null,
        p_error_message: parsed.data.status === "succeeded" ? null : parsed.data.error,
      },
    );
    const repairCompletion = smartstoreContentRepairCompletionSchema.safeParse(repairData);
    if (repairCompletionError || !repairCompletion.success
      || repairCompletion.data.jobId !== parsed.data.jobId) {
      const status = repairCompletionError
        ? workerRpcErrorStatus(repairCompletionError)
        : 503;
      console.error("smartstore content repair completion RPC failed", {
        code: repairCompletionError?.code ?? "invalid_contract",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (repairCompletion.data.status === "lease_lost") {
      return NextResponse.json({ message: "실행 중인 스마트스토어 승인 내용 복구 claim이 만료됐습니다." }, { status: 409 });
    }
    return NextResponse.json({
      completionStatus: repairCompletion.data.status,
      durableEvidenceStored: repairCompletion.data.status === "verification_queued",
      message: repairCompletion.data.status === "verification_queued"
        ? "스마트스토어 승인 내용 복구를 기록하고 공식 재검증 작업을 등록했습니다."
        : repairCompletion.data.status === "reconciliation_required"
          ? "스마트스토어 복구 결과를 재전송하지 않고 확인 필요 상태로 보존했습니다."
          : "스마트스토어 승인 내용 복구 실패 상태를 저장했습니다.",
    });
  }

  if (parsed.data.status === "succeeded") {
    storedResponse = oauthResult
      ? { ok: true, channel: oauthResult.channel, operation: oauthResult.operation, safeMessage: oauthResult.safeMessage }
      : parsed.data.result;
  } else if (parsed.data.result) { storedResponse = parsed.data.result; }

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

  const diagnostic = parsed.data.status === "succeeded"
    && parsed.data.result.operation === "diagnostic.test"
    ? parsed.data.result.diagnostic
    : null;
  const { data, error } = await serviceClient.rpc("sellerpilot_service_complete_gateway_transaction", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
    p_status: effectiveCompletionStatus,
    p_response_payload: storedResponse,
    p_error_message: effectiveCompletionError,
    p_credential_refresh: credentialRefresh ?? null,
    p_normalized_orders: null,
    p_normalized_inquiries: null,
    p_diagnostic: diagnostic,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway final completion RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  const completion = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (completion?.status !== "completed") {
    return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }
  return NextResponse.json({
    message: effectiveCompletionStatus === "reconciliation_required"
      ? "채널 작업을 수동 확인 필요 상태로 안전하게 보존했습니다."
      : "채널 작업 결과가 안전하게 저장됐습니다.",
  });
}
