import type { RemoteResponse } from "./protocols";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Inventory API absence only. Trading/manual listings require separate adoption. */
export function ebayInventorySkuAbsent(remote: RemoteResponse) {
  const errors = remote.data.errors;
  return [400, 404].includes(remote.response.status) && Array.isArray(errors) && errors.length > 0
    && errors.every(value => {
      const error = record(value);
      return error.domain === "API_INVENTORY" && [25702, 25710].includes(Number(error.errorId));
    });
}

export function ebayExactReconciliationOffer(remote: RemoteResponse, sku: string, marketplaceId: string, format: string) {
  const data = remote.data;
  if (!remote.response.ok || data.errors || !Array.isArray(data.offers)
      || !Number.isSafeInteger(data.total) || data.total !== data.offers.length
      || data.next || data.offers.length > 25) return null;
  const matches = data.offers.map(record).filter(offer => offer.sku === sku
    && offer.marketplaceId === marketplaceId && offer.format === format);
  if (matches.length !== 1 || typeof matches[0].offerId !== "string" || !matches[0].offerId.trim()) return null;
  return matches[0];
}
