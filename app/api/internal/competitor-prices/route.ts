import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { executeCompetitorSearchViaChannelGateway } from "../../../../lib/channels/gateway";
import { competitorProviderRegistry, searchCompetitorProviders } from "../../../../lib/competitor-prices";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type DueProduct = { product_id: string; query: string; aliases: string[] };

function serverClient() {
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function runCompetitorPrices(serviceClient: NonNullable<ReturnType<typeof serverClient>>) {
  const registry = await competitorProviderRegistry(serviceClient, {
    searchElevenstViaGateway: executeCompetitorSearchViaChannelGateway,
  });
  if (!registry.configured.length) return NextResponse.json({ message: "공식 가격 검색 공급자를 확인하지 못했습니다.", providers: registry.unavailable }, { status: 503 });
  const { data, error } = await serviceClient.rpc("sellerpilot_service_due_competitor_products", { p_limit: 40 });
  if (error) return NextResponse.json({ message: "경쟁가 조회 대상 상품을 읽지 못했습니다." }, { status: 500 });
  const due = (Array.isArray(data) ? data : []).flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.product_id !== "string" || typeof item.query !== "string") return [];
    const aliases = Array.isArray(item.aliases) ? item.aliases.filter((alias: unknown): alias is string => typeof alias === "string") : [];
    return [{ product_id: item.product_id, query: item.query, aliases } satisfies DueProduct];
  });
  const results = [] as Array<{ productId: string; ok: boolean; count: number; providers: Awaited<ReturnType<typeof searchCompetitorProviders>>["providers"] }>;
  for (const product of due) {
    try {
      const searched = await searchCompetitorProviders(registry, product.query, product.aliases, 30);
      if (!searched.available) {
        results.push({ productId: product.product_id, ok: false, count: 0, providers: searched.providers });
        continue;
      }
      const items = searched.items;
      const { data: saved, error: saveError } = await serviceClient.rpc("sellerpilot_service_record_competitor_prices", { p_product_id: product.product_id, p_items: items });
      if (saveError) throw new Error("competitor_price_save_failed");
      results.push({ productId: product.product_id, ok: true, count: Number(saved ?? items.length), providers: searched.providers });
    } catch {
      results.push({ productId: product.product_id, ok: false, count: 0, providers: registry.unavailable });
    }
  }
  return NextResponse.json({ ok: results.every((item) => item.ok), checked: results.length, results }, { status: results.some((item) => !item.ok) ? 207 : 200, headers: { "cache-control": "no-store, max-age=0" } });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "경쟁가 조회 인증이 필요합니다." }, { status: 401 });
  }
  const serviceClient = serverClient();
  if (!serviceClient) return NextResponse.json({ message: "Supabase 서버 설정이 없습니다." }, { status: 503 });
  return runCompetitorPrices(serviceClient);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const serviceClient = serverClient();
  if (!workerToken.startsWith("spw_") || !serviceClient) {
    return NextResponse.json({ message: "경쟁가 작업자 인증이 필요합니다." }, { status: 401 });
  }
  const { data, error } = await serviceClient.rpc("sellerpilot_service_validate_worker_token", {
    p_token_hash: createHash("sha256").update(workerToken).digest("hex"),
    p_worker_version: "competitor-price-scheduler",
  });
  if (error || data !== true) return NextResponse.json({ message: "경쟁가 작업자 인증이 유효하지 않습니다." }, { status: 401 });
  return runCompetitorPrices(serviceClient);
}
