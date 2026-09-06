import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../../lib/admin-api";
import {
  smartstoreContentRepairRequestSchema,
  smartstoreContentRepairStateSchema,
  type SmartstoreContentRepairState,
} from "../../../../../../lib/server-smartstore-content-repair";

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

function stateResponse(state: SmartstoreContentRepairState) {
  if (state.status === "verified") {
    return response({
      ok: true,
      status: "verified",
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      baselineId: state.baselineId,
      verificationJobId: state.verificationJobId,
      reused: state.reused,
      apiCreateSucceeded: false,
      contentVerified: state.contentVerified,
      providerMutationPerformed: state.providerMutationPerformed,
      normalUpdateEligible: state.normalUpdateEligible,
      message: "승인 내용 복구와 스마트스토어 공식 재검증을 완료했습니다.",
    });
  }
  if (state.status === "repair_required") {
    return response({
      ok: true,
      status: "repair_required",
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      baselineId: state.baselineId,
      verificationJobId: state.verificationJobId,
      reused: state.reused,
      apiCreateSucceeded: false,
      contentVerified: state.contentVerified,
      providerMutationPerformed: state.providerMutationPerformed,
      normalUpdateEligible: state.normalUpdateEligible,
      message: "기존 상품 신원은 확인됐지만 현재 상세 내용이 승인본과 달라 복구 확인이 필요합니다.",
    });
  }
  if (["queued", "running", "verification_queued", "verification_running"].includes(state.status)) {
    const message = state.status === "queued"
      ? "승인된 상품 내용으로 복구하는 작업을 로컬 채널 작업기에 등록했습니다."
      : state.status === "running"
        ? "로컬 채널 작업기가 현재 판매가·재고·정책을 보존하며 승인 내용을 복구하고 있습니다."
        : state.status === "verification_queued"
          ? "내용 복구를 마쳤고 스마트스토어 공식 재검증을 대기하고 있습니다."
          : "복구한 내용을 스마트스토어 공식 API로 재검증하고 있습니다.";
    return response({
      ok: true,
      status: state.status,
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      baselineId: state.baselineId,
      verificationJobId: state.verificationJobId,
      reused: state.reused,
      apiCreateSucceeded: false,
      contentVerified: state.contentVerified,
      providerMutationPerformed: state.providerMutationPerformed,
      normalUpdateEligible: state.normalUpdateEligible,
      message,
    }, 202);
  }
  if (state.status === "reconciliation_required"
      || state.status === "verification_reconciliation_required") {
    return response({
      ok: false,
      status: state.status,
      mode: state.status === "reconciliation_required"
        ? "smartstore_content_repair_reconciliation_required"
        : "smartstore_content_verification_reconciliation_required",
      productId: state.productId,
      listingId: state.listingId,
      jobId: state.jobId,
      baselineId: state.baselineId,
      verificationJobId: state.verificationJobId,
      reused: state.reused,
      apiCreateSucceeded: false,
      contentVerified: false,
      providerMutationPerformed: true,
      normalUpdateEligible: false,
      message: state.status === "reconciliation_required"
        ? "스마트스토어 쓰기 결과를 확정하지 못해 같은 복구를 다시 보내지 않았습니다. 작업 기록을 확인해 주세요."
        : "복구 후 공식 조회 결과를 확정하지 못해 연결 완료로 처리하지 않았습니다. 작업 기록을 확인해 주세요.",
    }, 409);
  }

  const message = state.reason === "REPAIR_BASELINE_REQUIRED"
    ? "먼저 기존 스마트스토어 상품의 신원을 읽기 전용으로 확인해 주세요."
    : state.reason === "REPAIR_BASELINE_STALE"
      ? "상품 또는 승인 내용이 달라져 이전 확인 결과를 사용할 수 없습니다. 기존 상품 연결 확인부터 다시 진행해 주세요."
      : state.reason === "REPAIR_JOB_FAILED"
        ? "승인 내용 복구 작업을 완료하지 못했습니다. 채널 작업 기록을 확인해 주세요."
        : state.reason === "STRICT_READBACK_FAILED"
          ? "복구 후 스마트스토어 공식 내용 검증을 통과하지 못해 연결 완료로 처리하지 않았습니다."
          : "현재 상품·승인·판매자 계보가 복구 조건과 일치하지 않습니다.";
  return response({
    ok: false,
    status: "blocked",
    mode: "smartstore_content_repair_blocked",
    productId: state.productId,
    listingId: state.listingId,
    jobId: state.jobId,
    baselineId: state.baselineId,
    verificationJobId: state.verificationJobId,
    message,
  }, 409);
}

function rpcFailure(error: { message?: string; code?: string } | null) {
  const failureCode = error?.message?.match(/SMARTSTORE_(?:EXISTING_)?CONTENT_REPAIR_[A-Z0-9_]+/u)?.[0]
    ?? "SMARTSTORE_CONTENT_REPAIR_BACKEND_UNAVAILABLE";
  const rpcCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,48}$/iu.test(error.code)
    ? error.code
    : "unknown";
  console.error("smartstore_content_repair_queue_failure", { failureCode, rpcCode });
  if (/ACCESS_DENIED|OWNER_REQUIRED/u.test(failureCode)) {
    return blocked(
      "smartstore_content_repair_owner_required",
      "이 상품과 스마트스토어 등록 기록을 관리할 권한을 확인하지 못했습니다.",
      403,
    );
  }
  if (/BASELINE|APPROVAL|SOURCE|IDENTITY|STALE|DRIFT|ATTESTATION/u.test(failureCode)) {
    return blocked(
      "smartstore_content_repair_not_ready",
      "현재 상품·승인·판매자 계보가 앞서 확인한 스마트스토어 상품과 달라 복구를 시작하지 않았습니다.",
    );
  }
  return blocked(
    "smartstore_content_repair_backend_unavailable",
    "스마트스토어 승인 내용 복구 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    503,
  );
}

async function readRpcState(
  request: Request,
  productId: string,
  rpcName:
    | "sellerpilot_service_enqueue_smartstore_content_repair"
    | "sellerpilot_service_get_smartstore_content_repair_status",
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
  const parsed = smartstoreContentRepairStateSchema.safeParse(rpc.data);
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
      "smartstore_content_repair_request_invalid",
      "스마트스토어 승인 내용 복구 상태 요청값을 확인해 주세요.",
      400,
    );
  }
  return readRpcState(
    request,
    productId.data,
    "sellerpilot_service_get_smartstore_content_repair_status",
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = smartstoreContentRepairRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!productId.success || !body.success) {
    return blocked(
      "smartstore_content_repair_request_invalid",
      "스마트스토어 승인 내용 복구 요청값을 확인해 주세요.",
      400,
    );
  }
  return readRpcState(
    request,
    productId.data,
    "sellerpilot_service_enqueue_smartstore_content_repair",
  );
}
