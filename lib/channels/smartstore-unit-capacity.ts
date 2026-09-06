type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord : {};
}

// Official ordinary-product contract and category rule (not group products):
// https://github.com/commerce-api-naver/commerce-api/discussions/3235
// https://github.com/commerce-api-naver/commerce-api/discussions/3439
// The API does not supply per-category indication units; never infer them:
// https://github.com/commerce-api-naver/commerce-api/discussions/3352
export const smartstoreIndicationUnits = [
  "g", "kg", "ml", "L", "cm", "m", "개", "개입", "매", "매입", "정", "캡슐", "구미", "포", "구",
] as const;

/**
 * Preserve the exact provider declaration for a content-only update when the
 * request does not replace it. An explicitly supplied value always wins,
 * including malformed or partial input, so the category validator can reject
 * it instead of silently repairing it from the current remote product.
 */
export function smartstoreUpdateOriginProductWithPreservedUnitCapacity(
  requestedValue: unknown,
  currentValue: unknown,
) {
  const requested = structuredClone(record(requestedValue));
  const requestedDetail = record(requested.detailAttribute);
  if (Object.hasOwn(requestedDetail, "unitCapacity")) return requested;
  const current = record(currentValue);
  const currentDetail = record(current.detailAttribute);
  if (!Object.hasOwn(currentDetail, "unitCapacity")) return requested;
  requested.detailAttribute = {
    ...requestedDetail,
    unitCapacity: structuredClone(currentDetail.unitCapacity),
  };
  return requested;
}

/** Validate the approved body against a fresh exact provider category GET.
 * No title parsing, shipping-weight substitution, price calculation, or defaults.
 * This intentionally blocks unknown category metadata rather than declaring an
 * exemption. The caller must run this before any image/product mutation.
 */
export function assertSmartstoreUnitCapacity(input: {
  originProduct: unknown;
  category: unknown;
}): void {
  const product = record(input.originProduct);
  const category = record(input.category);
  const categoryId = String(product.leafCategoryId ?? "").trim();
  const flags = category.exceptionalCategories;
  if (!/^\d+$/.test(categoryId)
      || String(category.id ?? "").trim() !== categoryId
      || category.last !== true
      || !Array.isArray(flags)
      || flags.some((flag) => typeof flag !== "string")) {
    throw new Error("NAVER_UNIT_CAPACITY_CATEGORY_UNVERIFIED");
  }
  const required = flags.includes("UNIT_PRICE");
  const detail = record(product.detailAttribute);
  if (!Object.hasOwn(detail, "unitCapacity")) {
    if (required) throw new Error("NAVER_UNIT_PRICE_YN_REQUIRED");
    return;
  }
  const capacity = record(detail.unitCapacity);
  if (typeof capacity.unitPriceYn !== "boolean") {
    throw new Error("NAVER_UNIT_PRICE_YN_REQUIRED");
  }
  if (!capacity.unitPriceYn) {
    if (required) throw new Error("NAVER_UNIT_PRICE_REQUIRED_CATEGORY_CANNOT_DISABLE");
    // Do not silently discard contradictory amounts from an approved request.
    if (["totalCapacityValue", "unitCapacity", "indicationUnit"].some((key) => Object.hasOwn(capacity, key))) {
      throw new Error("NAVER_UNIT_CAPACITY_DISABLED_WITH_VALUES");
    }
    return;
  }
  const total = capacity.totalCapacityValue;
  if (typeof total !== "number" || !Number.isFinite(total)
      || total < 0.001 || total > 999_999_999
      || !/^\d+(?:\.\d{1,3})?$/.test(String(total))) {
    throw new Error("NAVER_UNIT_TOTAL_CAPACITY_INVALID");
  }
  const unit = capacity.unitCapacity;
  if (typeof unit !== "number" || !Number.isInteger(unit) || unit < 1 || unit > 999) {
    throw new Error("NAVER_UNIT_DISPLAY_CAPACITY_INVALID");
  }
  if (typeof capacity.indicationUnit !== "string"
      || !(smartstoreIndicationUnits as readonly string[]).includes(capacity.indicationUnit)) {
    throw new Error("NAVER_UNIT_INDICATION_UNIT_INVALID");
  }
}
