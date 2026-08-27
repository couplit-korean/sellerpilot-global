import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CompetitorMarketplace = "smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other";
export type CompetitorSearchProvider = "naver_shopping" | "elevenst_product_search" | "ebay_browse" | "brave_marketplace_web";

export const COMPETITOR_MATCHER_VERSION = "strict-2026-08-28-v2" as const;

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

const ignoredSearchTokens = new Set([
  "상품", "제품", "정품", "공식", "신품", "무료배송", "item", "product", "official", "genuine", "authentic", "original", "new",
  "total", "net", "weight", "contents", "content", "netto", "peso", "conteúdo", "contenido",
  "for", "with", "and", "the", "by", "para", "con", "com", "dengan", "untuk", "dan", "cho", "với", "của",
  "商品", "製品", "正規品", "公式", "新品", "产品", "產品", "正品", "官方", "สินค้า", "ของแท้",
  "produk", "barang", "sản", "phẩm", "chính", "hãng", "producto", "produto", "oficial",
]);

const measurementTokenSuffix = /\d(?:kg|mg|g|ml|l|cm|mm|m|oz|lb|개|입|팩|캔|병|봉|매|정|세트|pack|packs|pcs|pieces|bottles|cans|bags)$/iu;

type SearchMeasurement = {
  kind: "mass" | "volume" | "length" | "count";
  value: number;
  system: "metric" | "imperial" | "count";
};

type MeasurementUnitDefinition = Omit<SearchMeasurement, "value"> & { units: readonly string[]; factor: number };

const measurementUnitDefinitions: readonly MeasurementUnitDefinition[] = [
  { kind: "mass", system: "metric", factor: 1_000_000, units: ["kg", "kilogram", "kilograms", "킬로그램", "キログラム", "公斤", "千克", "กิโลกรัม"] },
  { kind: "mass", system: "metric", factor: 1_000, units: ["g", "gram", "grams", "그램", "グラム", "克", "กรัม"] },
  { kind: "mass", system: "metric", factor: 1, units: ["mg", "milligram", "milligrams", "밀리그램", "ミリグラム", "毫克", "มิลลิกรัม"] },
  { kind: "mass", system: "imperial", factor: 28_349.523_125, units: ["oz", "ounce", "ounces", "オンス", "盎司"] },
  { kind: "mass", system: "imperial", factor: 453_592.37, units: ["lb", "lbs", "pound", "pounds", "ポンド", "磅"] },
  { kind: "volume", system: "metric", factor: 1_000, units: ["l", "liter", "liters", "litre", "litres", "리터", "リットル", "公升", "升", "ลิตร"] },
  { kind: "volume", system: "metric", factor: 1, units: ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "밀리리터", "ミリリットル", "毫升", "มล", "มิลลิลิตร"] },
  { kind: "volume", system: "imperial", factor: 29.573_529_562_5, units: ["floz"] },
  { kind: "length", system: "metric", factor: 1_000, units: ["m", "meter", "meters", "metre", "metres", "미터", "メートル", "米", "เมตร"] },
  { kind: "length", system: "metric", factor: 10, units: ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "센티미터", "センチメートル", "厘米", "เซนติเมตร"] },
  { kind: "length", system: "metric", factor: 1, units: ["mm", "millimeter", "millimeters", "millimetre", "millimetres", "밀리미터", "ミリメートル", "毫米", "มิลลิเมตร"] },
];

const countUnits = [
  "개입", "세트", "묶음", "박스", "상자", "개", "입", "팩", "캔", "병", "봉", "매", "정",
  "units", "unit", "pieces", "piece", "bottles", "bottle", "packs", "pack", "cans", "can", "pcs", "pc", "bags", "bag", "boxes", "box", "sets", "set", "tablets", "tablet", "capsules", "capsule", "servings", "serving", "ea",
  "セット", "パック", "個", "本", "袋", "缶", "枚", "錠", "箱", "个", "個", "件", "包", "瓶", "罐", "盒", "支", "片", "套", "组", "組",
  "ชิ้น", "ขวด", "แพ็ค", "กระป๋อง", "ถุง", "กล่อง", "ชุด", "เม็ด",
  "cái", "hộp", "gói", "chai", "lon", "túi", "bộ", "viên", "combo",
  "pek", "pak", "paket", "botol", "tin", "kaleng", "kotak", "bungkus", "kapsul",
  "unidades", "unidad", "piezas", "pieza", "botellas", "botella", "paquetes", "paquete", "latas", "lata", "bolsas", "bolsa", "cajas", "caja",
  "unidade", "peças", "peça", "garrafas", "garrafa", "pacotes", "pacote", "sacos", "saco", "caixas", "caixa",
] as const;

const normalizedCountUnitTokens = new Set(countUnits.map((unit) => normalizedSearchText(unit)));
const storageUnits = ["kb", "mb", "gb", "tb", "kib", "mib", "gib", "tib"] as const;
const normalizedStorageUnitTokens = new Set<string>(storageUnits);
const STORAGE_UNIT_PATTERN = storageUnits.join("|");
const storageTokenSuffix = new RegExp(`^\\d+(?:[.,]\\d+)?(?:${STORAGE_UNIT_PATTERN})$`, "iu");

function meaningfulSearchTokens(value: string) {
  return [...new Set(normalizedSearchText(value).split(" ").filter((token) => (
    token.length >= 2
    && !ignoredSearchTokens.has(token)
    && !normalizedCountUnitTokens.has(token)
    && !normalizedMeasurementUnitTokens.has(token)
    && !normalizedStorageUnitTokens.has(token)
    && !/^\d+(?:[.,]\d+)?$/u.test(token)
    && !/^\d{1,3}\+\d{1,3}$/u.test(token)
    && !/^[x×*]\d{1,4}$/iu.test(token)
    && !measurementTokenSuffix.test(token)
    && !storageTokenSuffix.test(token)
  )))];
}

