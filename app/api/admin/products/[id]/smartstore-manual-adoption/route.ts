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
  type SmartstoreManualAdoptionCredentialCauseCode,
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

type SmartstoreCredentialFailureCauseCode =
  | SmartstoreManualAdoptionCredentialCauseCode
  | "SMARTSTORE_CREDENTIAL_DECRYPT_RPC_FAILED"
  | "SMARTSTORE_CREDENTIAL_PAYLOAD_INVALID";

const credentialFailurePresentation: Record<
  SmartstoreCredentialFailureCauseCode,
  { mode: string; message: string }
> = {
  SMARTSTORE_CREDENTIAL_DECRYPT_RPC_FAILED: {
    mode: "smartstore_manual_adoption_credential_decrypt_failed",
    message: "스마트스토어 인증정보를 서버에서 불러오는 단계가 실패했습니다. 인증정보 저장 상태와 서비스 연결을 확인해 주세요.",
  },
  SMARTSTORE_CREDENTIAL_PAYLOAD_INVALID: {
    mode: "smartstore_manual_adoption_credential_payload_invalid",
    message: "저장된 스마트스토어 인증정보의 구조를 토큰 발급 입력으로 확인하지 못했습니다. 채널 인증정보를 다시 확인해 주세요.",
  },
  NAVER_CREDENTIALS_MISSING: {
    mode: "smartstore_manual_adoption_credentials_missing",
    message: "저장된 스마트스토어 인증정보에 토큰 발급에 필요한 값이 없습니다. 커머스API 인증 유형과 판매자 계정 연결을 확인해 주세요.",
  },
  NAVER_AUTH_FAILED: {
    mode: "smartstore_manual_adoption_auth_failed",
    message: "네이버가 커머스API 앱 인증을 거부했습니다. 앱 ID·비밀키와 인증 유형·판매자 계정 연결을 확인해 주세요.",
  },
  NAVER_IP_NOT_ALLOWED: {
    mode: "smartstore_manual_adoption_ip_not_allowed",
    message: "네이버가 이 배포 서버의 접속 IP를 허용하지 않았습니다. 커머스API 허용 IP와 현재 실행 경로의 고정 외부 IP를 확인해 주세요.",
  },
  NAVER_PROVIDER_UNAVAILABLE: {
    mode: "smartstore_manual_adoption_provider_unavailable",
    message: "네이버 토큰 발급 서비스가 서버 오류를 반환했습니다. 잠시 후 공급자 상태를 다시 확인해 주세요.",
  },
  NAVER_TOKEN_EXCHANGE_FAILED: {
    mode: "smartstore_manual_adoption_token_exchange_failed",
    message: "네이버 토큰 발급 응답을 정상 액세스 토큰으로 확인하지 못했습니다. 채널 인증 상태를 확인해 주세요.",
  },
  NAVER_TOKEN_EXCHANGE_NETWORK_FAILED: {
    mode: "smartstore_manual_adoption_token_network_failed",
    message: "이 배포 함수에서 네이버 토큰 발급 서버 연결을 완료하지 못했습니다. 네트워크와 고정 외부 연결 경로를 확인해 주세요.",
  },
  NAVER_TOKEN_EXCHANGE_POLICY_BLOCKED: {
    mode: "smartstore_manual_adoption_token_policy_blocked",
    message: "서버의 읽기 전용 전송 정책이 토큰 발급 요청을 차단했습니다. 상품 연결 확인 실행 경로를 점검해 주세요.",
  },
  NAVER_TOKEN_EXCHANGE_TIMEOUT: {
    mode: "smartstore_manual_adoption_token_timeout",
    message: "네이버 토큰 발급 요청이 제한 시간 안에 완료되지 않았습니다. 외부 연결 상태를 확인한 뒤 다시 시도해 주세요.",
  },
  NAVER_TOKEN_EXCHANGE_UNKNOWN: {
    mode: "smartstore_manual_adoption_credential_unavailable",
    message: "스마트스토어 토큰 발급 단계를 완료하지 못했습니다. 서버 로그의 안전한 원인 코드를 확인해 주세요.",
  },
};

function safeProviderFailureCode(value: unknown) {
  return typeof value === "string"
      && /^SMARTSTORE_MANUAL_[A-Z0-9_]{1,96}$/u.test(value)
    ? value
    : "SMARTSTORE_MANUAL_PROVIDER_READBACK_FAILED";
}

function safeRpcDiagnosticCode(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "unknown";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,48}$/iu.test(code)
    ? code
    : "unknown";
}

function credentialFailureResponse(
  causeCode: SmartstoreCredentialFailureCauseCode,
  diagnostic: { rpcCode?: string; rpcState?: "error" | "threw" } = {},
) {
  const presentation = credentialFailurePresentation[causeCode];
  console.error("smartstore_manual_adoption_provider_failure", {
    failureCode: "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE",
    causeCode,
    ...diagnostic,
  });
  return response({
    ok: false,
    status: "blocked",
    mode: presentation.mode,
    causeCode,
    message: presentation.message,
  }, 503);
}

function providerFailure(error: unknown) {
  const code = safeProviderFailureCode(
    error instanceof SmartstoreManualAdoptionError ? error.code : null,
  );
  const isCredentialFailure = code === "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE";
  const causeCode = isCredentialFailure && error instanceof SmartstoreManualAdoptionError
    ? error.causeCode ?? "NAVER_TOKEN_EXCHANGE_UNKNOWN"
    : null;
  if (isCredentialFailure && causeCode) {
    return credentialFailureResponse(causeCode);
  }
  console.error("smartstore_manual_adoption_provider_failure", { failureCode: code });
  return blocked(
    "smartstore_manual_adoption_provider_readback_unverified",
    "스마트스토어 공식 검색·원상품·채널상품·상세 이미지 결과를 하나의 기존 상품으로 확인하지 못했습니다.",
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

  let credentialRpc: { data: unknown; error: unknown };
  try {
    const result = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
      p_credential_id: prepared.data.credentialId,
    });
    credentialRpc = { data: result.data, error: result.error };
  } catch {
    return credentialFailureResponse("SMARTSTORE_CREDENTIAL_DECRYPT_RPC_FAILED", {
      rpcState: "threw",
    });
  }
  if (credentialRpc.error) {
    return credentialFailureResponse("SMARTSTORE_CREDENTIAL_DECRYPT_RPC_FAILED", {
      rpcCode: safeRpcDiagnosticCode(credentialRpc.error),
      rpcState: "error",
    });
  }
  if (!credentialRpc.data
      || typeof credentialRpc.data !== "object"
      || Array.isArray(credentialRpc.data)) {
    return credentialFailureResponse("SMARTSTORE_CREDENTIAL_PAYLOAD_INVALID");
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
