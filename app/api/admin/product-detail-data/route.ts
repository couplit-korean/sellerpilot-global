import { NextResponse } from "next/server";
import { productDetailDataBodySchema, productDetailDataQuerySchema } from "../../../../lib/product-detail-data-contract";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const url = new URL(request.url);
  const parsed = productDetailDataQuerySchema.safeParse({ productId: url.searchParams.get("productId") });
  if (!parsed.success) {
    return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_get_product_detail_data", {
    p_product_id: parsed.data.productId,
  });
  if (error) {
    return NextResponse.json({ message: "상세페이지 편집 데이터를 불러오지 못했습니다." }, { status: 503, headers: noStoreHeaders });
  }
  const detailData = data && typeof data === "object" ? data : null;
  return NextResponse.json({ detailData }, { headers: noStoreHeaders });
}

async function upsert(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const body = productDetailDataBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { message: body.error.issues[0]?.message ?? "상세페이지 편집 데이터 형식을 확인해 주세요." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_upsert_product_detail_data", {
    p_product_id: body.data.productId,
    p_detail_data: body.data.detailData,
  });
  if (error || data !== true) {
    const rejected = error?.code === "42501";
    return NextResponse.json(
      { message: error?.message ?? "상세페이지 편집 데이터를 저장하지 못했습니다." },
      { status: rejected ? 403 : 409, headers: noStoreHeaders },
    );
  }
  return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  return upsert(request);
}

export async function PUT(request: Request) {
  return upsert(request);
}
