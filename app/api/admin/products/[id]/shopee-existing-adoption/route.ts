import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { shopeeSgExistingAdoptionIdentity } from "../../../../../../lib/channels/shopee-sg-existing-adoption";

export const runtime = "nodejs";

const productIdSchema = z.literal(shopeeSgExistingAdoptionIdentity.productId);
const requestSchema = z.object({
  credentialId: z.string().uuid(),
  confirmAdoption: z.literal(true),
}).strict();
const resultSchema = z.object({
  status: z.enum(["queued", "running", "already_bound", "manual_required"]),
  listing_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
  reason: z.string().trim().max(120).optional(),
  reused: z.boolean(),
}).strip().superRefine((value, context) => {
  if (value.status !== "manual_required" && !value.listing_id) {
    context.addIssue({ code: "custom", message: "listing identity is required" });
  }
  if ((value.status === "queued" || value.status === "running") && !value.job_id) {
    context.addIssue({ code: "custom", message: "active adoption requires a gateway job" });
  }
});
const statusSchema = z.object({
  status: z.enum(["not_started", "queued", "running", "already_bound", "manual_required"]),
  listing_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
  reason: z.string().trim().max(120).optional(),
}).strip();

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

async function productId(context: { params: Promise<{ id: string }> }) {
  return productIdSchema.safeParse((await context.params).id);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedProductId = await productId(context);
  if (!parsedProductId.success) {
    return response({ message: "이 경로는 승인된 Shopee SG 기존 QA 상품에만 사용할 수 있습니다." }, 404);
  }
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;

  const { data, error } = await admin.serviceClient.rpc(
    "sellerpilot_service_get_shopee_sg_existing_adoption_status",
    { p_actor_id: admin.user.id, p_product_id: parsedProductId.data },
  );
  const result = statusSchema.safeParse(data);
  if (error || !result.success) {
    return response({ message: "Shopee 기존상품 결속 상태를 확인하지 못했습니다." }, 503);
  }
  return response({
    ...result.data,
    productId: parsedProductId.data,
    remoteItemId: shopeeSgExistingAdoptionIdentity.itemId,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedProductId = await productId(context);
  if (!parsedProductId.success) {
    return response({ message: "이 경로는 승인된 Shopee SG 기존 QA 상품에만 사용할 수 있습니다." }, 404);
  }
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return response({ message: "Shopee 기존상품 결속 요청 형식이 올바르지 않습니다." }, 400);
  }

  const { data, error } = await admin.serviceClient.rpc(
    "sellerpilot_service_enqueue_shopee_sg_existing_adoption",
    {
      p_actor_id: admin.user.id,
      p_product_id: parsedProductId.data,
      p_credential_id: body.data.credentialId,
    },
  );
  const result = resultSchema.safeParse(data);
  if (error || !result.success) {
    return response({ message: "Shopee 기존상품 읽기 전용 결속 작업을 생성하지 못했습니다." }, 503);
  }
  if (result.data.status === "manual_required") {
    return response({
      ok: false,
      ...result.data,
      productId: parsedProductId.data,
      remoteItemId: shopeeSgExistingAdoptionIdentity.itemId,
      message: "원격 상품·판매자·언어·통화·이미지 증거를 하나로 확정하지 못해 결속하지 않았습니다.",
    }, 409);
  }
  if (result.data.status === "already_bound") {
    return response({
      ok: true,
      ...result.data,
      productId: parsedProductId.data,
      remoteItemId: shopeeSgExistingAdoptionIdentity.itemId,
      message: "Shopee SG 기존상품이 이미 검증된 판매자 계보에 결속돼 있습니다.",
    });
  }
  return response({
    ok: false,
    accepted: true,
    inProgress: result.data.status === "running",
    ...result.data,
    productId: parsedProductId.data,
    remoteItemId: shopeeSgExistingAdoptionIdentity.itemId,
    message: result.data.reused
      ? "동일한 Shopee 기존상품 읽기 전용 검증 작업을 재사용합니다."
      : "Shopee 기존상품 읽기 전용 검증을 대기열에 등록했습니다.",
  }, 202);
}
