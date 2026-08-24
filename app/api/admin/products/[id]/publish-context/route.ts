import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { productEditSchema } from "../../../../../../lib/product-intake";

export const runtime = "nodejs";

const productIdSchema = z.string().uuid();
const noteSchema = z.object({
  supplierName: z.string().trim().max(240),
  comparisonMemo: z.string().trim().max(4000),
  competitorQuery: z.string().trim().max(500),
  competitorMonitorEnabled: z.boolean(),
});

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const params = await context.params;
  const productId = productIdSchema.safeParse(params.id);
  if (!productId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });

  const [{ data, error }, { data: commerceOperations, error: operationsError }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_product_publish_context", { p_product_id: productId.data }),
    admin.userClient.rpc("sellerpilot_get_product_operations_v2", { p_product_id: productId.data }),
  ]);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "상품 등록 준비 정보를 불러오지 못했습니다." }, { status: 404 });
  }

  const payload = data as Record<string, unknown>;
  const productOwnerId = typeof payload.ownerId === "string" ? payload.ownerId : admin.user.id;
  const sourcePaths = stringList(payload.sourceImagePaths)
    .filter((path) => path.startsWith(`${productOwnerId}/`) && !path.includes(".."));
  const generatedPaths = Object.entries(stringRecord(payload.generatedImagePaths))
    .filter(([, path]) => path.startsWith("results/") && !path.includes(".."));
  const allPaths = [...sourcePaths, ...generatedPaths.map(([, path]) => path)];
  const { data: signed, error: signedError } = allPaths.length
    ? await admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(allPaths, 2 * 60 * 60)
    : { data: [], error: null };
  if (signedError) return NextResponse.json({ message: "상품 이미지 접근 주소를 만들지 못했습니다." }, { status: 500 });

  const sourceImages = sourcePaths.map((path, index) => ({ path, url: signed?.[index]?.signedUrl ?? null }));
  const generatedImages = generatedPaths.map(([id, path], index) => ({
    id,
    path,
    url: signed?.[sourcePaths.length + index]?.signedUrl ?? null,
  }));
  delete payload.ownerId;
  delete payload.sourceImagePaths;
  delete payload.generatedImagePaths;
  return NextResponse.json({ ...payload, commerceOperations: operationsError ? null : commerceOperations, sourceImages, generatedImages }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = noteSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !body.success) return NextResponse.json({ message: "공급처·비교 메모 입력값을 확인해 주세요." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_update_product_commerce_notes", {
    p_product_id: productId.data,
    p_supplier_name: body.data.supplierName,
    p_comparison_memo: body.data.comparisonMemo,
    p_competitor_query: body.data.competitorQuery,
    p_monitor_enabled: body.data.competitorMonitorEnabled,
  });
  if (error || data !== true) return NextResponse.json({ message: "공급처·비교 메모를 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  const fields = productEditSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !fields.success) {
    return NextResponse.json({ message: fields.success ? "상품 ID 형식이 올바르지 않습니다." : fields.error.issues[0]?.message ?? "상품 수정값을 확인해 주세요." }, { status: 400 });
  }
  const { data, error } = await admin.userClient.rpc("sellerpilot_update_product_details", {
    p_product_id: productId.data,
    p_fields: fields.data,
  });
  if (error || data !== true) {
    const duplicateSku = error?.code === "23505";
    const reservedStock = error?.message?.includes("stock below reserved quantity");
    return NextResponse.json({
      message: duplicateSku ? "이미 사용 중인 판매자 SKU입니다." : reservedStock ? "재고는 예약 재고보다 적게 저장할 수 없습니다." : "상품 정보를 저장하지 못했습니다.",
    }, { status: duplicateSku || reservedStock ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, fields: fields.data }, { headers: { "cache-control": "no-store, max-age=0" } });
}
