import { isDeepStrictEqual } from "node:util";
import { mergeCoupangListingUpdateBody } from "./listing-update";

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identityValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function currentItemIndex(
  currentItems: Array<Record<string, unknown>>,
  patchItem: Record<string, unknown>,
  patchIndex: number,
) {
  const matchId = identityValue(patchItem.sellerpilotItemMatchId);
  if (!matchId) return patchIndex < currentItems.length ? patchIndex : -1;
  return currentItems.findIndex((item) => [
    item.vendorItemId,
    item.externalVendorSku,
    item.modelNo,
  ].map(identityValue).includes(matchId));
}

/**
 * Coupang's seller-product update is a full-document PUT. An empty notices
 * array coming from an edit draft must therefore mean "no notice change", not
 * deletion of the mandatory disclosure data returned by the preflight GET.
 */
export function coupangListingUpdateWrite(
  currentValue: unknown,
  patchValue: unknown,
) {
  const current = recordValue(currentValue);
  const patch = structuredClone(recordValue(patchValue));
  const currentItems = Array.isArray(current.items) ? current.items.map(recordValue) : [];
  const patchItems = Array.isArray(patch.items) ? patch.items.map(recordValue) : [];
  const preservedNoticeIndexes = new Map<number, unknown>();

  const effectivePatchItems = patchItems.map((patchItem, patchIndex) => {
    if (!Object.hasOwn(patchItem, "notices")) return structuredClone(patchItem);
    if (!Array.isArray(patchItem.notices)) {
      throw new Error("COUPANG_NOTICE_PATCH_INVALID");
    }
    if (patchItem.notices.length > 0) return structuredClone(patchItem);

    const itemIndex = currentItemIndex(currentItems, patchItem, patchIndex);
    if (itemIndex < 0) {
      throw new Error("COUPANG_EXISTING_ITEM_REQUIRED_FOR_NOTICE_PRESERVATION");
    }
    const existingNotices = currentItems[itemIndex].notices;
    if (!Array.isArray(existingNotices) || existingNotices.length === 0) {
      throw new Error("COUPANG_EXISTING_NOTICES_REQUIRED");
    }
    preservedNoticeIndexes.set(itemIndex, structuredClone(existingNotices));
    const sanitized = structuredClone(patchItem);
    delete sanitized.notices;
    return sanitized;
  });

  const effectivePatch = {
    ...patch,
    ...(Array.isArray(patch.items) ? { items: effectivePatchItems } : {}),
  };
  const body = mergeCoupangListingUpdateBody(current, effectivePatch);
  const mergedItems = Array.isArray(body.items) ? body.items.map(recordValue) : [];
  for (const [itemIndex, existingNotices] of preservedNoticeIndexes) {
    if (!isDeepStrictEqual(mergedItems[itemIndex]?.notices, existingNotices)) {
      throw new Error("COUPANG_EXISTING_NOTICES_NOT_PRESERVED");
    }
  }

  return { body, effectivePatch };
}
