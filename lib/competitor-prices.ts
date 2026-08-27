import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CompetitorMarketplace = "smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other";
export type CompetitorSearchProvider = "naver_shopping" | "elevenst_product_search" | "ebay_browse" | "brave_marketplace_web";

export type CompetitorPriceCandidate = {
  provider: CompetitorSearchProvider;
  externalId: string;
  title: string;
  url: string;
  imageUrl: string;
  mallName: string;
  marketplace: CompetitorMarketplace;
  price: number;
  currency: string;
};

export type CompetitorProviderStatus = {
  provider: CompetitorSearchProvider;
  status: "searched" | "unavailable" | "failed" | "pending";
  count: number;
  marketplaces: CompetitorMarketplace[];
};

type ActiveCredential = { credential_id?: unknown; secret_payload?: unknown };
type CredentialSecret = Record<string, unknown>;
type NaverSearchCredentials = { clientId: string; clientSecret: string };
type ElevenstSearchCredentials = { apiKey: string; credentialId?: string };
type EbayBrowseCredentials = { clientId: string; clientSecret: string; marketplaceId: string; environment: "production" | "sandbox" };
type BraveMarketplaceWebCredentials = { apiKey: string };
export type MarketplaceWebMarketplace = Extract<CompetitorMarketplace, "shopee" | "lazada" | "temu">;
export type CompetitorRefreshContext = { productId: string; claimToken: string };
type SearchProvider = {
  id: CompetitorSearchProvider;
  marketplaces: CompetitorMarketplace[];
  search: (primary: string, aliases: string[], displayPerQuery: number, context?: CompetitorRefreshContext) => Promise<CompetitorPriceCandidate[]>;
};

export type CompetitorProviderRegistry = {
  configured: SearchProvider[];
  unavailable: CompetitorProviderStatus[];
};

export type CompetitorProviderRegistryOptions = {
  searchElevenstViaGateway: (input: {
    serviceClient: SupabaseClient;
    credentialId: string;
    primary: string;
    aliases: string[];
    displayPerQuery: number;
    productId?: string;
    claimToken?: string;
    timeoutMs?: number;
  }) => Promise<CompetitorPriceCandidate[]>;
  elevenstTimeoutMs?: number;
  enableMarketplaceWeb?: boolean;
};

const providerMarketplaces: Record<CompetitorSearchProvider, CompetitorMarketplace[]> = {
  naver_shopping: ["smartstore", "coupang", "elevenst", "qoo10", "other"],
  elevenst_product_search: ["elevenst"],
  ebay_browse: ["ebay"],
  brave_marketplace_web: ["shopee", "lazada", "temu"],
};

const BRAVE_WEB_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_MARKETPLACE_QUERY_LIMIT = 4;
const BRAVE_MARKETPLACE_RESULT_LIMIT = 20;
const BRAVE_MARKETPLACE_TIMEOUT_MS = 7_000;
const marketplaceWebCurrencies = new Set([
  "AUD", "BRL", "CAD", "CLP", "COP", "EUR", "GBP", "IDR", "JPY", "KRW", "MXN", "MYR", "PHP", "SGD", "THB", "TWD", "USD", "VND",
]);

type MarketplaceWebTarget = {
  label: string;
  roots: readonly string[];
  currencyByRoot: Readonly<Record<string, string>>;
};

const marketplaceWebTargets: Record<MarketplaceWebMarketplace, MarketplaceWebTarget> = {
  shopee: {
    label: "Shopee",
    roots: [
      "shopee.sg", "shopee.com.my", "shopee.ph", "shopee.co.th", "shopee.vn", "shopee.co.id",
      "shopee.tw", "shopee.com.br", "shopee.com.mx", "shopee.cl", "shopee.com.co",
    ],
    currencyByRoot: {
      "shopee.sg": "SGD", "shopee.com.my": "MYR", "shopee.ph": "PHP", "shopee.co.th": "THB",
      "shopee.vn": "VND", "shopee.co.id": "IDR", "shopee.tw": "TWD", "shopee.com.br": "BRL",
      "shopee.com.mx": "MXN", "shopee.cl": "CLP", "shopee.com.co": "COP",
    },
  },
  lazada: {
    label: "Lazada",
    roots: ["lazada.sg", "lazada.com.my", "lazada.com.ph", "lazada.co.th", "lazada.vn", "lazada.co.id"],
    currencyByRoot: {
      "lazada.sg": "SGD", "lazada.com.my": "MYR", "lazada.com.ph": "PHP", "lazada.co.th": "THB",
      "lazada.vn": "VND", "lazada.co.id": "IDR",
    },
  },
  temu: {
    label: "Temu",
    roots: ["temu.com"],
    currencyByRoot: {},
  },
};

const marketplaceWebImageRoots: Record<MarketplaceWebMarketplace, readonly string[]> = {
  shopee: ["susercontent.com"],
  lazada: ["alicdn.com", "lazcdn.com", "slatic.net"],
  temu: ["kwcdn.com"],
};

function plainText(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

function validHttpUrl(value: unknown, allowedHostname?: RegExp) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    if (allowedHostname && !allowedHostname.test(url.hostname)) return "";
    url.hash = "";
    return url.toString().slice(0, 4000);
  } catch {
    return "";
  }
}

function normalizedSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function compactSearchText(value: string) {
  return normalizedSearchText(value).replaceAll(" ", "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function officialMarketplaceRoot(hostname: string, marketplace: MarketplaceWebMarketplace) {
  const normalized = hostname.toLocaleLowerCase().replace(/\.$/u, "");
  return marketplaceWebTargets[marketplace].roots.find((root) => normalized === root || normalized.endsWith(`.${root}`)) ?? "";
}

function hostnameMatchesRoot(hostname: string, root: string) {
  return hostname === root || hostname.endsWith(`.${root}`);
}

function isIpLiteral(hostname: string) {
  const candidate = hostname.replace(/^\[|\]$/gu, "");
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(candidate) || candidate.includes(":");
}

export function canonicalMarketplaceWebImageUrl(value: unknown, marketplace: MarketplaceWebMarketplace) {
  const candidate = validHttpUrl(value);
  if (!candidate) return "";
  const url = new URL(candidate);
  const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/u, "");
  if (url.protocol !== "https:" || url.port || isIpLiteral(hostname)) return "";
  const trustedRoots = [
    ...marketplaceWebTargets[marketplace].roots,
    ...marketplaceWebImageRoots[marketplace],
  ];
  if (!trustedRoots.some((root) => hostnameMatchesRoot(hostname, root))) return "";
  return url.toString().slice(0, 4_000);
}

export function canonicalMarketplaceWebProductUrl(value: unknown, marketplace: MarketplaceWebMarketplace) {
  const candidate = validHttpUrl(value);
  if (!candidate) return "";
  const url = new URL(candidate);
  const root = officialMarketplaceRoot(url.hostname, marketplace);
  if (!root || url.protocol !== "https:" || url.port) return "";

  if (marketplace === "shopee") {
    if (!(/-i\.\d+\.\d+(?:$|[/?])/iu.test(url.pathname) || /\/product\/\d+\/\d+(?:$|\/)/iu.test(url.pathname))) return "";
    url.search = "";
  } else if (marketplace === "lazada") {
    if (!/-i\d+(?:-s\d+)?\.html?$/iu.test(url.pathname)) return "";
    url.search = "";
  } else {
    const pathProduct = /-g-\d+\.html?$/iu.test(url.pathname);
    const queryProduct = /\/goods\.html?$/iu.test(url.pathname) && /^\d{6,32}$/u.test(url.searchParams.get("goods_id") ?? "");
    if (!pathProduct && !queryProduct) return "";
    if (queryProduct) {
      const goodsId = url.searchParams.get("goods_id") ?? "";
      url.search = "";
      url.searchParams.set("goods_id", goodsId);
    } else {
      url.search = "";
    }
  }
  url.hash = "";
  return url.toString().slice(0, 4_000);
}

function marketplaceWebExternalId(url: string, marketplace: MarketplaceWebMarketplace) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLocaleLowerCase().replace(/\.$/u, "");
  if (marketplace === "shopee") {
    const productIds = parsed.pathname.match(/-i\.(\d+)\.(\d+)(?:$|\/)/iu)
      ?? parsed.pathname.match(/\/product\/(\d+)\/(\d+)(?:$|\/)/iu);
    if (productIds) return `${hostname}:${productIds[1]}-${productIds[2]}`.slice(0, 500);
  }
  if (marketplace === "lazada") {
    const productId = parsed.pathname.match(/-i(\d+)(?:-s\d+)?\.html?$/iu)?.[1];
    if (productId) return `${hostname}:${productId}`.slice(0, 500);
  }
  if (marketplace === "temu") {
    const productId = parsed.pathname.match(/-g-(\d+)\.html?$/iu)?.[1] ?? parsed.searchParams.get("goods_id");
    if (productId) return `${hostname}:${productId}`.slice(0, 500);
  }
  return `${hostname}:sha256:${createHash("sha256").update(url).digest("hex")}`.slice(0, 500);
}

function structuredRecords(value: unknown, maximum = 500) {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number) => {
    if (records.length >= maximum || depth > 8 || !candidate) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 100)) visit(item, depth + 1);
      return;
    }
    if (!isRecord(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    records.push(candidate);
    for (const item of Object.values(candidate).slice(0, 100)) visit(item, depth + 1);
  };
  visit(value, 0);
  return records;
}

function structuredValue(record: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys.map((key) => key.toLocaleLowerCase()));
  const entry = Object.entries(record).find(([key]) => expected.has(key.toLocaleLowerCase()));
  return entry?.[1];
}

function structuredPriceNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 && value <= 1_000_000_000_000 ? value : null;
  if (typeof value !== "string") return null;
  const text = plainText(value).replace(/[\u00a0\s]/gu, " ").trim();
  if (!text || text.length > 80) return null;
  const matches = text.match(/\d[\d., ]*(?:\d|[.,]\d)/gu) ?? text.match(/\d+/gu) ?? [];
  if (matches.length !== 1) return null;
  let numeric = matches[0].replaceAll(" ", "");
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    numeric = comma > dot ? numeric.replaceAll(".", "").replace(",", ".") : numeric.replaceAll(",", "");
  } else if (comma >= 0) {
    const decimalDigits = numeric.length - comma - 1;
    numeric = decimalDigits > 0 && decimalDigits <= 2 ? numeric.replace(",", ".") : numeric.replaceAll(",", "");
  } else if (dot >= 0) {
    const decimalDigits = numeric.length - dot - 1;
    if (decimalDigits === 3 && /^\d{1,3}(?:\.\d{3})+$/u.test(numeric)) numeric = numeric.replaceAll(".", "");
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000_000_000 ? parsed : null;
}

