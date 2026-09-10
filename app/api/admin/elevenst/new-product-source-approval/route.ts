import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { buildElevenstCreateCredentialRequestBinding } from "../../../../../lib/product-registration/elevenst/credential-request-binding";
import {
  buildElevenstNewProductSourceApproval,
  elevenstNewProductSourceApprovalRequestSchema,
  elevenstNewProductSourceApprovalWriterRpc,
} from "../../../../../lib/product-registration/elevenst/new-product-source-approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };
const maximumBodyBytes = 256 * 1024;
const contextContract = "sellerpilot_elevenst_new_product_approval_context_v1";

const automaticContextSchema = z.object({
  contract: z.literal(contextContract),
  actorId: z.string().uuid(),
  ownerId: z.string().uuid(),
  productId: z.string().uuid(),
  productUpdatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  productRevision: z.number().int().positive(),
  productApprovalRevision: z.number().int().positive(),
  productName: z.string().trim().min(1).max(500),
  sellerProductCode: z.string().trim().min(1).max(120),
  inventoryQuantity: z.number().int().nonnegative(),
  credentialId: z.string().uuid(),
  credentialVersion: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
  approvedPriceKrw: z.number().int().positive(),
  approvedQuantity: z.number().int().nonnegative(),
  brand: z.string().trim().min(1).max(200),
  countryOfOrigin: z.string().trim().min(1).max(200),
  conditionCode: z.literal("01"),
  productImagePaths: z.array(z.string().trim().min(1).max(2_048)).length(4),
  detailImagePaths: z.array(z.string().trim().min(1).max(2_048)).length(8),
  detailManifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const retireSchema = z.object({
  sourceId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) return null;
  const bodyText = await request.text().catch(() => "");
  if (new TextEncoder().encode(bodyText).byteLength > maximumBodyBytes) return null;
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
}

function approvalError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const blockers = record(error) && Array.isArray(record(error)?.blockers)
    ? record(error)?.blockers
    : undefined;
  if (message.includes("APPROVAL_INPUT_BLOCKED")) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_INPUT_BLOCKED",
      message: "10개 고시·판매자·가용성·배송·반품 승인 근거가 완전하지 않습니다.",
      blockers,
    }, 409);
  }
  if (message.includes("AUTOMATIC_CONTEXT_INVALID")) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONTEXT_INVALID",
      message: "현재 상품·가격·재고·승인 상세의 서버 원장이 완전하지 않습니다.",
    }, 409);
  }
  return json({
    code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_FAILED",
    message: "11번가 신규상품 승인 source를 만들지 못했습니다.",
  }, 503);
}

