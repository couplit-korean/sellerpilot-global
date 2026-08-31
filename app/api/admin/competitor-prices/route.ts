import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { executeCompetitorSearchViaChannelGateway } from "../../../../lib/channels/gateway";
import { competitorProviderRegistry, searchCompetitorProviders } from "../../../../lib/competitor-prices";
import type { CompetitorProductCondition, CompetitorProductIdentity } from "../../../../lib/competitor-price-model";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMPETITOR_ELEVENST_WAIT_MS = 20_000;
const COMPETITOR_PROVIDER_BUDGET_MS = 32_000;
const COMPETITOR_RPC_TIMEOUT_MS = 5_000;
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" } as const;

const querySchema = z.string().trim().min(2).max(500);
const aliasesSchema = z.array(z.string().trim().min(2).max(160)).max(12);
const identitySchema = z.object({
  productName: z.string().trim().min(2).max(160).optional(),
  brand: z.string().trim().min(1).max(120).optional(),
  manufacturer: z.string().trim().min(1).max(160).optional(),
  manufacturerPartNumber: z.string().trim().min(1).max(120).optional(),
  modelNumber: z.string().trim().min(1).max(120).optional(),
  packageContents: z.string().trim().min(1).max(120).optional(),
  condition: z.enum(["NEW", "USED", "REFURBISHED"]).optional(),
  gtin: z.string().trim().regex(/^\d{8,14}$/u).optional(),
});

const competitorCondition: Record<NonNullable<z.infer<typeof identitySchema>["condition"]>, CompetitorProductCondition> = {
  NEW: "new",
  USED: "used",
  REFURBISHED: "refurbished",
};

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: COMPETITOR_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;
  const requestUrl = new URL(request.url);
  const query = querySchema.safeParse(requestUrl.searchParams.get("query") ?? "");
  if (!query.success) return NextResponse.json({ message: "가격 비교 검색어를 2자 이상 입력해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  const aliases = aliasesSchema.safeParse(requestUrl.searchParams.getAll("alias"));
  if (!aliases.success) return NextResponse.json({ message: "다국어 검색어 형식을 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  const identityFields = identitySchema.safeParse(Object.fromEntries(
    ["productName", "brand", "manufacturer", "manufacturerPartNumber", "modelNumber", "packageContents", "condition", "gtin"]
      .flatMap((key) => {
        const value = requestUrl.searchParams.get(key);
        return value === null ? [] : [[key, value]];
      }),
  ));
  if (!identityFields.success) return NextResponse.json({ message: "확정 상품 식별정보 형식을 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  const hasStructuredIdentity = Object.keys(identityFields.data).length > 0;
  if (hasStructuredIdentity && !identityFields.data.productName) {
    return NextResponse.json({ message: "구조화 동일상품 판정에는 확정 상품명이 필요합니다." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const identity: CompetitorProductIdentity | undefined = identityFields.data.productName ? {
    productName: identityFields.data.productName,
    ...(identityFields.data.brand ? { brand: identityFields.data.brand } : {}),
    ...(identityFields.data.manufacturer ? { manufacturer: identityFields.data.manufacturer } : {}),
    ...(identityFields.data.manufacturerPartNumber ? { manufacturerPartNumber: identityFields.data.manufacturerPartNumber } : {}),
    ...(identityFields.data.modelNumber ? { modelNumber: identityFields.data.modelNumber } : {}),
    ...(identityFields.data.packageContents ? { packageContents: identityFields.data.packageContents } : {}),
    ...(identityFields.data.condition ? { condition: competitorCondition[identityFields.data.condition] } : {}),
    ...(identityFields.data.gtin ? { gtins: [identityFields.data.gtin] } : {}),
  } : undefined;
  try {
    const registry = await competitorProviderRegistry(admin.serviceClient, {
      elevenstTimeoutMs: COMPETITOR_ELEVENST_WAIT_MS,
      searchElevenstViaGateway: executeCompetitorSearchViaChannelGateway,
      enableMarketplaceWeb: true,
    });
    const result = await searchCompetitorProviders(
      registry,
      query.data,
      aliases.data,
      30,
      COMPETITOR_PROVIDER_BUDGET_MS,
      identity ? { identity } : undefined,
    );
    const fetchedAt = new Date().toISOString();
    const items = result.items.map((item) => ({
      ...item,
      id: item.externalId,
      imageUrl: item.imageUrl || null,
      verifiedSameProduct: "matchTier" in item && item.matchTier === "exact",
    }));
    // A partial response can contain confirmed prices while another provider
    // is still running. Keep the response resumable (202) until every provider
    // is terminal instead of making a partial result look settled merely
    // because one provider already searched successfully.
    if (result.pending || !result.available) {
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
        fetchedAt,
        pending: result.pending,
        configured: result.configured,
      }, { status: result.pending ? 202 : result.configured ? 502 : 503, headers: NO_STORE_HEADERS });
    }
    const partial = result.providers.some((provider) => provider.status === "failed" || provider.status === "unavailable");
    return NextResponse.json({
      ...(partial ? { message: "일부 공식 가격 검색 공급자의 조회를 완료하지 못했습니다." } : {}),
      query: query.data,
      aliases: aliases.data,
      items,
      providers: result.providers,
      fetchedAt,
      pending: false,
      configured: result.configured,
    }, { status: partial ? 207 : 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ message: "동일 상품 가격 정보를 불러오지 못했습니다.", items: [], providers: [] }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
