import type { ActiveChannelKey } from "./catalog";

export function normalizeTenWonAmount(value: unknown) {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) return value;
  const normalized = Math.max(10, Math.ceil(amount / 10) * 10);
  return typeof value === "string" ? String(normalized) : normalized;
}

const usdCurrencyReference: Record<string, number> = {
  USD: 1,
  JPY: 145,
  SGD: 1.3,
  MYR: 4.5,
  PHP: 56,
  VND: 25_000,
  THB: 32,
  TWD: 30,
  BRL: 5.4,
  MXN: 18.7,
  IDR: 16_000,
  EUR: 0.86,
};

export function marketplaceListingCurrency(channel: ActiveChannelKey, targetCurrency?: string) {
  if (targetCurrency?.trim()) return targetCurrency.trim().toUpperCase();
  if (channel === "qoo10") return "JPY";
  if (channel === "ebay") return "USD";
  return "KRW";
}

function globalMarketplacePrice(usdPrice: number, currency: string) {
  const converted = usdPrice * (usdCurrencyReference[currency] ?? 1);
  if (["JPY", "KRW", "VND", "IDR"].includes(currency)) return Math.max(1, Math.ceil(converted));
  return Math.max(0.01, Math.ceil(converted * 100) / 100);
}

export function marketplaceListingPrice(channel: ActiveChannelKey, price: number, options?: {
  globalBaseUsdPrice?: number;
  targetCurrency?: string;
}) {
  if (channel === "coupang" || channel === "smartstore") return Number(normalizeTenWonAmount(price));
  if (channel === "temu") return price;
  const usdPrice = Number(options?.globalBaseUsdPrice);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) return price;
  return globalMarketplacePrice(usdPrice, marketplaceListingCurrency(channel, options?.targetCurrency));
}

export function replaceMarketplaceImageUrls(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    let output = value;
    for (const [source, target] of replacements) output = output.replaceAll(source, target);
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => replaceMarketplaceImageUrls(item, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, replaceMarketplaceImageUrls(item, replacements)]));
}

type CoupangAttributeMetadata = {
  dataType?: unknown;
  basicUnit?: unknown;
  usableUnits?: unknown;
};

export function normalizeCoupangAttributeValue(metadata: CoupangAttributeMetadata | undefined, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || String(metadata?.dataType ?? "").toUpperCase() !== "NUMBER") return raw;
  const usableUnits = Array.isArray(metadata?.usableUnits)
    ? metadata.usableUnits.map(String).map((unit) => unit.trim()).filter((unit) => unit && unit !== "없음")
    : [];
  const basicUnit = String(metadata?.basicUnit ?? "").trim();
  const unit = basicUnit && basicUnit !== "없음" ? basicUnit : usableUnits[0] ?? "";
  if (!unit || usableUnits.some((candidate) => raw.endsWith(candidate))) return raw;
  return /^[-+]?\d+(?:\.\d+)?$/.test(raw) ? `${raw}${unit}` : raw;
}