function regexAlternatives(values: readonly string[]) {
  return [...values]
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
}

const measurementUnits = measurementUnitDefinitions.flatMap((definition) => definition.units);
const measurementUnitPattern = regexAlternatives(measurementUnits);
const packMeasurementUnitPattern = regexAlternatives(measurementUnitDefinitions.filter((definition) => definition.kind === "mass" || definition.kind === "volume").flatMap((definition) => definition.units));
const COUNT_UNIT_PATTERN = regexAlternatives(countUnits);
const measurementUnitByName = new Map(measurementUnitDefinitions.flatMap((definition) => definition.units.map((unit) => [unit, definition] as const)));
const normalizedMeasurementUnitTokens = new Set(measurementUnits.map((unit) => normalizedSearchText(unit)));

function localizedNumber(value: string, definition: MeasurementUnitDefinition) {
  let numeric = value.replace(/\s+/gu, "");
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) numeric = comma > dot ? numeric.replaceAll(".", "").replace(",", ".") : numeric.replaceAll(",", "");
  else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const separatorIndex = Math.max(comma, dot);
    const integerPart = numeric.slice(0, separatorIndex);
    const fractionPart = numeric.slice(separatorIndex + 1);
    const prefersThreeDigitFraction = definition.kind === "mass" ? definition.factor > 1_000
      : definition.kind === "volume" ? definition.factor > 1
        : definition.kind === "length" ? definition.factor > 10
          : false;
    if (fractionPart.length === 3 && integerPart !== "0" && !prefersThreeDigitFraction) numeric = numeric.replaceAll(separator, "");
    else if (fractionPart.length <= 3) numeric = separator === "," ? numeric.replace(",", ".") : numeric;
    else numeric = numeric.replaceAll(separator, "");
  }
  const parsed = Number(numeric);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sameMeasurement(left: SearchMeasurement, right: SearchMeasurement) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "count") return Number.isInteger(left.value) && left.value === right.value;
  const tolerance = left.system === right.system ? 0.000_001 : 0.02;
  return Math.abs(left.value - right.value) <= Math.max(0.000_001, Math.abs(left.value) * tolerance);
}

function uniqueMeasurements(measurements: SearchMeasurement[]) {
  const unique: SearchMeasurement[] = [];
  for (const measurement of measurements) {
    if (!unique.some((candidate) => sameMeasurement(measurement, candidate))) unique.push(measurement);
  }
  return unique;
}