function structuredCurrency(value: unknown, fallback: string) {
  const text = plainText(value).trim().toUpperCase();
  const explicit = text.match(/(?:^|[^A-Z])([A-Z]{3})(?:$|[^A-Z])/u)?.[1] ?? (/^[A-Z]{3}$/u.test(text) ? text : "");
  if (marketplaceWebCurrencies.has(explicit)) return explicit;
  if (/\bRM\b/u.test(text)) return "MYR";
  if (/S\$/u.test(text)) return "SGD";
  if (/\bRP\b/u.test(text)) return "IDR";
  if (/NT\$/u.test(text)) return "TWD";
  if (/R\$/u.test(text)) return "BRL";
  if (/MX\$/u.test(text)) return "MXN";
  if (/₱/u.test(text)) return "PHP";
  if (/฿/u.test(text)) return "THB";
  if (/₫/u.test(text)) return "VND";
  if (/₩/u.test(text)) return "KRW";
  return marketplaceWebCurrencies.has(fallback) ? fallback : "";
}

export function structuredMarketplaceWebPrice(result: Record<string, unknown>, fallbackCurrency = "") {
  const records = structuredRecords([result.product, result.schemas]);
  const prices: Array<{ price: number; currency: string }> = [];
  for (const record of records) {
    const rawPrice = structuredValue(record, ["price", "lowPrice", "salePrice", "currentPrice"]);
    const price = structuredPriceNumber(rawPrice);
    if (price === null) continue;
    const currency = structuredCurrency(
      structuredValue(record, ["priceCurrency", "currency", "currencyCode"]) ?? rawPrice,
      fallbackCurrency,
    );
    if (!/^[A-Z]{3}$/u.test(currency)) continue;
    prices.push({ price, currency });
  }
  return prices.sort((left, right) => left.price - right.price)[0] ?? null;
}

function meaningfulSearchTokens(value: string) {
  const ignored = new Set(["상품", "제품", "정품", "공식", "new", "item", "product", "official"]);
  return [...new Set(normalizedSearchText(value).split(" ").filter((token) => token.length >= 2 && !ignored.has(token)))];
}

type SearchMeasurement = {
  kind: "mass" | "volume" | "length" | "count" | "ounce" | "pound";
  value: number;
};

const COUNT_UNIT_PATTERN = "개입|세트|pieces?|bottles?|packs?|cans?|pcs?|bags?|개|입|팩|캔|병|봉|매|정|ea";

