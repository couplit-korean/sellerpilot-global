import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { groupCompetitorPrices, naverSearchCredentials, searchNaverShopping } from "../../../../lib/competitor-prices";

export const runtime = "nodejs";
export const maxDuration = 30;

const querySchema = z.string().trim().min(2).max(500);

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const query = querySchema.safeParse(new URL(request.url).searchParams.get("query") ?? "");
  if (!query.success) return NextResponse.json({ message: "가격 비교 검색어를 2자 이상 입력해 주세요." }, { status: 400 });
  const credentials = await naverSearchCredentials(admin.serviceClient);
  if (!credentials) return NextResponse.json({ message: "네이버 쇼핑 검색 인증이 연결되지 않았습니다.", items: [] }, { status: 503 });
  try {
    const items = groupCompetitorPrices(await searchNaverShopping(query.data, credentials, 30)).map((item) => ({
      id: item.externalId,
      marketplace: item.marketplace,
      title: item.title,
      url: item.url,
      imageUrl: item.imageUrl || null,
      mallName: item.mallName,
      price: item.price,
      currency: "KRW",
    }));
    return NextResponse.json({ query: query.data, items }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ message: "동일 상품 가격 정보를 불러오지 못했습니다.", items: [] }, { status: 502 });
  }
}