function measurementTokens(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase()
    .replace(/fl\.?\s*oz/giu, "floz")
    .replace(/fluid\s+ounces?/giu, "floz");
  const measurements: SearchMeasurement[] = [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(\\d[\\d.,]*)\\s*(${measurementUnitPattern})(?=$|[^\\p{L}\\p{N}]|[x×*]\\s*\\d|\\d+\\s*(?:${COUNT_UNIT_PATTERN}))`, "giu");
  for (const match of normalized.matchAll(pattern)) {
    const unit = (match[2] ?? "").toLocaleLowerCase();
    const definition = measurementUnitByName.get(unit);
    if (!definition) continue;
    const amount = localizedNumber(match[1] ?? "", definition);
    if (amount === null) continue;
    measurements.push({ kind: definition.kind, system: definition.system, value: amount * definition.factor });
  }

  const countPattern = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,4})\\s*(?:${COUNT_UNIT_PATTERN})(?![\\p{L}\\p{N}])`, "giu");
  for (const match of normalized.matchAll(countPattern)) {
    const count = Number(match[1]);
    if (Number.isInteger(count) && count > 0) measurements.push({ kind: "count", system: "count", value: count });
  }

  const trailingBareCountPattern = new RegExp(`(?:\\d[\\d.,]*)\\s*(?:${packMeasurementUnitPattern})\\s*[x×*]\\s*(\\d{1,4})(?!\\d)(?!\\s*(?:${measurementUnitPattern}))`, "giu");
  const trailingExplicitCountPattern = new RegExp(`(?:\\d[\\d.,]*)\\s*(?:${measurementUnitPattern})\\s*(\\d{1,4})\\s*(?:${COUNT_UNIT_PATTERN})`, "giu");
  for (const match of [...normalized.matchAll(trailingBareCountPattern), ...normalized.matchAll(trailingExplicitCountPattern)]) {
    const count = Number(match[1]);
    if (Number.isInteger(count) && count > 0) measurements.push({ kind: "count", system: "count", value: count });
  }

  const leadingCountPattern = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,4})\\s*[x×*]\\s*\\d[\\d.,]*\\s*(?:${packMeasurementUnitPattern})`, "giu");
  for (const match of normalized.matchAll(leadingCountPattern)) {
    const count = Number(match[1]);
    if (Number.isInteger(count) && count > 0) measurements.push({ kind: "count", system: "count", value: count });
  }

  for (const match of normalized.matchAll(/(?<!\d)(\d{1,3})\s*\+\s*(\d{1,3})(?!\d)/gu)) {
    const count = Number(match[1]) + Number(match[2]);
    if (Number.isInteger(count) && count > 1) measurements.push({ kind: "count", system: "count", value: count });
  }
  for (const match of normalized.matchAll(/\b(?:set|pack|lot)\s+of\s+(\d{1,4})\b/giu)) {
    const count = Number(match[1]);
    if (Number.isInteger(count) && count > 0) measurements.push({ kind: "count", system: "count", value: count });
  }
  return uniqueMeasurements(measurements);
}

function measurementRequirements(queries: string[]) {
  const profiles = queries.map(measurementTokens);
  const required = [...(profiles[0] ?? [])];
  for (const kind of ["mass", "volume", "length", "count"] as const) {
    if (required.some((measurement) => measurement.kind === kind)) continue;
    const groups: Array<{ measurement: SearchMeasurement; queryIndexes: Set<number> }> = [];
    profiles.slice(1).forEach((profile, offset) => {
      for (const measurement of profile.filter((candidate) => candidate.kind === kind)) {
        const group = groups.find((candidate) => sameMeasurement(candidate.measurement, measurement));
        if (group) group.queryIndexes.add(offset + 1);
        else groups.push({ measurement, queryIndexes: new Set([offset + 1]) });
      }
    });
    const consensus = groups.sort((left, right) => right.queryIndexes.size - left.queryIndexes.size)[0];
    if (consensus && consensus.queryIndexes.size >= 2) required.push(consensus.measurement);
  }
  return uniqueMeasurements(required);
}

function measurementsMatchRequirements(requirements: SearchMeasurement[], candidates: SearchMeasurement[]) {
  const requiredCounts = requirements.filter((measurement) => measurement.kind === "count");
  const candidateCounts = candidates.filter((measurement) => measurement.kind === "count");
  if (!requirements.every((required) => (
    required.kind === "count" && required.value === 1 && candidateCounts.length === 0
      ? true
      : candidates.some((candidate) => sameMeasurement(required, candidate))
  ))) return false;
  if (!requiredCounts.length && candidateCounts.some((measurement) => measurement.value > 1)) return false;
  if (requiredCounts.length && candidateCounts.some((measurement) => measurement.value > 1 && !requiredCounts.some((required) => sameMeasurement(required, measurement)))) return false;

  const packCount = requiredCounts[0]?.value ?? 1;
  for (const kind of ["mass", "volume", "length"] as const) {
    const required = requirements.filter((measurement) => measurement.kind === kind);
    if (required.length !== 1) continue;
    const compatibleTotals = packCount > 1 ? [{ ...required[0], value: required[0].value * packCount }] : [];
    const conflicting = candidates.filter((measurement) => measurement.kind === kind).some((measurement) => (
      !required.some((candidate) => sameMeasurement(candidate, measurement))
      && !compatibleTotals.some((candidate) => sameMeasurement(candidate, measurement))
    ));
    if (conflicting) return false;
  }
  return true;
}

function measurementMatchesCandidate(required: SearchMeasurement, candidates: SearchMeasurement[]) {
  return required.kind === "count" && required.value === 1 && !candidates.some((candidate) => candidate.kind === "count")
    ? true
    : candidates.some((candidate) => sameMeasurement(required, candidate));
}

const accessoryTerms = {
  protective_case: ["case", "cases", "cover", "covers", "sleeve", "pouch", "케이스", "커버", "파우치", "ケース", "カバー", "保护壳", "保護殼", "外壳", "外殼", "เคส", "ฝาครอบ", "ốp lưng", "bao da", "funda", "cubierta", "capa", "estojo"],
  replacement: ["replacement", "replacement part", "spare part", "compatible", "호환", "교체용", "부품", "交換用", "互換", "替换", "替換", "兼容", "อะไหล่", "ใช้ร่วมกับ", "thay thế", "tương thích", "pengganti", "kompatibel", "repuesto", "compatível", "compatível"],
  accessory: ["accessory", "accessories", "adapter", "charger", "charging cable", "strap", "holder", "stand", "액세서리", "어댑터", "충전기", "케이블", "스트랩", "거치대", "アクセサリー", "アダプター", "充電器", "ケーブル", "ストラップ", "配件", "轉接器", "充電器", "数据线", "支架", "อุปกรณ์เสริม", "ที่ชาร์จ", "สายชาร์จ", "ขาตั้ง", "phụ kiện", "bộ sạc", "cáp sạc", "giá đỡ", "aksesori", "adaptor", "pengecas", "kabel", "dudukan", "accesorio", "adaptador", "cargador", "soporte", "acessório", "carregador", "suporte"],
  refill_sample: ["refill", "sample", "tester", "empty bottle", "리필", "샘플", "테스터", "빈용기", "詰め替え", "リフィル", "サンプル", "补充装", "補充裝", "小样", "小樣", "รีฟิล", "ตัวอย่าง", "isi ulang", "sampel", "recarga", "muestra", "refil", "amostra"],
  collectible_card: [
    "tcg", "trading card", "promo card", "promotional card", "collectible card", "pokemon card", "photo card", "photocard", "card single",
    "트레이딩 카드", "프로모 카드", "프로모션 카드", "수집 카드", "포켓몬 카드", "포토 카드", "포토카드",
    "トレカ", "トレーディングカード", "プロモカード", "コレクションカード", "ポケモンカード", "フォトカード",
    "交易卡", "促销卡", "促銷卡", "收藏卡", "宝可梦卡", "寶可夢卡", "小卡",
    "การ์ดสะสม", "โปเกมอนการ์ด", "thẻ sưu tập", "kartu koleksi", "kartu pokemon",
    "tarjeta coleccionable", "carta promocional", "cartão colecionável", "cartão promocional",
  ],
} as const;

const variantTerms = {
  pro: ["pro", "professional", "프로", "プロ", "专业版", "專業版"],
  max: ["max", "맥스", "マックス", "最大版"],
  plus: ["plus", "플러스", "プラス", "加強版", "加强版"],
  ultra: ["ultra", "울트라", "ウルトラ", "超强版", "超強版"],
  mini: ["mini", "미니", "ミニ", "迷你"],
  light: ["lite", "light", "라이트", "ライト", "轻量版", "輕量版"],
  air: ["air", "에어", "エア"],
  flavor_cherry: ["cherry", "체리", "チェリー", "樱桃", "櫻桃", "cereza", "cereja"],
  flavor_strawberry: ["strawberry", "딸기", "ストロベリー", "草莓", "fresa", "morango"],
  flavor_vanilla: ["vanilla", "바닐라", "バニラ", "香草", "vainilla", "baunilha"],
  flavor_chocolate: ["chocolate", "choco", "초콜릿", "초코", "チョコレート", "巧克力", "cokelat"],
  flavor_grape: ["grape", "포도", "グレープ", "葡萄", "uva"],
  flavor_lemon: ["lemon", "레몬", "レモン", "柠檬", "檸檬", "limón", "limão"],
  flavor_lime: ["lime", "라임", "ライム", "青柠", "萊姆", "lima"],
  flavor_orange: ["orange", "오렌지", "オレンジ", "橙", "naranja", "laranja"],
  flavor_apple: ["apple", "사과", "アップル", "苹果", "蘋果", "manzana", "maçã"],
  flavor_peach: ["peach", "복숭아", "ピーチ", "桃", "melocotón", "pêssego"],
  flavor_mango: ["mango", "망고", "マンゴー", "芒果", "manga"],
  flavor_mint: ["mint", "민트", "ミント", "薄荷", "menta"],
  flavor_spicy: ["spicy", "hot pepper", "chili", "매운", "고추", "スパイシー", "唐辛子", "pedas", "picante"],
  color_black: ["black", "블랙", "검정", "ブラック", "negro", "preto"],
  color_white: ["white", "화이트", "흰색", "ホワイト", "blanco", "branco"],
  color_red: ["red", "레드", "빨강", "レッド", "rojo", "vermelho"],
  color_blue: ["blue", "블루", "파랑", "ブルー", "azul"],
  color_green: ["green", "그린", "초록", "グリーン", "verde"],
  color_pink: ["pink", "핑크", "ピンク", "粉色", "rosa"],
  color_gold: ["gold", "골드", "ゴールド", "金色", "dorado", "dourado"],
  color_silver: ["silver", "실버", "シルバー", "银色", "銀色", "plateado", "prateado"],
  formula_zero: ["zero", "제로", "ゼロ", "零", "cero", "sem açúcar"],
  formula_diet: ["diet", "다이어트", "ダイエット", "低卡", "低糖", "dieta"],
  formula_sugar_free: ["sugar free", "sugar-free", "무설탕", "シュガーフリー", "无糖", "無糖", "sin azúcar"],
  formula_decaf: ["decaf", "decaffeinated", "디카페인", "デカフェ", "无咖啡因", "無咖啡因", "descafeinado"],
  formula_lean: ["lean", "살코기", "ライトツナ", "瘦肉", "magro"],
} as const;

function phraseCategories(value: string, dictionary: Record<string, readonly string[]>) {
  const normalized = normalizedSearchText(value);
  const padded = ` ${normalized} `;
  const compact = compactSearchText(value);
  const categories = new Set<string>();
  for (const [category, terms] of Object.entries(dictionary)) {
    if (terms.some((term) => {
      const normalizedTerm = normalizedSearchText(term);
      if (!normalizedTerm) return false;
      const latinOnly = /^[\p{Script=Latin}\d ]+$/u.test(normalizedTerm);
      return latinOnly ? padded.includes(` ${normalizedTerm} `) : compact.includes(compactSearchText(term));
    })) categories.add(category);
  }
  return categories;
}

function accessoryCategories(value: string) {
  const categories = phraseCategories(value, accessoryTerms);
  const normalized = normalizedSearchText(value);
  const packagingCase = /(?:^|\s)(?:cases?\s+of\s+\d{1,4}|\d{1,4}\s*-?\s*cases?)(?:\s|$)/iu.test(normalized);
  if (packagingCase) categories.delete("protective_case");
  return categories;
}

function collectorFamilyEvidence(value: string) {
  const normalized = normalizedSearchText(value);
  const compact = compactSearchText(value);
  return /(?:^|\s)(?:pokemon|pokémon|pikachu|charizard|vmax|vstar|yu\s+gi\s+oh|yugioh)(?:\s|$)/iu.test(normalized)
    || /포켓몬|피카츄|리자몽|유희왕|ポケモン|ピカチュウ|リザードン|遊戯王|宝可梦|寶可夢|皮卡丘|喷火龙|噴火龍|游戏王|遊戲王|โปเกมอน/u.test(compact);
}

function genericCardWord(value: string) {
  const normalized = normalizedSearchText(value);
  const compact = compactSearchText(value);
  return /(?:^|\s)cards?(?:\s|$)/iu.test(normalized)
    || /카드|カード|卡片|卡牌/u.test(compact);
}

function collectibleListingSignature(value: string) {
  const explicitCard = accessoryCategories(value).has("collectible_card");
  if (explicitCard) return true;
  const modifiers = phraseCategories(value, {
    promotional: [
      "promo", "promotional", "promocional", "프로모", "프로모션", "プロモ", "促销", "促銷",
      "โปรโมชั่น", "khuyến mãi", "promosi",
    ],
    collectible: [
      "collectible", "collectibles", "coleccionable", "coleccionables", "colecionável", "colecionavel",
      "수집품", "コレクション", "收藏", "สะสม", "sưu tập", "koleksi",
    ],
  });
  return modifiers.size > 0 && collectorFamilyEvidence(value);
}

function productVariantCategories(value: string) {
  const categories = phraseCategories(value, variantTerms);
  const normalized = normalizedSearchText(value);
  const compact = compactSearchText(value);
  if (/(?:^|\s)(?:light\s+tuna|tuna\s+light)(?:\s|$)/iu.test(normalized) || compact.includes("ライトツナ")) {
    categories.delete("light");
    categories.add("formula_lean");
  }
  if (/(?:^|\s)(?:iphone|ipad|macbook|airpods?|apple\s+watch)(?:\s|$)/iu.test(normalized)) {
    categories.delete("flavor_apple");
  }
  return categories;
}

function variantRequirements(queries: string[]) {
  const profiles = queries.map(productVariantCategories);
  if (profiles.length <= 1) return profiles[0] ?? new Set<string>();
  const evidence = new Map<string, Set<number>>();
  profiles.forEach((categories, index) => {
    for (const category of categories) {
      const indexes = evidence.get(category) ?? new Set<number>();
      indexes.add(index);
      evidence.set(category, indexes);
    }
  });
  return new Set([...evidence].filter(([, indexes]) => indexes.size >= 2).map(([category]) => category));
}

const formattedIdentifierPattern = /(?<!\d)(?:\d[\s.-]?){7,13}\d(?!\d)/gu;

function identifierTokens(value: string) {
  const matches = value.normalize("NFKC").match(formattedIdentifierPattern) ?? [];
  return [...new Set(matches.map((match) => match.replace(/\D/gu, "")).filter((identifier) => /^\d{8,14}$/u.test(identifier)))];
}

function modelTokens(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const identifierParts = new Set((value.normalize("NFKC").match(formattedIdentifierPattern) ?? []).flatMap((identifier) => normalizedSearchText(identifier).split(" ")));
  const measurementNumberParts = new Set([
    ...normalized.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(\\d[\\d.,]*)\\s*(?:${measurementUnitPattern})`, "giu")),
    ...normalized.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,4})\\s*(?:${COUNT_UNIT_PATTERN})(?![\\p{L}\\p{N}])`, "giu")),
  ].flatMap((match) => normalizedSearchText(match[1] ?? "").split(" ")));
  const models = new Set<string>();
  for (const match of normalized.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,6}(?:[.,]\\d+)?)\\s*(${STORAGE_UNIT_PATTERN})(?![\\p{L}\\p{N}])`, "giu"))) {
    const rawAmount = match[1] ?? "";
    const amount = rawAmount.replace(/,(?=\d{3}(?:$|\D))/gu, "").replace(",", ".");
    const parsed = Number(amount);
    if (Number.isFinite(parsed) && parsed > 0) models.add(`${parsed}${(match[2] ?? "").toLocaleLowerCase()}`);
  }
  const latinModelCores = normalized.match(/[a-z]{1,16}(?:[-_.]?\d[a-z0-9-_.]*)+|\d{1,6}[a-z][a-z0-9-_.]*/giu) ?? [];
  for (const core of latinModelCores) {
    const compact = core.replace(/[^a-z0-9]/giu, "");
    if (compact.length < 2 || measurementTokenSuffix.test(compact) || measurementTokens(core).length > 0) continue;
    models.add(compact);
  }
  const segments = normalized.match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*/gu) ?? [];
  for (const segment of segments) {
    const compact = segment.replace(/[^\p{L}\p{N}]/gu, "");
    if (compact.length < 3 || !/\p{L}/u.test(compact) || !/\d/u.test(compact)) continue;
    if (measurementTokenSuffix.test(compact) || measurementTokens(segment).length > 0) continue;
    const nonLatinLetters = segment.replace(/[\p{Script=Latin}\p{N}_.-]/gu, "");
    if (/\p{Script=Latin}/u.test(segment) && /\p{L}/u.test(nonLatinLetters)) continue;
    models.add(compact);
  }
  const words = normalizedSearchText(value).split(" ");
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index] ?? "";
    const right = words[index + 1] ?? "";
    const leftIsGeneric = ignoredSearchTokens.has(left) || normalizedCountUnitTokens.has(left) || normalizedMeasurementUnitTokens.has(left) || normalizedStorageUnitTokens.has(left);
    const rightIsGeneric = ignoredSearchTokens.has(right) || normalizedCountUnitTokens.has(right) || normalizedMeasurementUnitTokens.has(right) || normalizedStorageUnitTokens.has(right);
    if (!leftIsGeneric && !identifierParts.has(right) && !measurementNumberParts.has(right) && /^[\p{L}]{2,}$/u.test(left) && /^\d{1,4}$/u.test(right)) models.add(`${left}${right}`);
    if (!rightIsGeneric && !identifierParts.has(left) && !measurementNumberParts.has(left) && /^\d{1,4}$/u.test(left) && /^[\p{L}]{2,}$/u.test(right)) models.add(`${left}${right}`);
  }
  return [...models];
}

