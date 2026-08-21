import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type DueProduct = { product_id: string; query: string };

function plainText(value: unknown) {
  return String(value ?? "").replace(/<[^>]*>/g, "").replaceAll("&quot;", "\"").replaceAll("&amp;", "&").trim();
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "경쟁가 조회 인증이 필요합니다." }, { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const clientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim() ?? "";
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    return NextResponse.json({ message: "Supabase 또는 네이버 쇼핑 검색 환경변수가 없습니다." }, { status: 503 });
  }
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await serviceClient.rpc("sellerpilot_service_due_competitor_products", { p_limit: 40 });
  if (error) return NextResponse.json({ message: "경쟁가 조회 대상 상품을 읽지 못했습니다." }, { status: 500 });
  const due = (Array.isArray(data) ? data : []).filter((item): item is DueProduct => Boolean(item) && typeof item === "object" && typeof item.product_id === "string" && typeof item.query === "string");
  const results = [] as Array<{ productId: string; ok: boolean; count: number }>;
  for (const product of due) {
    try {
      const url = new URL("https://openapi.naver.com/v1/search/shop.json");
      url.searchParams.set("query", product.query);
      url.searchParams.set("display", "5");
      url.searchParams.set("sort", "sim");
      const response = await fetch(url, { headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("naver_search_failed");
      const payload = await response.json() as { items?: Array<Record<string, unknown>> };
      const items = (payload.items ?? []).slice(0, 5).map((item) => ({
        externalId: String(item.productId ?? item.link ?? "").slice(0, 500),
        title: plainText(item.title).slice(0, 1000),
        url: String(item.link ?? "").slice(0, 4000),
        imageUrl: String(item.image ?? "").slice(0, 4000),
        mallName: plainText(item.mallName).slice(0, 240),
        price: Math.max(0, Number(item.lprice ?? 0)),
      })).filter((item) => item.externalId && item.url && Number.isFinite(item.price));
      const { data: saved, error: saveError } = await serviceClient.rpc("sellerpilot_service_record_competitor_prices", { p_product_id: product.product_id, p_items: items });
      if (saveError) throw new Error("competitor_price_save_failed");
      results.push({ productId: product.product_id, ok: true, count: Number(saved ?? items.length) });
    } catch {
      results.push({ productId: product.product_id, ok: false, count: 0 });
    }
  }
  return NextResponse.json({ ok: results.every((item) => item.ok), checked: results.length, results }, { status: results.some((item) => !item.ok) ? 207 : 200, headers: { "cache-control": "no-store, max-age=0" } });
}
