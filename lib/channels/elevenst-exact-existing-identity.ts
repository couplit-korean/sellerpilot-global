export const elevenstExactExistingPublicationContract =
  "elevenst_exact_existing_publication_v1" as const;

export const elevenstExactExistingPublicationArgument =
  "sellerpilotElevenstExactExistingPublication" as const;

export const elevenstExactExistingPublicationIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "363f3b81-f364-4f22-af4e-4920199904d0",
  credentialId: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
  remoteId: "9573255804",
  sellerSku: "QA-20260823-CC-001",
  categoryId: "1341821",
  currency: "KRW",
  priceKrw: 5_000,
  stock: 1,
  baselineProviderStatus: "105",
  liveProviderStatus: "103",
  locale: "ko-KR",
  representativeImageCount: 1,
  detailImageCount: 8,
});

export function elevenstExactExistingPublicationCandidate(input: {
  channel: string;
  listingId?: string | null;
  remoteId?: string | null;
  marketplaceSku?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
  failureClass?: string | null;
}) {
  const identity = elevenstExactExistingPublicationIdentity;
  return input.channel === "elevenst"
    && input.listingId === identity.listingId
    && input.remoteId === identity.remoteId
    && (input.marketplaceSku === null
      || input.marketplaceSku === undefined
      || input.marketplaceSku === identity.sellerSku)
    && input.status === "failed"
    && input.failureClass === "external_action"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown"
    && (!input.providerStatus || input.providerStatus === identity.baselineProviderStatus)
    && !input.publishedAt;
}