function modelRequirements(queries: string[]) {
  // Latin model codes and normalized storage specs are stable across locales.
  // A localized product-family word joined to a generation number (for example
  // 아이폰15) is kept as conflict evidence, but is not a hard cross-language
  // requirement unless two independent aliases repeat it.
  const required = new Set(modelTokens(queries[0] ?? "").filter((model) => /\p{Script=Latin}/u.test(model)));
  const aliasEvidence = new Map<string, Set<number>>();
  queries.slice(1).forEach((query, offset) => {
    for (const model of modelTokens(query)) {
      const indexes = aliasEvidence.get(model) ?? new Set<number>();
      indexes.add(offset + 1);
      aliasEvidence.set(model, indexes);
    }
  });
  for (const [model, indexes] of aliasEvidence) {
    if (indexes.size >= 2) required.add(model);
  }
  return [...required];
}

function modelStem(value: string) {
  return value.replace(/\d+/gu, "");
}

function tokenMatchesCandidate(token: string, candidateTokens: Set<string>, compactCandidate: string) {
  if (candidateTokens.has(token)) return true;
  const compactToken = token.replaceAll(" ", "");
  const minimumSubstringLength = /[^\p{Script=Latin}\d]/u.test(compactToken) ? 2 : 4;
  return compactToken.length >= minimumSubstringLength && compactCandidate.includes(compactToken);
}