function rpcFailure(error: { code?: string; message?: string } | null) {
  const message = error?.message ?? "";
  if (/CONTEXT_STALE|PAYLOAD_INVALID|ALREADY_EXISTS|REQUEST_CONFLICT/u.test(message)) {
    return json({
      code: message.match(/ELEVENST_[A-Z0-9_]+/u)?.[0]
        ?? "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONFLICT",
      message: "승인 중 상품·초안·키 revision이 바뀌었거나 다른 승인이 먼저 저장되었습니다.",
    }, 409);
  }
  if (error?.code === "42501") {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_ACCESS_DENIED",
      message: "11번가 신규상품 승인 권한을 확인하지 못했습니다.",
    }, 403);
  }
  return json({
    code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_STORAGE_UNAVAILABLE",
    message: "11번가 신규상품 승인 저장소를 사용할 수 없습니다.",
  }, 503);
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const rawBody = await readJson(request);
  const body = elevenstNewProductSourceApprovalRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_INVALID_BODY",
      message: "10개 고시와 seller/availability/배송/반품 승인 입력을 확인해 주세요.",
    }, 400);
  }

  const { data: contextData, error: contextError } = await admin.serviceClient.rpc(
    "sellerpilot_service_elevenst_new_product_approval_context",
    {
      p_actor_id: admin.user.id,
      p_product_id: body.data.productId,
      p_credential_id: body.data.credentialId,
      p_market: body.data.market,
      p_target_id: body.data.targetId,
    },
  );
  const automatic = automaticContextSchema.safeParse(contextData);
  if (contextError || !automatic.success
    || automatic.data.actorId !== admin.user.id
    || automatic.data.productId !== body.data.productId
    || automatic.data.credentialId !== body.data.credentialId) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONTEXT_UNAVAILABLE",
      message: "서버에서 현재 상품·초안·카테고리·키·승인 상세를 정확히 결속하지 못했습니다.",
    }, contextError ? 503 : 409);
  }

  const { data: credential, error: credentialError } = await admin.serviceClient.rpc(
    "sellerpilot_decrypt_credential",
    { p_credential_id: automatic.data.credentialId },
  );
  let credentialSellerIdSha256 = "";
  try {
    if (credentialError || !record(credential)) throw new Error("credential unavailable");
    credentialSellerIdSha256 = buildElevenstCreateCredentialRequestBinding({
      credentialId: automatic.data.credentialId,
      credentialVersion: automatic.data.credentialVersion,
      environment: "production",
      credential,
    }).sellerIdSha256;
  } catch {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CREDENTIAL_UNAVAILABLE",
      message: "현재 운영 credential의 seller digest를 확인하지 못했습니다.",
    }, 409);
  }

  const detailExternal = automatic.data.detailImagePaths.every((path) =>
    path.startsWith("external-detail/"));
  const detailInternal = automatic.data.detailImagePaths.every((path) =>
    path.startsWith("results/"));
  if (!detailExternal && !detailInternal) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_DETAIL_PATH_INVALID",
      message: "승인 상세 8장의 운영 저장 경로가 하나의 승인 source와 일치하지 않습니다.",
    }, 409);
  }
  const [productSigning, detailSigning] = await Promise.all([
    admin.serviceClient.storage.from("sellerpilot-ai")
      .createSignedUrls(automatic.data.productImagePaths, 15 * 60),
    admin.serviceClient.storage.from(detailExternal ? "sellerpilot-detail-imports" : "sellerpilot-ai")
      .createSignedUrls(automatic.data.detailImagePaths, 15 * 60),
  ]);
  const productImageUrls = (productSigning.data ?? []).map((item) => item.signedUrl ?? "");
  const detailImageUrls = (detailSigning.data ?? []).map((item) => item.signedUrl ?? "");
  if (productSigning.error || detailSigning.error
    || productImageUrls.length !== 4
    || detailImageUrls.length !== 8
    || [...productImageUrls, ...detailImageUrls].some((url) => !url.startsWith("https://"))
    || new Set(productImageUrls).size !== 4
    || new Set(detailImageUrls).size !== 8) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_IMAGES_UNAVAILABLE",
      message: "상품 이미지 4장과 승인 상세 이미지 8장을 현재 운영 저장소에서 확인하지 못했습니다.",
    }, 409);
  }

  let approval;
  try {
    approval = await buildElevenstNewProductSourceApproval(body.data, {
      ...automatic.data,
      credentialSellerIdSha256,
      productImageUrls,
      detailImageUrls,
    });
  } catch (error) {
    return approvalError(error);
  }

  const { data: saved, error: saveError } = await admin.serviceClient.rpc(
    elevenstNewProductSourceApprovalWriterRpc,
    {
      p_actor_id: admin.user.id,
      p_approval_request_id: body.data.approvalRequestId,
      p_product_id: body.data.productId,
      p_credential_id: body.data.credentialId,
      p_market: body.data.market,
      p_target_id: body.data.targetId,
      p_payload: approval.payload,
    },
  );
  const result = record(saved);
  if (saveError || !result
    || !["approved", "existing"].includes(String(result.status ?? ""))
    || typeof result.sourceId !== "string"
    || !/^[0-9a-f-]{36}$/iu.test(result.sourceId)
    || typeof result.approvalPayloadSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(result.approvalPayloadSha256)) {
    return rpcFailure(saveError);
  }
  return json({
    ok: true,
    status: result.status,
    sourceId: result.sourceId,
    approvalPayloadSha256: result.approvalPayloadSha256,
  });
}

export async function DELETE(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const body = retireSchema.safeParse(await readJson(request));
  if (!body.success) {
    return json({
      code: "ELEVENST_NEW_PRODUCT_SOURCE_RETIRE_INVALID_BODY",
      message: "폐기할 승인 source와 사유를 확인해 주세요.",
    }, 400);
  }
  const { data, error } = await admin.serviceClient.rpc(
    "sellerpilot_service_retire_elevenst_new_product_source",
    {
      p_actor_id: admin.user.id,
      p_source_id: body.data.sourceId,
      p_reason: body.data.reason,
    },
  );
  if (error || data !== true) return rpcFailure(error);
  return json({ ok: true, sourceId: body.data.sourceId, status: "retired" });
}
