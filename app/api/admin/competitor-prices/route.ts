import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { executeCompetitorSearchViaChannelGateway } from "../../../../lib/channels/gateway";
import { competitorProviderRegistry, searchCompetitorProviders } from "../../../../lib/competitor-prices";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMPETITOR_ELEVENST_WAIT_MS = 20_000;
const COMPETITOR_PROVIDER_BUDGET_MS = 32_000;
const COMPETITOR_RPC_TIMEOUT_MS = 5_000;
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" } as const;

const querySchema = z.string().trim().min(2).max(500);
const aliasesSchema = z.array(z.string().trim().min(2).max(160)).max(12);

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: COMPETITOR_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;
  const requestUrl = new URL(request.url);
  const query = querySchema.safeParse(requestUrl.searchParams.get("query") ?? "");
  if (!query.success) return NextResponse.json({ message: "가격 비교 검색어를 2자 이상 입력해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  const aliases = aliasesSchema.safeParse(requestUrl.searchParams.getAll("alias"));
  if (!aliases.success) return NextResponse.json({ message: "다국어 검색어 형식을 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  try {
    const registry = await competitorProviderRegistry(admin.serviceClient, {
      elevenstTimeoutMs: COMPETITOR_ELEVENST_WAIT_MS,
      searchElevenstViaGateway: executeCompetitorSearchViaChannelGateway,
      enableMarketplaceWeb: true,
    });
    const result = await searchCompetitorProviders(registry, query.data, aliases.data, 30, COMPETITOR_PROVIDER_BUDGET_MS);
    const items = result.items.map((item) => ({
      id: item.externalId,
      externalId: item.externalId,
      provider: item.provider,
      marketplace: item.marketplace,
      title: item.title,
      url: item.url,
      imageUrl: item.imageUrl || null,
      mallName: item.mallName,
      price: item.price,
      currency: item.currency,
      verifiedSameProduct: true as const,
    }));
    if (!result.available) {
      return NextResponse.json({
        message: result.pending
          ? "연결된 공식 가격 검색 공급자의 조회가 진행 중입니다."
          : result.configured
          ? "연결된 공식 가격 검색 공급자가 응답하지 않았습니다."
          : "공식 가격 검색 공급자가 연결되지 않았습니다.",
        query: query.data,
        aliases: aliases.data,
        items,
        providers: result.providers,
      }, { status: result.pending ? 202 : result.configured ? 502 : 503, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ query: query.data, aliases: aliases.data, items, providers: result.providers }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "동일 상품 가격 정보를 불러오지 못했습니다.", items: [], providers: [] }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