function measurementTokens(value: string) {
  const compact = compactSearchText(value);
  const multiplicative = value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
  const measurements: SearchMeasurement[] = [];
  const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)(kg|mg|ml|cm|mm|oz|lb|${COUNT_UNIT_PATTERN}|g|l|m)`, "giu");
  for (const match of compact.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = (match[2] ?? "").toLocaleLowerCase();
    if (!Number.isFinite(amount) || amount < 0) continue;
    if (unit === "kg") measurements.push({ kind: "mass", value: amount * 1_000_000 });
    else if (unit === "g") measurements.push({ kind: "mass", value: amount * 1_000 });
    else if (unit === "mg") measurements.push({ kind: "mass", value: amount });
    else if (unit === "l") measurements.push({ kind: "volume", value: amount * 1_000 });
    else if (unit === "ml") measurements.push({ kind: "volume", value: amount });
    else if (unit === "m") measurements.push({ kind: "length", value: amount * 1_000 });
    else if (unit === "cm") measurements.push({ kind: "length", value: amount * 10 });
    else if (unit === "mm") measurements.push({ kind: "length", value: amount });
    else if (unit === "oz") measurements.push({ kind: "ounce", value: amount });
    else if (unit === "lb") measurements.push({ kind: "pound", value: amount });
    else measurements.push({ kind: "count", value: amount });
  }
  for (const match of multiplicative.matchAll(/\d+(?:\.\d+)?(?:kg|mg|g|ml|l|oz|lb)[x×*](\d+(?:\.\d+)?)(?![\p{L}\p{N}])/giu)) {
    const amount = Number(match[1]);
    if (Number.isFinite(amount) && amount >= 0) measurements.push({ kind: "count", value: amount });
  }
  return measurements;
}

function sameMeasurement(left: SearchMeasurement, right: SearchMeasurement) {
  return left.kind === right.kind && Math.abs(left.value - right.value) <= Math.max(0.000_001, Math.abs(left.value) * 0.000_001);
}

function packNeutralSearchQuery(value: string) {
  const countSuffix = new RegExp(`(?:\\s*(?:x|×|\\*)\\s*)?\\d+(?:\\.\\d+)?\\s*(?:${COUNT_UNIT_PATTERN})(?=$|[\\s,;/()])`, "giu");
  const neutral = value.replace(countSuffix, " ").replace(/\s+/g, " ").trim();
  if (neutral === value.trim() || measurementTokens(neutral).every((measurement) => measurement.kind === "count")) return "";
  return neutral;
}

function elevenstRetrievalQueries(primary: string, aliases: string[]) {
  const base = normalizedCompetitorQueries(primary, aliases);
  const neutral = base.map(packNeutralSearchQuery).filter(Boolean);
  return normalizedCompetitorQueries(base[0] ?? primary, [...base.slice(1), ...neutral], 12);
}

function identifierTokens(value: string) {
  return normalizedSearchText(value).match(/(?<!\d)\d{8,14}(?!\d)/gu) ?? [];
}

export function competitorCandidateRelevance(candidate: CompetitorPriceCandidate, queries: string[]) {
  const candidateText = `${candidate.title} ${candidate.mallName}`;
  const normalizedCandidate = normalizedSearchText(candidateText);
  const compactCandidate = compactSearchText(candidateText);
  const candidateMeasurements = measurementTokens(candidate.title);
  const queryMeasurements = queries.map(measurementTokens);
  const primaryMeasurements = queryMeasurements[0] ?? [];
  if (primaryMeasurements.length > 0 && !primaryMeasurements.every((measurement) => (
    candidateMeasurements.some((candidateMeasurement) => sameMeasurement(measurement, candidateMeasurement))
  ))) return 0;
  let best = 0;

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    const identifiers = identifierTokens(query);
    if (identifiers.length && !identifiers.some((identifier) => compactCandidate.includes(identifier))) continue;
    const measurements = queryMeasurements[index] ?? [];
    if (measurements.length && !measurements.every((measurement) => candidateMeasurements.some((candidateMeasurement) => sameMeasurement(measurement, candidateMeasurement)))) continue;
    const tokens = meaningfulSearchTokens(query);
    if (!tokens.length) continue;
    const matched = tokens.filter((token) => normalizedCandidate.includes(token) || compactCandidate.includes(token.replaceAll(" ", "")));
    const required = tokens.length === 1 ? 1 : Math.max(2, Math.ceil(tokens.length * 0.5));
    if (matched.length < required) continue;
    const phraseBonus = compactCandidate.includes(compactSearchText(query)) ? 100 : 0;
    best = Math.max(best, matched.length * 100 + Math.round((matched.length / tokens.length) * 100) + phraseBonus);
  }
  return best;
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

async function activeCredential(serviceClient: SupabaseClient, channel: string): Promise<{ credentialId: string; secret: CredentialSecret } | null> {
  const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: channel,
    p_environment: "production",
  });
  const active = data as ActiveCredential | null;
  if (error || !active?.secret_payload || typeof active.secret_payload !== "object" || Array.isArray(active.secret_payload)) return null;
  return { credentialId: typeof active.credential_id === "string" ? active.credential_id : "", secret: active.secret_payload as CredentialSecret };
}

export async function naverSearchCredentials(serviceClient: SupabaseClient): Promise<NaverSearchCredentials | null> {
  const environmentClientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim() ?? "";
  const environmentClientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim() ?? "";
  if (environmentClientId && environmentClientSecret) return { clientId: environmentClientId, clientSecret: environmentClientSecret };
  const secret = (await activeCredential(serviceClient, "smartstore"))?.secret ?? null;
  const clientId = typeof secret?.naver_search_client_id === "string" ? secret.naver_search_client_id.trim()
    : typeof secret?.search_client_id === "string" ? secret.search_client_id.trim() : "";
  const clientSecret = typeof secret?.naver_search_client_secret === "string" ? secret.naver_search_client_secret.trim()
    : typeof secret?.search_client_secret === "string" ? secret.search_client_secret.trim() : "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function elevenstSearchCredentials(serviceClient: SupabaseClient): Promise<ElevenstSearchCredentials | null> {
  const environmentApiKey = process.env.ELEVENST_OPEN_API_KEY?.trim() ?? "";
  if (/^[A-Za-z0-9]{32}$/.test(environmentApiKey)) return { apiKey: environmentApiKey };
  const active = await activeCredential(serviceClient, "elevenst");
  const apiKey = typeof active?.secret.api_key === "string" ? active.secret.api_key.trim() : "";
  return /^[A-Za-z0-9]{32}$/.test(apiKey) ? { apiKey, credentialId: active?.credentialId || undefined } : null;
}

export async function ebayBrowseCredentials(serviceClient: SupabaseClient): Promise<EbayBrowseCredentials | null> {
  const environmentClientId = process.env.EBAY_BROWSE_CLIENT_ID?.trim() ?? "";
  const environmentClientSecret = process.env.EBAY_BROWSE_CLIENT_SECRET?.trim() ?? "";
  const secret = environmentClientId && environmentClientSecret ? null : (await activeCredential(serviceClient, "ebay"))?.secret ?? null;
  const clientId = environmentClientId || (typeof secret?.client_id === "string" ? secret.client_id.trim() : "");
  const clientSecret = environmentClientSecret || (typeof secret?.client_secret === "string" ? secret.client_secret.trim() : "");
  const marketplaceId = (typeof secret?.marketplace_id === "string" ? secret.marketplace_id.trim().toUpperCase() : "") || "EBAY_US";
  return clientId && clientSecret && /^EBAY_[A-Z]{2,3}$/.test(marketplaceId)
    ? { clientId, clientSecret, marketplaceId, environment: "production" }
    : null;
}

export function braveMarketplaceWebCredentials(): BraveMarketplaceWebCredentials | null {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim() ?? "";
  return /^[A-Za-z0-9_-]{20,500}$/u.test(apiKey) ? { apiKey } : null;
}

export function normalizedCompetitorQueries(primary: string, aliases: string[] = [], maximum = 8) {
  const seen = new Set<string>();
  return [primary, ...aliases]
    .map((value) => value.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 160))
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (value.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(maximum, 12)));
}

export async function searchNaverShopping(query: string, credentials: NaverSearchCredentials, display = 30): Promise<CompetitorPriceCandidate[]> {
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
  return (payload.items ?? []).slice(0, display).flatMap((item) => {
    const itemUrl = validHttpUrl(item.link);
    const imageUrl = validHttpUrl(item.image);
    const mallName = plainText(item.mallName).slice(0, 240);
    const price = Number(item.lprice ?? 0);
    const externalId = String(item.productId ?? itemUrl).trim().slice(0, 500);
    const title = plainText(item.title).slice(0, 1000);
    if (!externalId || !itemUrl || !title || !Number.isFinite(price) || price < 0) return [];
    return [{ provider: "naver_shopping" as const, externalId, title, url: itemUrl, imageUrl, mallName, marketplace: competitorMarketplace(mallName, itemUrl), price, currency: "KRW" }];
  });
}

async function successfulVariantSearches(
  queries: string[],
  search: (query: string) => Promise<CompetitorPriceCandidate[]>,
  failureCode: string,
) {
  const settled = await Promise.allSettled(queries.map(search));
  const fulfilled = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!fulfilled.length && settled.length > 0 && settled.every((result) => result.status === "rejected")) throw new Error(failureCode);
  const unique = new Map<string, CompetitorPriceCandidate>();
  for (const item of fulfilled) {
    const key = `${item.provider}:${item.marketplace}:${item.externalId || item.url}`;
    const current = unique.get(key);
    if (!current || (item.imageUrl && !current.imageUrl) || item.price < current.price) unique.set(key, item);
  }
  return [...unique.values()];
}

export async function searchNaverShoppingVariants(primary: string, aliases: string[], credentials: NaverSearchCredentials, displayPerQuery = 30) {
  const queries = normalizedCompetitorQueries(primary, aliases);
  return successfulVariantSearches(queries, (query) => searchNaverShopping(query, credentials, displayPerQuery), "NAVER_SHOPPING_SEARCH_FAILED");
}

function elevenstXmlNodes(xml: string, tag: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapedTag}>`, "gi"))].map((match) => match[1] ?? "");
}

