import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../../lib/admin-api";
import {
  collectSmartstoreManualAdoptionReadback,
  smartstoreManualAdoptionCommitSchema,
  smartstoreManualAdoptionPreparationSchema,
  smartstoreManualAdoptionRequestSchema,
  SmartstoreManualAdoptionError,
} from "../../../../../../lib/server-smartstore-manual-adoption";

export const runtime = "nodejs";
export const maxDuration = 120;

const productIdSchema = z.string().uuid();
const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function blocked(mode: string, message: string, status = 409) {
  return response({ ok: false, status: "blocked", mode, message }, status);
}

const preparationBlockedMessages: Record<string, string> = {
  SOURCE_RECONCILIATION_REQUIRED:
    "이 상품에 연결할 스마트스토어 등록 실패 기록을 찾지 못해 기존 상품 연결을 시작하지 않았습니다.",
  SOURCE_RECONCILIATION_AMBIGUOUS:
    "이 상품에 연결 가능한 스마트스토어 등록 실패 기록이 여러 개라 대상을 하나로 확정하지 못했습니다.",
  VERIFIED_BINDING_DRIFT:
    "기존에 확인한 스마트스토어 상품 연결과 현재 상품·승인 정보가 달라 정상 수정 경로를 열지 않았습니다.",
  SOURCE_TUPLE_OR_APPROVAL_NOT_CURRENT:
    "현재 상품·판매자 계정·승인 이미지와 기존 스마트스토어 등록 기록이 모두 일치하지 않아 연결하지 않았습니다.",
};

function preparationBlocked(reason: string) {
  return blocked(
    "smartstore_manual_adoption_not_ready",
    preparationBlockedMessages[reason]
      ?? "현재 상품 원장에서 공식 기존 상품 연결 확인을 시작할 수 없습니다.",
  );
}

function verifiedResponse(value: {
  receiptId: string;
  attestationId: string;
  productId: string;
  listingId: string;
  originProductNo: string;
  channelProductNo: string;
  normalUpdateEligible: boolean;
  apiCreateSucceeded: false;
  providerMutationPerformed: false;
  contentVerified: true;
  reused: boolean;
}) {
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
    apiCreateSucceeded: value.apiCreateSucceeded,
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

function rpcFailure(error: { message?: string } | null) {
  const code = rpcErrorCode(error);
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
    "스마트스토어 기존 상품 연결 원장을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    503,
  );
}

function providerFailure(error: unknown) {
  const code = error instanceof SmartstoreManualAdoptionError
    ? error.code
    : "SMARTSTORE_MANUAL_PROVIDER_READBACK_FAILED";
  const credentialFailure = code === "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE";
  return blocked(
    credentialFailure
      ? "smartstore_manual_adoption_credential_unavailable"
      : "smartstore_manual_adoption_provider_readback_unverified",
    credentialFailure
      ? "활성 스마트스토어 인증정보로 공식 상품 조회를 시작하지 못했습니다. 채널 연결 상태를 확인해 주세요."
      : "스마트스토어 공식 검색·원상품·채널상품·상세 이미지 결과를 하나의 기존 상품으로 확인하지 못했습니다.",
    credentialFailure ? 503 : 409,
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

  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;

  const preparedRpc = await admin.serviceClient.rpc(
    "sellerpilot_service_prepare_smartstore_manual_adoption",
    { p_actor: admin.user.id, p_product_id: productId.data },
  );
  const prepared = smartstoreManualAdoptionPreparationSchema.safeParse(preparedRpc.data);
  if (preparedRpc.error || !prepared.success
      || prepared.data.productId !== productId.data) {
    return rpcFailure(preparedRpc.error);
  }
  if (prepared.data.status === "blocked") {
    return preparationBlocked(prepared.data.reason);
  }
  if (prepared.data.status === "already_verified") {
    if (!prepared.data.receiptId
        || !prepared.data.attestationId
        || !prepared.data.originProductNo
        || !prepared.data.channelProductNo
        || prepared.data.contentVerified !== true
        || prepared.data.normalUpdateEligible !== true) {
      return rpcFailure(null);
    }
    return verifiedResponse({
      receiptId: prepared.data.receiptId,
      attestationId: prepared.data.attestationId,
      productId: prepared.data.productId,
      listingId: prepared.data.listingId,
      originProductNo: prepared.data.originProductNo,
      channelProductNo: prepared.data.channelProductNo,
      normalUpdateEligible: prepared.data.normalUpdateEligible,
      apiCreateSucceeded: false,
      providerMutationPerformed: false,
      contentVerified: true,
      reused: true,
    });
  }

  const credentialRpc = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: prepared.data.credentialId,
  });
  if (credentialRpc.error
      || !credentialRpc.data
      || typeof credentialRpc.data !== "object"
      || Array.isArray(credentialRpc.data)) {
    return providerFailure(new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE",
    ));
  }

  let readback;
  try {
    readback = await collectSmartstoreManualAdoptionReadback({
      credential: credentialRpc.data as Record<string, unknown>,
      target: { sellerSku: prepared.data.sellerSku },
      signal: AbortSignal.timeout(105_000),
    });
  } catch (error) {
    return providerFailure(error);
  }

  const committedRpc = await admin.serviceClient.rpc(
    "sellerpilot_service_commit_smartstore_manual_adoption",
    {
      p_actor: admin.user.id,
      p_product_id: productId.data,
      p_source_job_id: prepared.data.sourceJobId,
      p_credential_id: prepared.data.credentialId,
      p_expected_approval_revision: prepared.data.approvalRevision,
      p_expected_content_sha256: prepared.data.contentSha256,
      p_expected_manifest_digest: prepared.data.manifestDigest,
      p_readback: readback,
    },
  );
  const committed = smartstoreManualAdoptionCommitSchema.safeParse(committedRpc.data);
  if (committedRpc.error || !committed.success
      || committed.data.productId !== productId.data
      || committed.data.listingId !== prepared.data.listingId
      || committed.data.sourceJobId !== prepared.data.sourceJobId
      || committed.data.sourceAttemptId !== prepared.data.sourceAttemptId
      || committed.data.credentialId !== prepared.data.credentialId
      || committed.data.normalUpdateEligible !== true) {
    return rpcFailure(committedRpc.error);
  }
  return verifiedResponse(committed.data);
}