function identityAnchors(tokens: string[]) {
  if (tokens.length <= 2) return tokens;
  const interior = tokens.slice(1, -1).sort((left, right) => right.length - left.length || tokens.lastIndexOf(right) - tokens.lastIndexOf(left))[0];
  return [...new Set([tokens[0], interior, tokens.at(-1)].filter((token): token is string => Boolean(token)))];
}

function packNeutralSearchQuery(value: string) {
  const countSuffix = new RegExp(`(?:\\s*(?:x|×|\\*)\\s*)?\\d+(?:\\.\\d+)?\\s*-?\\s*(?:${COUNT_UNIT_PATTERN})(?=$|[\\s,;/()])`, "giu");
  const packMeasurement = `\\d[\\d.,]*\\s*(?:${packMeasurementUnitPattern})`;
  const neutral = value
    .replace(new RegExp(`(${packMeasurement})\\s*[x×*]\\s*\\d{1,4}(?!\\d)(?:\\s*(?:${COUNT_UNIT_PATTERN}))?`, "giu"), "$1")
    .replace(new RegExp(`\\d{1,4}(?!\\d)(?:\\s*(?:${COUNT_UNIT_PATTERN}))?\\s*[x×*]\\s*(${packMeasurement})`, "giu"), "$1")
    .replace(countSuffix, " ")
    .replace(/(?<!\d)\d{1,3}\s*\+\s*\d{1,3}(?!\d)/gu, " ")
    .replace(/\b(?:set|pack|lot)\s+of\s+\d{1,4}\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const neutralMeasurements = measurementTokens(neutral);
  if (neutral === value.trim() || (neutralMeasurements.length > 0 && neutralMeasurements.every((measurement) => measurement.kind === "count"))) return "";
  return neutral;
}

function elevenstRetrievalQueries(primary: string, aliases: string[]) {
  const base = normalizedCompetitorQueries(primary, aliases, 8);
  const neutral = base.map(packNeutralSearchQuery).filter(Boolean);
  return normalizedCompetitorQueries(base[0] ?? primary, [...base.slice(1), ...neutral], 12);
}

export function competitorCandidateRelevance(candidate: CompetitorPriceCandidate, queries: string[]) {
  const normalizedQueries = normalizedCompetitorQueries(queries[0] ?? "", queries.slice(1), 12);
  if (!normalizedQueries.length) return 0;
  // A seller or mall name is not product identity evidence. Only the listing
  // title may satisfy brand/model/variant checks.
  const normalizedCandidate = normalizedSearchText(candidate.title);
  const compactCandidate = compactSearchText(candidate.title);
  const candidateTokens = new Set(normalizedCandidate.split(" ").filter(Boolean));
  const candidateMeasurements = measurementTokens(candidate.title);
  const queryMeasurements = normalizedQueries.map(measurementTokens);
  const requirements = measurementRequirements(normalizedQueries);
  if (!measurementsMatchRequirements(requirements, candidateMeasurements)) return 0;

  const queryIdentifiers = new Set(normalizedQueries.flatMap(identifierTokens));
  const candidateIdentifiers = new Set(identifierTokens(candidate.title));
  if (queryIdentifiers.size > 1) return 0;
  const [requiredIdentifier] = queryIdentifiers;
  if (requiredIdentifier && !candidateIdentifiers.has(requiredIdentifier)) return 0;

  const queryModels = new Set(normalizedQueries.flatMap(modelTokens));
  const requiredModels = modelRequirements(normalizedQueries);
  const candidateModels = new Set(modelTokens(candidate.title));
  if (requiredModels.some((model) => !candidateModels.has(model))) return 0;
  for (const candidateModel of candidateModels) {
    if ([...queryModels].some((queryModel) => (
      candidateModel !== queryModel
      && modelStem(candidateModel).length >= 2
      && modelStem(candidateModel) === modelStem(queryModel)
    ))) return 0;
  }

  const primaryQuery = normalizedQueries[0] ?? "";
  const allowedAccessories = accessoryCategories(primaryQuery);
  const explicitCollectibleQueryIntent = normalizedQueries.some((query) => (
    accessoryCategories(query).has("collectible_card")
    || (collectorFamilyEvidence(query) && genericCardWord(query))
  ));
  const querySharesCollectorFamily = normalizedQueries.some(collectorFamilyEvidence);
  if (explicitCollectibleQueryIntent) allowedAccessories.add("collectible_card");
  const candidateAccessories = accessoryCategories(candidate.title);
  if ([...candidateAccessories].some((category) => !allowedAccessories.has(category))) return 0;
  const candidateCollectibleSignature = collectibleListingSignature(candidate.title);
  if (candidateCollectibleSignature
      && !candidateAccessories.has("collectible_card")
      && !querySharesCollectorFamily) return 0;
  const requiredVariants = variantRequirements(normalizedQueries);
  const allowedVariants = new Set([...productVariantCategories(primaryQuery), ...requiredVariants]);
  const candidateVariants = productVariantCategories(candidate.title);
  if ([...candidateVariants].some((category) => !allowedVariants.has(category))) return 0;
  if ([...requiredVariants].some((category) => !candidateVariants.has(category))) return 0;
  const matchesCandidateIdentityToken = (token: string) => {
    if (tokenMatchesCandidate(token, candidateTokens, compactCandidate)) return true;
    const tokenVariants = productVariantCategories(token);
    if (tokenVariants.size > 0 && [...tokenVariants].every((category) => candidateVariants.has(category))) return true;
    const tokenAccessories = accessoryCategories(token);
    if (tokenAccessories.size > 0 && [...tokenAccessories].every((category) => candidateAccessories.has(category))) return true;
    return genericCardWord(token) && explicitCollectibleQueryIntent && candidateCollectibleSignature;
  };

  let best = 0;

  for (let index = 0; index < normalizedQueries.length; index += 1) {
    const query = normalizedQueries[index];
    const identifiers = identifierTokens(query);
    if (identifiers.length && !identifiers.some((identifier) => candidateIdentifiers.has(identifier))) continue;
    const models = modelTokens(query);
    if (models.length && !models.every((model) => candidateModels.has(model))) continue;
    const measurements = queryMeasurements[index] ?? [];
    if (measurements.length && !measurements.every((measurement) => measurementMatchesCandidate(measurement, candidateMeasurements))) continue;
    const tokens = meaningfulSearchTokens(query);
    if (!tokens.length) {
      if (!identifiers.length && !models.length) continue;
      best = Math.max(best, identifiers.length * 500 + models.length * 250 + measurements.length * 60 + (index === 0 ? 50 : 0));
      continue;
    }
    const matched = tokens.filter(matchesCandidateIdentityToken);
    const required = tokens.length === 1 ? 1 : Math.max(2, Math.ceil(tokens.length * 0.6));
    if (matched.length < required) continue;
    const anchors = identityAnchors(tokens);
    if (anchors.some((anchor) => !matchesCandidateIdentityToken(anchor))) continue;
    const phraseBonus = compactCandidate.includes(compactSearchText(query)) ? 200 : 0;
    const evidenceBonus = identifiers.length * 500 + models.length * 250 + measurements.length * 60;
    best = Math.max(best, matched.length * 20 + Math.round((matched.length / tokens.length) * 400) + phraseBonus + evidenceBonus + (index === 0 ? 50 : 0));
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
  if (error) throw new Error("COMPETITOR_CREDENTIAL_LOOKUP_FAILED");
  const active = data as ActiveCredential | null;
  if (!active?.secret_payload || typeof active.secret_payload !== "object" || Array.isArray(active.secret_payload)) return null;
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

type CompetitorQueryLanguageFamily = "hangul" | "kana" | "han" | "thai" | "vietnamese" | "malay" | "indonesian" | "portuguese" | "spanish" | "latin" | "other";

function competitorQueryLanguageFamily(query: string): CompetitorQueryLanguageFamily {
  if (/\p{Script=Hangul}/u.test(query)) return "hangul";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return "kana";
  if (/\p{Script=Thai}/u.test(query)) return "thai";
  if (/\p{Script=Han}/u.test(query)) return "han";
  if (/[ăâđêôơưằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữự]/iu.test(query)) return "vietnamese";
  const padded = ` ${normalizedSearchText(query)} `;
  if (/[ãõç]/iu.test(query) || /\b(?:produto|pacote|garrafa|caixa|sabão|edição)\b/iu.test(padded)) return "portuguese";
  if (/[ñ¿¡]/iu.test(query) || /\b(?:producto|paquete|botella|caja|edición)\b/iu.test(padded)) return "spanish";
  if (/\b(?:produk|kemasan|isi|rasa|kaleng|bungkus)\b/iu.test(padded)) return "indonesian";
  if (/\b(?:perisa|pek|tulen|rasmi|baharu|kotak)\b/iu.test(padded)) return "malay";
  if (/\p{Script=Latin}/u.test(query)) return "latin";
  return "other";
}

const competitorQueryLanguagePriority: readonly CompetitorQueryLanguageFamily[] = [
  "hangul", "latin", "kana", "han", "malay", "indonesian", "vietnamese", "thai", "portuguese", "spanish", "other",
];

export function normalizedCompetitorQueries(primary: string, aliases: string[] = [], maximum = 12) {
  const limit = Math.max(1, Math.min(maximum, 12));
  const seen = new Set<string>();
  const available = [primary, ...aliases]
    .map((value) => value.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, 160))
    .filter((value) => {
      const key = compactSearchText(value);
      if (value.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (available.length <= limit) return available;

  const selected = [available[0]];
  const selectedValues = new Set(selected);
  const primaryFamily = competitorQueryLanguageFamily(available[0]);
  for (const family of competitorQueryLanguagePriority) {
    if (family === primaryFamily) continue;
    const candidate = available.slice(1).find((query) => competitorQueryLanguageFamily(query) === family);
    if (!candidate || selectedValues.has(candidate)) continue;
    selected.push(candidate);
    selectedValues.add(candidate);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of available.slice(1)) {
    if (selectedValues.has(candidate)) continue;
    selected.push(candidate);
    selectedValues.add(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
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
    const score = competitorCandidateRelevance(item, queries);
    const currentScore = current ? competitorCandidateRelevance(current, queries) : 0;
    if (!current || score > currentScore || (score === currentScore && item.imageUrl && !current.imageUrl) || (score === currentScore && Boolean(item.imageUrl) === Boolean(current.imageUrl) && item.price < current.price)) unique.set(key, item);
  }
  return [...unique.values()];
}

export async function searchNaverShoppingVariants(primary: string, aliases: string[], credentials: NaverSearchCredentials, displayPerQuery = 30) {
  const queries = normalizedCompetitorQueries(primary, aliases, 8);
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
  const queries = normalizedCompetitorQueries(primary, aliases, 8);
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
  const family = competitorQueryLanguageFamily(query);
  if (family === "hangul") return "ko";
  if (family === "kana") return "ja";
  if (family === "thai") return "th";
  if (family === "han") return "zh";
  if (family === "vietnamese") return "vi";
  if (family === "malay") return "ms";
  if (family === "indonesian") return "id";
  if (family === "portuguese") return "pt-br";
  if (family === "spanish") return "es";
  return "en";
}

function diverseMarketplaceQueries(primary: string, aliases: string[], marketplace: MarketplaceWebMarketplace) {
  const available = normalizedCompetitorQueries(primary, aliases, 12);
  if (available.length <= BRAVE_MARKETPLACE_QUERY_LIMIT) return available;
  const primaryFamily = competitorQueryLanguageFamily(available[0]);
  // A Korean source title remains part of the relevance fence, but when the
  // research contract supplied local aliases it does not consume one of the
  // four marketplace-web requests.
  const selected = primaryFamily === "hangul" ? [] : [available[0]];
  const selectedValues = new Set(selected);
  const marketplaceFamilyOrder: Record<MarketplaceWebMarketplace, readonly CompetitorQueryLanguageFamily[]> = {
    shopee: ["latin", "portuguese", "spanish", "indonesian", "malay", "thai", "vietnamese", "han", "kana", "hangul", "other"],
    lazada: ["latin", "malay", "thai", "vietnamese", "indonesian", "han", "kana", "hangul", "portuguese", "spanish", "other"],
    temu: ["latin", "han", "kana", "portuguese", "spanish", "hangul", "thai", "vietnamese", "malay", "indonesian", "other"],
  };
  const familyOrder = marketplaceFamilyOrder[marketplace]
    .filter((family) => !selected.some((query) => competitorQueryLanguageFamily(query) === family));
  for (const family of familyOrder) {
    const candidate = available.slice(1).find((query) => competitorQueryLanguageFamily(query) === family);
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
  if (selected.length === 0) selected.push(available[0]);
  return selected;
}

export async function searchBraveMarketplaceWeb(
  query: string,
  credentials: BraveMarketplaceWebCredentials,
  marketplace: MarketplaceWebMarketplace,
  display = BRAVE_MARKETPLACE_RESULT_LIMIT,
  relevanceQueries: string[] = [query],
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
    return competitorCandidateRelevance(candidate, relevanceQueries) > 0 ? [candidate] : [];
  });
}

export async function searchBraveMarketplaceWebVariants(
  primary: string,
  aliases: string[],
  credentials: BraveMarketplaceWebCredentials,
  displayPerQuery = BRAVE_MARKETPLACE_RESULT_LIMIT,
) {
  const allQueries = normalizedCompetitorQueries(primary, aliases, 12);
  const settled = await Promise.allSettled((["shopee", "lazada", "temu"] as const).map(async (marketplace) => {
    const queries = diverseMarketplaceQueries(primary, aliases, marketplace);
    const candidates: CompetitorPriceCandidate[] = [];
    let successfulQueries = 0;
    for (const query of queries) {
      try {
        candidates.push(...await searchBraveMarketplaceWeb(query, credentials, marketplace, displayPerQuery, allQueries));
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
  const relevant = candidates.filter((candidate) => competitorCandidateRelevance(candidate, allQueries) > 0);
  const unique = new Map<string, CompetitorPriceCandidate>();
  for (const candidate of relevant) {
    const key = marketplaceIdentity(candidate);
    const current = unique.get(key);
    const score = competitorCandidateRelevance(candidate, allQueries);
    const currentScore = current ? competitorCandidateRelevance(current, allQueries) : 0;
    if (!current || score > currentScore || (score === currentScore && candidate.imageUrl && !current.imageUrl) || (score === currentScore && Boolean(candidate.imageUrl) === Boolean(current.imageUrl) && candidate.price < current.price)) unique.set(key, candidate);
  }
  return groupCompetitorPrices([...unique.values()], 3, allQueries);
}

export async function competitorProviderRegistry(
  serviceClient: SupabaseClient,
  options: CompetitorProviderRegistryOptions,
): Promise<CompetitorProviderRegistry> {
  // Credential discovery is intentionally isolated per provider. A transient
  // Vault/RPC failure for one marketplace must not suppress an independently
  // configured provider (for example Brave via environment variables).
  const [naverResult, elevenstResult, ebayResult] = await Promise.allSettled([
    naverSearchCredentials(serviceClient),
    elevenstSearchCredentials(serviceClient),
    ebayBrowseCredentials(serviceClient),
  ]);
  const naver = naverResult.status === "fulfilled" ? naverResult.value : null;
  const elevenst = elevenstResult.status === "fulfilled" ? elevenstResult.value : null;
  const ebay = ebayResult.status === "fulfilled" ? ebayResult.value : null;
  const marketplaceWeb = options.enableMarketplaceWeb ? braveMarketplaceWebCredentials() : null;
  const configured: SearchProvider[] = [];
  const unavailable: CompetitorProviderStatus[] = [];
  if (naver) configured.push({ id: "naver_shopping", marketplaces: providerMarketplaces.naver_shopping, search: (primary, aliases, display) => searchNaverShoppingVariants(primary, aliases, naver, display) });
  else unavailable.push({ provider: "naver_shopping", status: naverResult.status === "rejected" ? "failed" : "unavailable", count: 0, marketplaces: providerMarketplaces.naver_shopping });
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
  else unavailable.push({ provider: "elevenst_product_search", status: elevenstResult.status === "rejected" ? "failed" : "unavailable", count: 0, marketplaces: providerMarketplaces.elevenst_product_search });
  if (ebay) configured.push({ id: "ebay_browse", marketplaces: providerMarketplaces.ebay_browse, search: (primary, aliases, display) => searchEbayBrowseVariants(primary, aliases, ebay, display) });
  else unavailable.push({ provider: "ebay_browse", status: ebayResult.status === "rejected" ? "failed" : "unavailable", count: 0, marketplaces: providerMarketplaces.ebay_browse });
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
    const score = competitorCandidateRelevance(item, queries);
    const currentScore = current ? competitorCandidateRelevance(current, queries) : 0;
    if (!current || score > currentScore || (score === currentScore && item.imageUrl && !current.imageUrl) || (score === currentScore && Boolean(item.imageUrl) === Boolean(current.imageUrl) && item.price < current.price)) unique.set(key, item);
  }
  const order = Object.keys(providerMarketplaces);
  return {
    items: groupCompetitorPrices([...unique.values()], 3, queries),
    providers: providers.sort((left, right) => order.indexOf(left.provider) - order.indexOf(right.provider)),
    available: providers.some((provider) => provider.status === "searched"),
    pending: providers.some((provider) => provider.status === "pending"),
    configured: registry.configured.length > 0,
  };
}

export function groupCompetitorPrices(items: CompetitorPriceCandidate[], limitPerMarketplace = 3, queries: string[] = []) {
  const counts = new Map<CompetitorMarketplace, number>();
  return items
    .map((item) => ({ item, score: queries.length > 0 ? competitorCandidateRelevance(item, queries) : 0 }))
    .filter(({ score }) => queries.length === 0 || score > 0)
    .sort((left, right) => (
      left.item.marketplace.localeCompare(right.item.marketplace)
      || right.score - left.score
      || left.item.currency.localeCompare(right.item.currency)
      || left.item.price - right.item.price
    ))
    .filter(({ item }) => {
      const count = counts.get(item.marketplace) ?? 0;
      if (count >= limitPerMarketplace) return false;
      counts.set(item.marketplace, count + 1);
      return true;
    })
    .map(({ item }) => item);
}
