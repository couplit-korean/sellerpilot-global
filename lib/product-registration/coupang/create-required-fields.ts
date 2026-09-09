export type CoupangCreateRecord = Record<string, unknown>;
type UnknownRecord = CoupangCreateRecord;

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is UnknownRecord =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function coupangCreateItems(value: unknown): CoupangCreateRecord[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    return null;
  }
  return value as CoupangCreateRecord[];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveInteger(value: unknown, maximum: number): boolean {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum;
}

export function isValidCoupangGtin(value: unknown): boolean {
  const digits = text(value);
  if (![8, 12, 13, 14].includes(digits.length) || !/^\d+$/u.test(digits)) {
    return false;
  }
  const checkDigit = Number(digits.at(-1));
  const payload = digits.slice(0, -1);
  const sum = [...payload].reverse().reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function hasValidCoupangBrand(body: UnknownRecord): boolean {
  if (text(body.brandId)) return true;
  const brand = text(body.brand);
  return brand !== "" && /^[\p{L}\p{N}]+$/u.test(brand);
}

export function hasValidCoupangProductIdentifier(item: UnknownRecord): boolean {
  const barcode = text(item.barcode);
  const modelNo = text(item.modelNo);
  const sellerSku = text(item.externalVendorSku);
  if (barcode) {
    return isValidCoupangGtin(barcode) && item.emptyBarcode !== true;
  }
  // SellerPilot previously copied its internal seller SKU into modelNo. That
  // does not prove a brand-assigned model number under Coupang's 2026 policy.
  return item.emptyBarcode === true
    && text(item.emptyBarcodeReason) !== ""
    && modelNo !== ""
    && modelNo !== sellerSku;
}

export function hasValidCoupangPurchaseOption(item: UnknownRecord): boolean {
  const attributes = records(item.attributes);
  return attributes.length > 0 && attributes.some((attribute) =>
    text(attribute.attributeTypeName) !== ""
      && text(attribute.attributeValueName) !== ""
      && text(attribute.exposed).toUpperCase() !== "NONE");
}

/**
 * Enforce the general API registration fields Coupang made mandatory in 2026.
 * Every CREATE entry point is strict. A malformed direct call or stale queued
 * payload must fail before any provider mutation just like the admin path.
 */
export function assertCoupangGeneralCreateRequiredFields(body: UnknownRecord) {
  const rawItems = body.items;
  const items = coupangCreateItems(rawItems);
  if (!items) throw new Error("COUPANG_CREATE_ITEMS_REQUIRED_OR_INVALID");
  if (Array.isArray(rawItems) && rawItems.length > 200) {
    throw new Error("COUPANG_ITEM_LIMIT_EXCEEDED");
  }

  const sellerSkus = items.map((item) => text(item.externalVendorSku));
  if (sellerSkus.some((sku) => !sku)
    || new Set(sellerSkus).size !== sellerSkus.length) {
    throw new Error("COUPANG_SELLER_SKU_REQUIRED_OR_DUPLICATE");
  }

  if (!hasValidCoupangBrand(body)) {
    throw new Error("COUPANG_BRAND_REQUIRED_OR_INVALID");
  }

  const itemNames = items.map((item) => text(item.itemName));
  if (itemNames.some((name) => !name)
    || new Set(itemNames).size !== itemNames.length) {
    throw new Error("COUPANG_ITEM_NAME_REQUIRED_OR_DUPLICATE");
  }
  if (items.some((item) => !positiveInteger(item.maximumBuyCount, 99_999))) {
    throw new Error("COUPANG_CREATE_STOCK_INVALID");
  }
  if (items.some((item) => !positiveInteger(item.unitCount, 99_999))) {
    throw new Error("COUPANG_UNIT_COUNT_REQUIRED");
  }
  if (items.some((item) => !hasValidCoupangProductIdentifier(item))) {
    throw new Error("COUPANG_PRODUCT_IDENTIFIER_CONFIRMATION_REQUIRED");
  }
  if (items.some((item) => !hasValidCoupangPurchaseOption(item))) {
    throw new Error("COUPANG_PURCHASE_OPTION_REQUIRED");
  }
}
