import type { SupabaseClient } from "@supabase/supabase-js";

export type CompetitorMarketplace = "smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other";

export type CompetitorPriceCandidate = {
  externalId: string;
  title: string;
  url: string;
  imageUrl: string;
  mallName: string;
  marketplace: CompetitorMarketplace;
  price: number;
};

type ActiveCredential = { secret_payload?: unknown };

function plainText(value: unknown) {
  return String(value ?? "").replace(/<[^>]*>/g, "").replaceAll("&quot;", "\"").replaceAll("&amp;", "&").trim();
}

export function competitorMarketplace(mallName: string, productUrl: string): CompetitorMarketplace {
  const value = `${mallName} ${productUrl}`.toLocaleLowerCase();
  if (/네이버|스마트스토어|smart.?store|naver\.com/.test(value)) return "smartstore";
  if (/쿠팡|coupang/.test(value)) return "coupang";
  if (/11번가|11st/.test(value)) return "elevenst";
  if (/qoo10/.test(value)) return "qoo10";
  if (/shopee/.test(value)) return "shopee";
  if (/lazada/.test(value)) return "lazada";
  if (/ebay/.test(value)) return "ebay";
  if (/temu/.test(value)) return "temu";
  return "other";
}

export async function naverSearchCredentials(serviceClient: SupabaseClient) {
  const environmentClientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim() ?? "";
  const environmentClientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim() ?? "";
  if (environmentClientId && environmentClientSecret) {
    return { clientId: environmentClientId, clientSecret: environmentClientSecret };
  }
  const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "smartstore",
    p_environment: "production",
  });
  const active = data as ActiveCredential | null;
  const secret = active?.secret_payload && typeof active.secret_payload === "object" && !Array.isArray(active.secret_payload)
    ? active.secret_payload as Record<string, unknown>
    : null;
  const clientId = typeof secret?.client_id === "string" ? secret.client_id.trim() : "";
  const clientSecret = typeof secret?.client_secret === "string" ? secret.client_secret.trim() : "";
  return !error && clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function searchNaverShopping(query: string, credentials: { clientId: string; clientSecret: string }, display = 30): Promise<CompetitorPriceCandidate[]> {
  const url = new URL("https://openapi.naver.com/v1/search/shop.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.max(1, Math.min(display, 100))));
  url.searchParams.set("sort", "sim");
  const response = await fetch(url, {
    headers: { "X-Naver-Client-Id": credentials.clientId, "X-Naver-Client-Secret": credentials.clientSecret },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("NAVER_SHOPPING_SEARCH_FAILED");
  const payload = await response.json() as { items?: Array<Record<string, unknown>> };
  return (payload.items ?? []).slice(0, display).map((item) => {
    const itemUrl = String(item.link ?? "").slice(0, 4000);
    const mallName = plainText(item.mallName).slice(0, 240);
    return {
      externalId: String(item.productId ?? itemUrl).slice(0, 500),
      title: plainText(item.title).slice(0, 1000),
      url: itemUrl,
      imageUrl: String(item.image ?? "").slice(0, 4000),
      mallName,
      marketplace: competitorMarketplace(mallName, itemUrl),
      price: Math.max(0, Number(item.lprice ?? 0)),
    };
  }).filter((item) => item.externalId && item.url && item.title && Number.isFinite(item.price));
}

export function groupCompetitorPrices(items: CompetitorPriceCandidate[], limitPerMarketplace = 3) {
  const counts = new Map<CompetitorMarketplace, number>();
  return [...items]
    .sort((left, right) => left.price - right.price)
    .filter((item) => {
      const count = counts.get(item.marketplace) ?? 0;
      if (count >= limitPerMarketplace) return false;
      counts.set(item.marketplace, count + 1);
      return true;
    });
}
