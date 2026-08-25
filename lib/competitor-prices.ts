import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CompetitorMarketplace = "smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other";
export type CompetitorSearchProvider = "naver_shopping" | "elevenst_product_search" | "ebay_browse";

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
};

const providerMarketplaces: Record<CompetitorSearchProvider, CompetitorMarketplace[]> = {
  naver_shopping: ["smartstore", "coupang", "elevenst", "qoo10", "other"],
  elevenst_product_search: ["elevenst"],
  ebay_browse: ["ebay"],
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
  let best = 0;

  for (const query of queries) {
    const identifiers = identifierTokens(query);
    if (identifiers.length && !identifiers.some((identifier) => compactCandidate.includes(identifier))) continue;
    const measurements = measurementTokens(query);
    const candidateMeasurements = measurementTokens(candidate.title);
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

export async function competitorProviderRegistry(
  serviceClient: SupabaseClient,
  options: CompetitorProviderRegistryOptions,
): Promise<CompetitorProviderRegistry> {
  const [naver, elevenst, ebay] = await Promise.all([naverSearchCredentials(serviceClient), elevenstSearchCredentials(serviceClient), ebayBrowseCredentials(serviceClient)]);
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