function elevenstXmlValue(xml: string, tag: string) {
  return plainText((elevenstXmlNodes(xml, tag)[0] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

async function elevenstResponseXml(response: Response) {
  const bytes = await response.arrayBuffer();
  try {
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    return new TextDecoder(contentType.includes("utf-8") ? "utf-8" : "euc-kr").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export async function searchElevenstProducts(query: string, credentials: ElevenstSearchCredentials, display = 30): Promise<CompetitorPriceCandidate[]> {
  const url = new URL("https://openapi.11st.co.kr/openapi/OpenApiService.tmall");
  url.search = new URLSearchParams({ key: credentials.apiKey, apiCode: "ProductSearch", keyword: query, pageNum: "1", pageSize: String(Math.max(1, Math.min(display, 200))), sortCd: "CP", targetSearchPrd: /[A-Za-z]/.test(query) && !/[가-힣]/.test(query) ? "ENG" : "KOR" }).toString();
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.8", "user-agent": "SellerPilot-11st-Competitor-Search/1.0" },
  });
  const xml = await elevenstResponseXml(response);
  const errorCode = elevenstXmlValue(xml, "ErrorCode") || elevenstXmlValue(xml, "ResultCode");
  if (!response.ok || errorCode || /<Errors?(?:\s[^>]*)?>/i.test(xml)) throw new Error("ELEVENST_PRODUCT_SEARCH_FAILED");
  return elevenstXmlNodes(xml, "Product").slice(0, display).flatMap((product) => {
    const externalId = elevenstXmlValue(product, "ProductCode").slice(0, 500);
    const title = elevenstXmlValue(product, "ProductName").slice(0, 1000);
    const price = Number(elevenstXmlValue(product, "SalePrice") || elevenstXmlValue(product, "ProductPrice") || "0");
    const rawDetailUrl = validHttpUrl(elevenstXmlValue(product, "DetailPageUrl"), /(^|\.)11st\.co\.kr$/i);
    const detailUrl = rawDetailUrl
      ? rawDetailUrl.replace(/^http:/i, "https:")
      : (/^\d+$/.test(externalId) ? `https://www.11st.co.kr/products/${externalId}` : "");
    if (!externalId || !title || !detailUrl || !Number.isFinite(price) || price < 0) return [];
    return [{ provider: "elevenst_product_search" as const, externalId, title, url: detailUrl, imageUrl: validHttpUrl(elevenstXmlValue(product, "ProductImage")), mallName: elevenstXmlValue(product, "Seller").slice(0, 240) || "11번가", marketplace: "elevenst" as const, price, currency: "KRW" }];
  });
}

export async function searchElevenstProductVariants(primary: string, aliases: string[], credentials: ElevenstSearchCredentials, displayPerQuery = 30) {
  const queries = elevenstRetrievalQueries(primary, aliases);
  return successfulVariantSearches(queries, (query) => searchElevenstProducts(query, credentials, displayPerQuery), "ELEVENST_PRODUCT_SEARCH_FAILED");
}

const ebayApplicationTokens = new Map<string, { accessToken: string; expiresAt: number }>();

async function ebayApplicationAccessToken(credentials: EbayBrowseCredentials) {
  const cacheKey = `${credentials.environment}:${createHash("sha256").update(credentials.clientId).digest("hex")}`;
  const cached = ebayApplicationTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  const apiHost = credentials.environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const scope = "https://api.ebay.com/oauth/api_scope";
  const response = await fetch(`${apiHost}/identity/v1/oauth2/token`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "SellerPilot-eBay-Browse-Connector/1.0" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!response.ok || !accessToken) throw new Error("EBAY_APPLICATION_TOKEN_FAILED");
  const expiresIn = Number(payload.expires_in ?? 7_200);
  ebayApplicationTokens.set(cacheKey, { accessToken, expiresAt: Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 7_200) * 1_000 });
  return accessToken;
}

export async function searchEbayBrowse(query: string, credentials: EbayBrowseCredentials, accessToken: string, display = 30): Promise<CompetitorPriceCandidate[]> {
  const apiHost = credentials.environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const url = new URL(`${apiHost}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.max(1, Math.min(display, 200))));
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${accessToken}`, "x-ebay-c-marketplace-id": credentials.marketplaceId, "user-agent": "SellerPilot-eBay-Browse-Connector/1.0" },
  });
  if (!response.ok) throw new Error("EBAY_BROWSE_SEARCH_FAILED");
  const payload = await response.json() as { itemSummaries?: Array<Record<string, unknown>> };
  return (payload.itemSummaries ?? []).slice(0, display).flatMap((item) => {
    const priceRecord = item.price && typeof item.price === "object" && !Array.isArray(item.price) ? item.price as Record<string, unknown> : {};
    const imageRecord = item.image && typeof item.image === "object" && !Array.isArray(item.image) ? item.image as Record<string, unknown> : {};
    const sellerRecord = item.seller && typeof item.seller === "object" && !Array.isArray(item.seller) ? item.seller as Record<string, unknown> : {};
    const externalId = String(item.itemId ?? "").trim().slice(0, 500);
    const title = plainText(item.title).slice(0, 1000);
    const itemUrl = validHttpUrl(item.itemWebUrl, /(^|\.)ebay\.[a-z.]+$/i);
    const price = Number(priceRecord.value ?? 0);
    const currency = String(priceRecord.currency ?? "USD").trim().toUpperCase().slice(0, 3);
    if (!externalId || !title || !itemUrl || !Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(currency)) return [];
    return [{ provider: "ebay_browse" as const, externalId, title, url: itemUrl, imageUrl: validHttpUrl(imageRecord.imageUrl), mallName: plainText(sellerRecord.username).slice(0, 240) || "eBay", marketplace: "ebay" as const, price, currency }];
  });
}

