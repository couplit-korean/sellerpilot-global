import type { ActiveChannelKey } from "./catalog";

export function normalizeTenWonAmount(value: unknown) {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) return value;
  const normalized = Math.max(10, Math.ceil(amount / 10) * 10);
  return typeof value === "string" ? String(normalized) : normalized;
}

export function marketplaceListingPrice(channel: ActiveChannelKey, price: number) {
  return channel === "coupang" || channel === "smartstore"
    ? Number(normalizeTenWonAmount(price))
    : price;
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
