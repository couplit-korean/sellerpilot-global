import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../../lib/admin-api";
import {
  smartstoreManualAdoptionReadbackStateSchema,
  smartstoreManualAdoptionRequestSchema,
  type SmartstoreManualAdoptionReadbackState,
} from "../../../../../../lib/server-smartstore-manual-adoption";

export const runtime = "nodejs";
export const maxDuration = 30;

const productIdSchema = z.string().uuid();
const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function blocked(mode: string, message: string, status = 409) {
  return response({ ok: false, status: "blocked", mode, message }, status);
}

function verifiedResponse(value: Extract<
  SmartstoreManualAdoptionReadbackState,
  { status: "verified" }
>) {
  return response({
    ok: true,
    status: "verified",
    receiptId: value.receiptId,
    attestationId: value.attestationId,
    productId: value.productId,
    listingId: value.listingId,
    originProductNo: value.originProductNo,
    channelProductNo: value.channelProductNo,
    normalUpdateEligible: value.normalUpdateEligible,
    apiCreateSucceeded: false,
    providerMutationPerformed: value.providerMutationPerformed,
    contentVerified: value.contentVerified,
    reused: value.reused,
    message: "기존 상품 연결 확인 완료",
  });
}

const rpcOwnershipCodes = new Set([
  "SMARTSTORE_MANUAL_ADOPTION_ACCESS_DENIED",
  "SMARTSTORE_MANUAL_ADOPTION_AUTHENTICATED_OWNER_REQUIRED",
  "SMARTSTORE_MANUAL_ADOPTION_OWNER_REQUIRED",
]);
const rpcContentCodes = new Set([
  "SMARTSTORE_MANUAL_ADOPTION_APPROVED_IMAGES_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH",
  "SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_TOKEN_COLLISION",
  "SMARTSTORE_MANUAL_ADOPTION_DETAIL_IMAGES_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_PIXEL_BINDING_MISMATCH",
  "SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH",
  "SMARTSTORE_MANUAL_ADOPTION_SOURCE_DETAIL_IMAGES_INVALID",
]);
const rpcReadbackCodes = new Set([
  "SMARTSTORE_MANUAL_ADOPTION_FRESH_READBACK_REQUIRED",
  "SMARTSTORE_MANUAL_ADOPTION_OFFICIAL_REQUEST_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_READBACK_CONTRACT_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_READBACK_TIME_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_REMOTE_IDENTITY_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_SEARCH_IDENTITY_AMBIGUOUS",
  "SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INCOMPLETE",
  "SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INVALID",
]);
const rpcLineageCodes = new Set([
  "SMARTSTORE_MANUAL_ADOPTION_ATTESTATION_CONFLICT",
  "SMARTSTORE_MANUAL_ADOPTION_LEGACY_RECEIPT_CONFLICT",
  "SMARTSTORE_MANUAL_ADOPTION_LISTING_BIND_FAILED",
  "SMARTSTORE_MANUAL_ADOPTION_LISTING_IDENTITY_IMMUTABLE",
  "SMARTSTORE_MANUAL_ADOPTION_LISTING_IMMUTABLE",
  "SMARTSTORE_MANUAL_ADOPTION_LISTING_TRANSITION_INVALID",
  "SMARTSTORE_MANUAL_ADOPTION_RESOLUTION_FAILED",
  "SMARTSTORE_MANUAL_ADOPTION_SOURCE_LEDGER_IMMUTABLE",
  "SMARTSTORE_MANUAL_ADOPTION_SOURCE_TUPLE_OR_APPROVAL_DRIFT",
  "SMARTSTORE_MANUAL_ADOPTION_UPDATE_ATTESTATION_REQUIRED",
]);

function rpcErrorCode(error: { message?: string } | null) {
  return error?.message?.match(/SMARTSTORE_MANUAL_ADOPTION_[A-Z0-9_]+/u)?.[0] ?? "";
}

function safeRpcDiagnosticCode(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "unknown";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,48}$/iu.test(code)
    ? code
    : "unknown";
}

function rpcFailure(error: { message?: string; code?: string } | null) {
  const code = rpcErrorCode(error);
  console.error("smartstore_manual_adoption_queue_failure", {
    failureCode: code || "SMARTSTORE_MANUAL_ADOPTION_BACKEND_UNAVAILABLE",
    rpcCode: safeRpcDiagnosticCode(error),
  });
  if (rpcOwnershipCodes.has(code)) {
    return blocked(
      "smartstore_manual_adoption_owner_required",
      "이 상품과 스마트스토어 등록 기록을 관리할 권한을 확인하지 못해 연결하지 않았습니다.",
      403,
    );
  }
  if (rpcContentCodes.has(code)) {
    return blocked(
      "smartstore_manual_adoption_content_mismatch",
      "스마트스토어의 상품 내용 또는 상세 이미지가 현재 승인본과 일치하지 않아 연결하지 않았습니다.",
    );
  }
  if (rpcReadbackCodes.has(code)) {
    return blocked(
      "smartstore_manual_adoption_provider_readback_unverified",
      "스마트스토어 공식 조회의 상품 번호·상태·검색 결과를 하나의 최신 상품으로 확인하지 못했습니다.",
    );
  }
  if (rpcLineageCodes.has(code)) {
    return blocked(
      "smartstore_manual_adoption_not_ready",
      "현재 상품·승인·판매자 계보와 기존 등록 기록이 달라 연결하지 않았습니다. 상품 상태를 새로 확인해 주세요.",
    );
  }
  return blocked(
    "smartstore_manual_adoption_backend_unavailable",
    "스마트스토어 기존 상품 연결 작업 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    503,
  );
}