export async function searchEbayBrowseVariants(primary: string, aliases: string[], credentials: EbayBrowseCredentials, displayPerQuery = 30) {
  const queries = normalizedCompetitorQueries(primary, aliases);
  const accessToken = await ebayApplicationAccessToken(credentials);
  return successfulVariantSearches(queries, (query) => searchEbayBrowse(query, credentials, accessToken, displayPerQuery), "EBAY_BROWSE_SEARCH_FAILED");
}

export function braveMarketplaceSearchQuery(query: string, marketplace: MarketplaceWebMarketplace) {
  // Brave documents multiple-domain filters as an unparenthesized uppercase
  // OR chain. Product relevance and the canonical URL fence are still applied
  // after search, so no result is trusted merely because the query matched.
  const siteFilter = marketplaceWebTargets[marketplace].roots.map((root) => `site:${root}`).join(" OR ");
  const siteWords = siteFilter.split(/\s+/u).length;
  const maximumProductWords = Math.max(2, 50 - siteWords);
  const maximumProductCharacters = Math.max(2, 400 - siteFilter.length - 1);
  const productQuery = (normalizedCompetitorQueries(query, [], 1)[0] ?? "")
    .split(/\s+/u)
    .slice(0, maximumProductWords)
    .join(" ")
    .slice(0, maximumProductCharacters)
    .trim();
  if (productQuery.length < 2) throw new Error("BRAVE_MARKETPLACE_QUERY_INVALID");
  return `${productQuery} ${siteFilter}`;
}

function braveSearchLanguage(query: string) {
  if (/\p{Script=Hangul}/u.test(query)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return "ja";
  if (/\p{Script=Thai}/u.test(query)) return "th";
  if (/\p{Script=Han}/u.test(query)) return "zh";
  if (/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(query)) return "vi";
  return "en";
}

function marketplaceQueryLanguageFamily(query: string) {
  if (/\p{Script=Hangul}/u.test(query)) return "hangul";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return "kana";
  if (/\p{Script=Thai}/u.test(query)) return "thai";
  if (/\p{Script=Han}/u.test(query)) return "han";
  if (braveSearchLanguage(query) === "vi") return "vietnamese";
  if (/\p{Script=Latin}/u.test(query)) return "latin";
  return "other";
}

function diverseMarketplaceQueries(primary: string, aliases: string[]) {
  const available = normalizedCompetitorQueries(primary, aliases, 12);
  if (available.length <= BRAVE_MARKETPLACE_QUERY_LIMIT) return available;
  const selected = [available[0]];
  const selectedValues = new Set(selected);
  const primaryFamily = marketplaceQueryLanguageFamily(available[0]);
  const familyOrder = ["latin", "thai", "vietnamese", "han", "hangul", "kana", "other"]
    .filter((family) => family !== primaryFamily);
  for (const family of familyOrder) {
    const candidate = available.slice(1).find((query) => marketplaceQueryLanguageFamily(query) === family);
    if (!candidate || selectedValues.has(candidate)) continue;
    selected.push(candidate);
    selectedValues.add(candidate);
    if (selected.length >= BRAVE_MARKETPLACE_QUERY_LIMIT) return selected;
  }
  for (const candidate of available.slice(1)) {
    if (selectedValues.has(candidate)) continue;
    selected.push(candidate);
    selectedValues.add(candidate);
    if (selected.length >= BRAVE_MARKETPLACE_QUERY_LIMIT) break;
  }
  return selected;
}

export async function searchBraveMarketplaceWeb(
  query: string,
  credentials: BraveMarketplaceWebCredentials,
  marketplace: MarketplaceWebMarketplace,
  display = BRAVE_MARKETPLACE_RESULT_LIMIT,
): Promise<CompetitorPriceCandidate[]> {
  const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
  url.searchParams.set("q", braveMarketplaceSearchQuery(query, marketplace));
  url.searchParams.set("country", "ALL");
  url.searchParams.set("search_lang", braveSearchLanguage(query));
  url.searchParams.set("count", String(Math.max(1, Math.min(display, BRAVE_MARKETPLACE_RESULT_LIMIT))));
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("spellcheck", "false");
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("result_filter", "web");
  url.searchParams.set("operators", "true");
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(BRAVE_MARKETPLACE_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "x-subscription-token": credentials.apiKey,
      "user-agent": "SellerPilot-Competitor-Web-Search/1.0",
    },
  });
  if (!response.ok) throw new Error("BRAVE_MARKETPLACE_SEARCH_FAILED");
  const payload = await response.json() as Record<string, unknown>;
  const web = isRecord(payload.web) ? payload.web : {};
  const results = Array.isArray(web.results) ? web.results.slice(0, Math.min(display, BRAVE_MARKETPLACE_RESULT_LIMIT)) : [];
  return results.flatMap((rawResult) => {
    if (!isRecord(rawResult)) return [];
    const itemUrl = canonicalMarketplaceWebProductUrl(rawResult.url, marketplace);
    if (!itemUrl) return [];
    const parsedUrl = new URL(itemUrl);
    const root = officialMarketplaceRoot(parsedUrl.hostname, marketplace);
    const price = structuredMarketplaceWebPrice(rawResult, marketplaceWebTargets[marketplace].currencyByRoot[root] ?? "");
    const title = plainText(rawResult.title).slice(0, 1_000);
    if (!title || !price) return [];
    const thumbnail = isRecord(rawResult.thumbnail) ? rawResult.thumbnail : {};
    const candidate = {
      provider: "brave_marketplace_web" as const,
      externalId: marketplaceWebExternalId(itemUrl, marketplace).slice(0, 500),
      title,
      url: itemUrl,
      imageUrl: canonicalMarketplaceWebImageUrl(thumbnail.original ?? thumbnail.src, marketplace),
      mallName: `${marketplaceWebTargets[marketplace].label} · ${root}`.slice(0, 240),
      marketplace,
      price: price.price,
      currency: price.currency,
    } satisfies CompetitorPriceCandidate;
    return competitorCandidateRelevance(candidate, [query]) > 0 ? [candidate] : [];
  });
}

