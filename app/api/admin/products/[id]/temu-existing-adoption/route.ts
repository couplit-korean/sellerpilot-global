import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { temuExistingAdoptionIdentity } from "../../../../../../lib/channels/temu-existing-adoption";

export const runtime = "nodejs";
export const maxDuration = 120;

const productIdSchema = z.string().uuid();
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("certifyCredential"),
    credentialId: z.string().uuid(),
    confirmReadOnly: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("commitCredentialCertification"),
    reviewId: z.string().uuid(),
    observationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    confirmCredentialBinding: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("observe"),
    credentialId: z.string().uuid(),
    confirmReadOnly: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("commit"),
    reviewId: z.string().uuid(),
    observationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    confirmBinding: z.literal(true),
  }).strict(),
]);

function noStore(status = 200) {
  return { status, headers: { "cache-control": "no-store, max-age=0" } };
}

function rpcFailure(error: { message?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("ACTIVE_INCARNATION_REQUIRED")) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_active_credential_incarnation_required",
      message: "현재 Temu 운영 credential이 이미 인증됐거나 exact 계보 인증 대상과 일치하지 않아 토큰 정보 조회를 시작하지 않았습니다.",
    }, noStore(409));
  }
  if (message.includes("CREDENTIAL_CERTIFICATION_FRESH_DIGEST_REQUIRED")) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_credential_fresh_observation_confirmation_required",
      message: "15분 이내 Temu mallId 관측값과 화면에서 다시 확인한 동일 digest가 필요합니다.",
    }, noStore(409));
  }
  if (message.includes("PROVIDER_CERTIFIED_CREDENTIAL_REQUIRED")) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_provider_certified_credential_required",
      message: "Temu 운영 계정 계보가 공급자 readback으로 인증된 활성 credential이 없어 관측을 시작하지 않았습니다.",
    }, noStore(409));
  }
  if (message.includes("STATIC_EGRESS_REQUIRED")) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_static_egress_required",
      message: "Temu에 등록된 고정 egress가 준비되지 않아 원격 조회를 시작하지 않았습니다.",
    }, noStore(409));
  }
  if (message.includes("FRESH_DIGEST_CONFIRMATION_REQUIRED")) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_fresh_observation_confirmation_required",
      message: "15분 이내의 fresh Temu 관측값과 화면에서 다시 확인한 동일 digest가 필요합니다.",
    }, noStore(409));
  }
  if (message.includes("LISTING_ALREADY_BOUND")) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_listing_already_bound",
      message: "같은 중앙상품 또는 원격 goodsId가 이미 SellerPilot 원장에 결속되어 중복 adoption을 차단했습니다.",
    }, noStore(409));
  }
  return NextResponse.json({
    ok: false,
    status: "blocked",
    mode: "temu_exact_existing_adoption_unavailable",
    message: "Temu exact 기존상품 결속 조건을 모두 확인하지 못해 아무 원격 쓰기나 원장 결속도 실행하지 않았습니다.",
  }, noStore(503));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success || productId.data !== temuExistingAdoptionIdentity.productId) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_exact_product_required",
      message: "이 경로는 검토된 Temu QA 중앙상품 한 건에만 사용할 수 있습니다.",
    }, noStore(404));
  }
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;
  const rpcArguments = { p_product_id: productId.data, p_actor_user_id: admin.user.id };
  const [adoption, credentialCertification] = await Promise.all([
    admin.serviceClient.rpc(
      "sellerpilot_service_temu_exact_existing_adoption_status",
      rpcArguments,
    ),
    admin.serviceClient.rpc(
      "sellerpilot_service_temu_exact_credential_certification_status",
      rpcArguments,
    ),
  ]);
  if (adoption.error || !adoption.data
      || typeof adoption.data !== "object" || Array.isArray(adoption.data)) {
    return rpcFailure(adoption.error);
  }
  if (credentialCertification.error || !credentialCertification.data
      || typeof credentialCertification.data !== "object"
      || Array.isArray(credentialCertification.data)) {
    return rpcFailure(credentialCertification.error);
  }
  return NextResponse.json({
    ok: true,
    ...adoption.data,
    credentialCertification: credentialCertification.data,
  }, noStore());
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success
      || productId.data !== temuExistingAdoptionIdentity.productId
      || !body.success) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "temu_exact_adoption_request_invalid",
      message: "Temu exact 기존상품 관측·결속 요청값을 확인해 주세요.",
    }, noStore(400));
  }
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;

  let result;
  if (body.data.action === "certifyCredential") {
    result = await admin.serviceClient.rpc(
      "sellerpilot_service_enqueue_temu_exact_credential_certification",
      {
        p_product_id: productId.data,
        p_credential_id: body.data.credentialId,
        p_actor_user_id: admin.user.id,
      },
    );
  } else if (body.data.action === "commitCredentialCertification") {
    result = await admin.serviceClient.rpc(
      "sellerpilot_service_commit_temu_exact_credential_certification",
      {
        p_product_id: productId.data,
        p_review_id: body.data.reviewId,
        p_observation_digest: body.data.observationDigest,
        p_actor_user_id: admin.user.id,
      },
    );
  } else if (body.data.action === "observe") {
    result = await admin.serviceClient.rpc(
        "sellerpilot_service_enqueue_temu_exact_existing_adoption",
        {
          p_product_id: productId.data,
          p_credential_id: body.data.credentialId,
          p_actor_user_id: admin.user.id,
        },
      );
  } else {
    result = await admin.serviceClient.rpc(
        "sellerpilot_service_commit_temu_exact_existing_adoption",
        {
          p_product_id: productId.data,
          p_review_id: body.data.reviewId,
          p_observation_digest: body.data.observationDigest,
          p_actor_user_id: admin.user.id,
        },
      );
  }
  if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    return rpcFailure(result.error);
  }
  const payload = result.data as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    ...payload,
    providerWritePerformed: false,
  }, noStore(payload.status === "queued" || payload.status === "verifying" ? 202 : 200));
}
