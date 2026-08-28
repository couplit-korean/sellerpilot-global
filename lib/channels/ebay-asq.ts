export const ebayAsqMarketplaceIds = [
  "EBAY_US",
  "EBAY_CA",
  "EBAY_CA_FR",
  "EBAY_GB",
  "EBAY_AU",
  "EBAY_AT",
  "EBAY_BE_FR",
  "EBAY_BE_NL",
  "EBAY_FR",
  "EBAY_DE",
  "EBAY_IT",
  "EBAY_NL",
  "EBAY_ES",
  "EBAY_CH",
  "EBAY_HK",
  "EBAY_IE",
  "EBAY_IN",
  "EBAY_MY",
  "EBAY_PH",
  "EBAY_PL",
  "EBAY_SG",
] as const;

export type EbayAsqMarketplaceId = (typeof ebayAsqMarketplaceIds)[number];

const ebayAsqSiteCodeMarketplaceIds: Readonly<Record<string, EbayAsqMarketplaceId>> = {
  US: "EBAY_US",
  CANADA: "EBAY_CA",
  CANADAFRENCH: "EBAY_CA_FR",
  UK: "EBAY_GB",
  AUSTRALIA: "EBAY_AU",
  AUSTRIA: "EBAY_AT",
  BELGIUMFRENCH: "EBAY_BE_FR",
  BELGIUMDUTCH: "EBAY_BE_NL",
  FRANCE: "EBAY_FR",
  GERMANY: "EBAY_DE",
  ITALY: "EBAY_IT",
  NETHERLANDS: "EBAY_NL",
  SPAIN: "EBAY_ES",
  SWITZERLAND: "EBAY_CH",
  HONGKONG: "EBAY_HK",
  IRELAND: "EBAY_IE",
  INDIA: "EBAY_IN",
  MALAYSIA: "EBAY_MY",
  PHILIPPINES: "EBAY_PH",
  POLAND: "EBAY_PL",
  SINGAPORE: "EBAY_SG",
};

export function ebayAsqMarketplaceId(value: unknown): EbayAsqMarketplaceId {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!(ebayAsqMarketplaceIds as readonly string[]).includes(normalized)) {
    throw new Error("CHANNEL_ARGUMENT_INVALID:marketplaceId");
  }
  return normalized as EbayAsqMarketplaceId;
}

export function ebayAsqMarketplaceIdFromSiteCode(value: unknown): EbayAsqMarketplaceId {
  const normalized = typeof value === "string"
    ? value.trim().replace(/[\s_-]+/g, "").toUpperCase()
    : "";
  const marketplaceId = ebayAsqSiteCodeMarketplaceIds[normalized];
  if (!marketplaceId) throw new Error("EBAY_ASQ_LISTING_SITE_UNVERIFIED");
  return marketplaceId;
}

export function ebayAsqOperationMarketplaceId(input: {
  periodic: boolean;
  credentialMarketplaceId: unknown;
  requestedMarketplaceId: unknown;
}): EbayAsqMarketplaceId {
  if (input.periodic) {
    const credentialMarketplaceId = typeof input.credentialMarketplaceId === "string"
      ? input.credentialMarketplaceId.trim()
      : "";
    return ebayAsqMarketplaceId(credentialMarketplaceId);
  }
  return ebayAsqMarketplaceId(input.requestedMarketplaceId);
}
