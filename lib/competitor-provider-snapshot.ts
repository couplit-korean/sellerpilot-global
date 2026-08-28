export const competitorProviderIds = [
  "naver_shopping",
  "elevenst_product_search",
  "ebay_browse",
  "brave_marketplace_web",
] as const;

export const competitorMarketplaceIds = [
  "smartstore",
  "coupang",
  "elevenst",
  "qoo10",
  "shopee",
  "lazada",
  "ebay",
  "temu",
  "other",
] as const;

export type CompetitorProviderId = (typeof competitorProviderIds)[number];
export type CompetitorMarketplaceId = (typeof competitorMarketplaceIds)[number];
export type CompetitorProviderTerminalStatus = "searched" | "unavailable" | "failed";
export type CompetitorProviderDisplayStatus = {
  provider: CompetitorProviderId;
  status: CompetitorProviderTerminalStatus | "pending";
  count: number;
  marketplaces: CompetitorMarketplaceId[];
};
export type CompetitorMarketplaceProviderState = "loading" | "ready" | "partial" | "unavailable";

const providerIdSet = new Set<string>(competitorProviderIds);
const marketplaceIdSet = new Set<string>(competitorMarketplaceIds);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseCompetitorProviderSnapshot(value: unknown): CompetitorProviderDisplayStatus[] {
  if (!Array.isArray(value) || value.length > competitorProviderIds.length) return [];
  const providers: CompetitorProviderDisplayStatus[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)
        || typeof raw.provider !== "string"
        || !providerIdSet.has(raw.provider)
        || seen.has(raw.provider)
        || typeof raw.status !== "string"
        || !["searched", "unavailable", "failed", "pending"].includes(raw.status)
        || !Number.isSafeInteger(raw.count)
        || Number(raw.count) < 0
        || Number(raw.count) > 100_000
        || (raw.status !== "searched" && raw.count !== 0)
        || !Array.isArray(raw.marketplaces)
        || raw.marketplaces.length < 1
        || raw.marketplaces.length > 5
        || raw.marketplaces.some((marketplace) => typeof marketplace !== "string" || !marketplaceIdSet.has(marketplace))) {
      return [];
    }
    const marketplaces = raw.marketplaces as CompetitorMarketplaceId[];
    if (new Set(marketplaces).size !== marketplaces.length) return [];
    seen.add(raw.provider);
    providers.push({
      provider: raw.provider as CompetitorProviderId,
      status: raw.status as CompetitorProviderDisplayStatus["status"],
      count: Number(raw.count),
      marketplaces,
    });
  }
  return providers;
}

export function validCompetitorProviderFetchedAt(value: unknown) {
  return typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

export function savedCompetitorPriceState(
  providers: CompetitorProviderDisplayStatus[],
  fetchedAt: string | null,
): "loading" | "ready" | "unavailable" {
  if (!fetchedAt || providers.length === 0) return "unavailable";
  if (providers.some((provider) => provider.status === "pending")) return "loading";
  return providers.some((provider) => provider.status === "searched")
    ? "ready"
    : "unavailable";
}

export function competitorMarketplaceProviderState(
  marketplace: CompetitorMarketplaceId,
  providers: CompetitorProviderDisplayStatus[],
): CompetitorMarketplaceProviderState | null {
  const relevantProviders = providers.filter((provider) => provider.marketplaces.includes(marketplace));
  if (relevantProviders.length === 0) return null;
  if (relevantProviders.some((provider) => provider.status === "pending")) return "loading";
  const searchedProviderCount = relevantProviders.filter((provider) => provider.status === "searched").length;
  if (searchedProviderCount === relevantProviders.length) return "ready";
  if (searchedProviderCount > 0) return "partial";
  return "unavailable";
}
