type UnknownRecord = Record<string, unknown>;

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is UnknownRecord =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveIntegerText(value: unknown): string {
  const normalized = text(value);
  if (!/^\d+$/u.test(normalized)) return "";
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? normalized : "";
}

function externalSellerSkus(value: UnknownRecord): string[] {
  return records(value.items).map((item) => text(item.externalVendorSku));
}

export type CoupangCreateReadbackVerification = {
  ok: boolean;
  code:
    | "COUPANG_CREATE_IDENTITY_VERIFIED"
    | "COUPANG_CREATE_PRODUCT_ID_MISMATCH"
    | "COUPANG_CREATE_VENDOR_ID_MISMATCH"
    | "COUPANG_CREATE_SELLER_SKU_MISMATCH"
    | "COUPANG_CREATE_ITEM_ID_MISSING";
  expectedSellerSkuCount: number;
  observedSellerSkuCount: number;
  observedSellerProductItemIdCount: number;
};

/**
 * Bind a successful CREATE to the authenticated vendor and the exact option
 * SKUs that were sent. Missing, mixed, duplicate or structurally invalid
 * request items are never accepted as a verifiable CREATE lineage.
 */
export function verifyCoupangCreateReadback(input: {
  requestBody: UnknownRecord;
  sellerProduct: UnknownRecord;
  expectedVendorId: string;
  expectedSellerProductId: string;
}): CoupangCreateReadbackVerification {
  const requestedItems = input.requestBody.items;
  const expectedItems = records(requestedItems);
  const expectedSkus = externalSellerSkus(input.requestBody);
  const observedItems = records(input.sellerProduct.items);
  const observedSkus = observedItems.map((item) => text(item.externalVendorSku));
  const observedItemIds = observedItems
    .map((item) => positiveIntegerText(item.sellerProductItemId))
    .filter(Boolean);
  const base = {
    expectedSellerSkuCount: expectedSkus.filter(Boolean).length,
    observedSellerSkuCount: observedSkus.filter(Boolean).length,
    observedSellerProductItemIdCount: observedItemIds.length,
  };

  if (text(input.sellerProduct.sellerProductId) !== input.expectedSellerProductId) {
    return { ...base, ok: false, code: "COUPANG_CREATE_PRODUCT_ID_MISMATCH" };
  }

  const requestSkuContractValid = Array.isArray(requestedItems)
    && requestedItems.length > 0
    && expectedItems.length === requestedItems.length
    && expectedSkus.every(Boolean)
    && new Set(expectedSkus).size === expectedSkus.length;
  if (!requestSkuContractValid) {
    return { ...base, ok: false, code: "COUPANG_CREATE_SELLER_SKU_MISMATCH" };
  }
  if (text(input.sellerProduct.vendorId) !== input.expectedVendorId) {
    return { ...base, ok: false, code: "COUPANG_CREATE_VENDOR_ID_MISMATCH" };
  }
  if (new Set(expectedSkus).size !== expectedSkus.length
    || observedSkus.length !== expectedSkus.length
    || observedSkus.some((sku) => !sku)
    || [...expectedSkus].sort().join("\u0000") !== [...observedSkus].sort().join("\u0000")) {
    return { ...base, ok: false, code: "COUPANG_CREATE_SELLER_SKU_MISMATCH" };
  }
  if (observedItemIds.length !== observedItems.length
    || observedItems.length !== expectedSkus.length
    || new Set(observedItemIds).size !== observedItemIds.length) {
    return { ...base, ok: false, code: "COUPANG_CREATE_ITEM_ID_MISSING" };
  }
  return { ...base, ok: true, code: "COUPANG_CREATE_IDENTITY_VERIFIED" };
}