export async function searchBraveMarketplaceWebVariants(
  primary: string,
  aliases: string[],
  credentials: BraveMarketplaceWebCredentials,
  displayPerQuery = BRAVE_MARKETPLACE_RESULT_LIMIT,
) {
  const queries = diverseMarketplaceQueries(primary, aliases);
  const settled = await Promise.allSettled((["shopee", "lazada", "temu"] as const).map(async (marketplace) => {
    const candidates: CompetitorPriceCandidate[] = [];
    let successfulQueries = 0;
    for (const query of queries) {
      try {
        candidates.push(...await searchBraveMarketplaceWeb(query, credentials, marketplace, displayPerQuery));
        successfulQueries += 1;
      } catch {
        continue;
      }
      const uniqueProducts = new Set(candidates.map((candidate) => marketplaceIdentity(candidate)));
      if (uniqueProducts.size >= 3) break;
    }
    if (successfulQueries === 0) throw new Error("BRAVE_MARKETPLACE_SEARCH_FAILED");
    return candidates;
  }));
  if (settled.length > 0 && settled.every((result) => result.status === "rejected")) throw new Error("BRAVE_MARKETPLACE_SEARCH_FAILED");
  const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const relevant = candidates.filter((candidate) => competitorCandidateRelevance(candidate, queries) > 0);
  const unique = new Map<string, CompetitorPriceCandidate>();
  for (const candidate of relevant) {
    const key = marketplaceIdentity(candidate);
    const current = unique.get(key);
    if (!current || (candidate.imageUrl && !current.imageUrl) || candidate.price < current.price) unique.set(key, candidate);
  }
  return groupCompetitorPrices([...unique.values()], 3);
}

export async function competitorProviderRegistry(
  serviceClient: SupabaseClient,
  options: CompetitorProviderRegistryOptions,
): Promise<CompetitorProviderRegistry> {
  const [naver, elevenst, ebay] = await Promise.all([naverSearchCredentials(serviceClient), elevenstSearchCredentials(serviceClient), ebayBrowseCredentials(serviceClient)]);
  const marketplaceWeb = options.enableMarketplaceWeb ? braveMarketplaceWebCredentials() : null;
  const configured: SearchProvider[] = [];
  const unavailable: CompetitorProviderStatus[] = [];
  if (naver) configured.push({ id: "naver_shopping", marketplaces: providerMarketplaces.naver_shopping, search: (primary, aliases, display) => searchNaverShoppingVariants(primary, aliases, naver, display) });
  else unavailable.push({ provider: "naver_shopping", status: "unavailable", count: 0, marketplaces: providerMarketplaces.naver_shopping });
  if (elevenst) configured.push({
    id: "elevenst_product_search",
    marketplaces: providerMarketplaces.elevenst_product_search,
    search: (primary, aliases, display, context) => elevenst.credentialId
      ? options.searchElevenstViaGateway({
          serviceClient,
          credentialId: elevenst.credentialId,
          primary,
          aliases,
          displayPerQuery: display,
          productId: context?.productId,
          claimToken: context?.claimToken,
          timeoutMs: options.elevenstTimeoutMs,
        })
      : searchElevenstProductVariants(primary, aliases, elevenst, display),
  });
  else unavailable.push({ provider: "elevenst_product_search", status: "unavailable", count: 0, marketplaces: providerMarketplaces.elevenst_product_search });
  if (ebay) configured.push({ id: "ebay_browse", marketplaces: providerMarketplaces.ebay_browse, search: (primary, aliases, display) => searchEbayBrowseVariants(primary, aliases, ebay, display) });
  else unavailable.push({ provider: "ebay_browse", status: "unavailable", count: 0, marketplaces: providerMarketplaces.ebay_browse });
  if (options.enableMarketplaceWeb) {
    if (marketplaceWeb) configured.push({
      id: "brave_marketplace_web",
      marketplaces: providerMarketplaces.brave_marketplace_web,
      search: (primary, aliases, display) => searchBraveMarketplaceWebVariants(primary, aliases, marketplaceWeb, display),
    });
    else unavailable.push({ provider: "brave_marketplace_web", status: "unavailable", count: 0, marketplaces: providerMarketplaces.brave_marketplace_web });
  }
  return { configured, unavailable };
}

