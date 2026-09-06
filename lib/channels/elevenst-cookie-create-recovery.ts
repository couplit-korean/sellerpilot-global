import type { ElevenstSellerProdcodeReadResult } from "./elevenst-sellerprodcode-read";

export const elevenstCookieCreateRecoveryIdentity = Object.freeze({
  productId: "1ed4acfc-7603-48ec-a638-241131e59358",
  listingId: "61b343f8-2e61-42a8-8a45-750f8b834edc",
  sourceJobId: "b9faa28e-a73f-4457-bb34-d643cf9a9a74",
  sourceAttemptId: "d1300c6b-410e-47be-a93f-0e2ba7d4bbf6",
  credentialId: "b2dd0ff7-4420-495f-aead-a45857fb3bfe",
  sellerSku: "AUTO-780720401E2D4E4EA45F",
  remoteId: "9598600918",
  market: "",
  targetId: "",
  locale: "ko-KR",
  contract: "elevenst_cookie_create_get_only_v1",
});

export function elevenstCookieCreateRecoveryTarget(productId: string) {
  return productId === elevenstCookieCreateRecoveryIdentity.productId;
}

export function elevenstCookieCreateRecoveryGetMatches(
  result: ElevenstSellerProdcodeReadResult,
) {
  const identity = elevenstCookieCreateRecoveryIdentity;
  return result.outcome === "present"
    && result.sellerProductCode === identity.sellerSku
    && result.productNo === identity.remoteId
    && result.lookupHttpStatus === 200
    && result.prodmarket?.accepted === true
    && result.prodmarket.httpStatus === 200
    && result.prodmarket.productNo === identity.remoteId
    && result.prodmarket.sellerPrdCd === identity.sellerSku
    && result.prodmarket.sellerProductCodeMatched === true;
}