function stateResponse(state: SmartstoreManualAdoptionReadbackState) {
  if (state.status === "verified") return verifiedResponse(state);
  if (state.status === "repair_required") {
    return response({
      ok: true,
      status: "repair_required",
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      baselineId: state.baselineId,
      reused: state.reused,
      originProductNo: state.originProductNo,
      channelProductNo: state.channelProductNo,
      apiCreateSucceeded: false,
      providerMutationPerformed: false,
      contentVerified: false,
      normalUpdateEligible: false,
      message: "기존 상품 신원은 확인됐지만 현재 상세 내용이 승인본과 달라 승인 내용 복구 확인이 필요합니다.",
    });
  }
  if (state.status === "queued" || state.status === "running") {
    const running = state.status === "running";
    return response({
      ok: true,
      status: state.status,
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      reused: state.reused,
      apiCreateSucceeded: false,
      providerMutationPerformed: false,
      contentVerified: false,
      normalUpdateEligible: false,
      message: running
        ? "로컬 채널 작업기가 스마트스토어 기존 상품을 공식 조회하고 있습니다."
        : "스마트스토어 기존 상품 공식 조회 작업을 로컬 채널 작업기에 등록했습니다.",
    }, 202);
  }
  if (state.status === "reconciliation_required") {
    console.error("smartstore_manual_adoption_queue_failure", {
      failureCode: state.reason,
      jobId: state.jobId,
    });
    return response({
      ok: false,
      status: "reconciliation_required",
      mode: "smartstore_manual_adoption_reconciliation_required",
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      reused: state.reused,
      message: "스마트스토어 공식 조회 결과를 자동으로 확정하지 못해 재실행하지 않았습니다. 현재 작업 기록을 확인해 주세요.",
    }, 409);
  }

  console.error("smartstore_manual_adoption_queue_failure", {
    failureCode: state.reason,
    jobId: state.jobId,
  });
  if (state.reason === "NO_READBACK_JOB") {
    return blocked(
      "smartstore_manual_adoption_job_not_found",
      "진행 중인 스마트스토어 기존 상품 확인 작업이 없습니다. 연결 확인을 다시 시작해 주세요.",
      404,
    );
  }
  if (state.reason === "READBACK_FAILED") {
    return blocked(
      "smartstore_manual_adoption_readback_failed",
      "로컬 채널 작업기가 스마트스토어 공식 조회를 완료하지 못했습니다. 채널 연결 상태와 작업 기록을 확인해 주세요.",
    );
  }
  return blocked(
    "smartstore_manual_adoption_not_ready",
    "현재 상품·승인·판매자 계보가 기존 스마트스토어 등록 기록과 일치하지 않아 연결 확인 작업을 시작하지 않았습니다.",
  );
}

async function readRpcState(
  request: Request,
  productId: string,
  rpcName:
    | "sellerpilot_service_enqueue_smartstore_manual_adoption_readback"
    | "sellerpilot_service_get_smartstore_adoption_readback_status",
) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;

  let rpc: { data: unknown; error: { message?: string; code?: string } | null };
  try {
    rpc = await admin.serviceClient.rpc(rpcName, {
      p_actor: admin.user.id,
      p_product_id: productId,
    });
  } catch {
    return rpcFailure(null);
  }
  const parsed = smartstoreManualAdoptionReadbackStateSchema.safeParse(rpc.data);
  if (rpc.error || !parsed.success || parsed.data.productId !== productId) {
    return rpcFailure(rpc.error);
  }
  return stateResponse(parsed.data);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success || new URL(request.url).searchParams.size > 0) {
    return blocked(
      "smartstore_manual_adoption_request_invalid",
      "기존 스마트스토어 상품 연결 확인 요청값을 확인해 주세요.",
      400,
    );
  }
  return readRpcState(
    request,
    productId.data,
    "sellerpilot_service_get_smartstore_adoption_readback_status",
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = smartstoreManualAdoptionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!productId.success || !body.success) {
    return blocked(
      "smartstore_manual_adoption_request_invalid",
      "기존 스마트스토어 상품 연결 확인 요청값을 확인해 주세요.",
      400,
    );
  }
  return readRpcState(
    request,
    productId.data,
    "sellerpilot_service_enqueue_smartstore_manual_adoption_readback",
  );
}