function marketplaceIdentity(item: CompetitorPriceCandidate) {
  try {
    const url = new URL(item.url);
    if (item.marketplace === "elevenst") {
      const productNo = url.pathname.match(/\/products\/(\d+)/)?.[1] ?? url.searchParams.get("prdNo");
      if (productNo) return `elevenst:${productNo}`;
    }
    if (item.marketplace === "ebay") {
      const itemNo = url.pathname.match(/\/itm\/(?:[^/]+\/)?([^/?]+)/)?.[1];
      if (itemNo) return `ebay:${itemNo}`;
    }
    if (item.marketplace === "shopee") {
      const itemNo = url.pathname.match(/-i\.\d+\.(\d+)(?:$|\/)/iu)?.[1]
        ?? url.pathname.match(/\/product\/\d+\/(\d+)(?:$|\/)/iu)?.[1];
      if (itemNo) return `shopee:${url.hostname.toLocaleLowerCase()}:${itemNo}`;
    }
    if (item.marketplace === "lazada") {
      const itemNo = url.pathname.match(/-i(\d+)(?:-s\d+)?\.html?$/iu)?.[1];
      if (itemNo) return `lazada:${url.hostname.toLocaleLowerCase()}:${itemNo}`;
    }
    if (item.marketplace === "temu") {
      const itemNo = url.pathname.match(/-g-(\d+)\.html?$/iu)?.[1] ?? url.searchParams.get("goods_id");
      if (itemNo) return `temu:${url.hostname.toLocaleLowerCase()}:${itemNo}`;
    }
    url.search = "";
    return `${item.marketplace}:${url.hostname}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return `${item.marketplace}:${item.externalId}`;
  }
}

async function withProviderTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("COMPETITOR_PROVIDER_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function searchCompetitorProviders(
  registry: CompetitorProviderRegistry,
  primary: string,
  aliases: string[],
  displayPerQuery = 30,
  providerTimeoutMs = 0,
  context?: CompetitorRefreshContext,
) {
  const queries = normalizedCompetitorQueries(primary, aliases);
  const effectivePrimary = queries[0] ?? primary.replace(/\p{Cc}/gu, " ").trim().slice(0, 160);
  const effectiveAliases = queries.slice(1);
  const settled = await Promise.allSettled(registry.configured.map(async (provider) => {
    const items = await withProviderTimeout(provider.search(effectivePrimary, effectiveAliases, displayPerQuery, context), providerTimeoutMs);
    const ranked = items
      .map((item) => ({ item, score: competitorCandidateRelevance(item, queries) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.item.price - right.item.price)
      .map(({ item }) => item);
    return { provider, items: ranked };
  }));
  const providers: CompetitorProviderStatus[] = [...registry.unavailable];
  const candidates: CompetitorPriceCandidate[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const provider = registry.configured[index];
    if (result.status === "fulfilled") {
      providers.push({ provider: provider.id, status: "searched", count: result.value.items.length, marketplaces: provider.marketplaces });
      candidates.push(...result.value.items);
    } else {
      const pending = result.reason instanceof Error && (
        result.reason.name === "ChannelGatewayInProgressError"
        || result.reason.message === "COMPETITOR_PROVIDER_TIMEOUT"
      );
      providers.push({ provider: provider.id, status: pending ? "pending" : "failed", count: 0, marketplaces: provider.marketplaces });
    }
  }
  const unique = new Map<string, CompetitorPriceCandidate>();
  for (const item of candidates) {
    const key = marketplaceIdentity(item);
    const current = unique.get(key);
    if (!current || (item.imageUrl && !current.imageUrl) || item.price < current.price) unique.set(key, item);
  }
  const order = Object.keys(providerMarketplaces);
  return {
    items: groupCompetitorPrices([...unique.values()]),
    providers: providers.sort((left, right) => order.indexOf(left.provider) - order.indexOf(right.provider)),
    available: providers.some((provider) => provider.status === "searched"),
    pending: providers.some((provider) => provider.status === "pending"),
    configured: registry.configured.length > 0,
  };
}

export function groupCompetitorPrices(items: CompetitorPriceCandidate[], limitPerMarketplace = 3) {
  const counts = new Map<CompetitorMarketplace, number>();
  return [...items]
    .sort((left, right) => left.marketplace.localeCompare(right.marketplace) || left.currency.localeCompare(right.currency) || left.price - right.price)
    .filter((item) => {
      const count = counts.get(item.marketplace) ?? 0;
      if (count >= limitPerMarketplace) return false;
      counts.set(item.marketplace, count + 1);
      return true;
    });
}
