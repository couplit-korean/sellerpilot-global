import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { naverSearchCredentials, searchNaverShopping } from "../../../../lib/competitor-prices";
import { supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 60;

type DueProduct = { product_id: string; query: string };

function serverClient() {
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function runCompetitorPrices(serviceClient: NonNullable<ReturnType<typeof serverClient>>) {
  const credentials = await naverSearchCredentials(serviceClient);
  if (!credentials) {
    return NextResponse.json({ message: "네이버 쇼핑 검색 인증을 확인하지 못했습니다." }, { status: 503 });
  }
  const { data, error } = await serviceClient.rpc("sellerpilot_service_due_competitor_products", { p_limit: 40 });
  if (error) return NextResponse.json({ message: "경쟁가 조회 대상 상품을 읽지 못했습니다." }, { status: 500 });
  const due = (Array.isArray(data) ? data : []).filter((item): item is DueProduct => Boolean(item) && typeof item === "object" && typeof item.product_id === "string" && typeof item.query === "string");
  const results = [] as Array<{ productId: string; ok: boolean; count: number }>;
  for (const product of due) {
    try {
      const items = await searchNaverShopping(product.query, credentials, 30);
      const { data: saved, error: saveError } = await serviceClient.rpc("sellerpilot_service_record_competitor_prices", { p_product_id: product.product_id, p_items: items });
      if (saveError) throw new Error("competitor_price_save_failed");
      results.push({ productId: product.product_id, ok: true, count: Number(saved ?? items.length) });
    } catch {
      results.push({ productId: product.product_id, ok: false, count: 0 });
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
