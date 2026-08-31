import { isDeepStrictEqual } from "node:util";
import {
  coupangExactQaRecoveryBinding,
  coupangExactQaRecoveryIdentity,
  type CoupangExactQaRecoveryBinding,
} from "./coupang-exact-qa-recovery";
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

function exactItem(currentValue: unknown) {
  const current = recordValue(currentValue);
  const items = Array.isArray(current.items) ? current.items.map(recordValue) : [];
  if (String(current.sellerProductId ?? "") !== coupangExactQaRecoveryIdentity.sellerProductId
      || items.length !== 1
      || String(items[0].vendorItemId ?? "") !== coupangExactQaRecoveryIdentity.vendorItemId
      || String(items[0].externalVendorSku ?? "") !== coupangExactQaRecoveryIdentity.sellerSku
      || String(items[0].modelNo ?? "") !== coupangExactQaRecoveryIdentity.sellerSku) {
    throw new Error("COUPANG_EXACT_QA_REMOTE_IDENTITY_MISMATCH");
  }
  return { current, item: items[0] };
}

function exactDetailImageUrls(contentsValue: unknown) {
  if (!Array.isArray(contentsValue)) return [];
  return contentsValue.flatMap((contentValue) => {
    const content = recordValue(contentValue);
    if (content.contentsType !== "IMAGE" || !Array.isArray(content.contentDetails)) return [];
    return content.contentDetails.flatMap((detailValue) => {
      const detail = recordValue(detailValue);
      const url = detail.detailType === "IMAGE" ? String(detail.content ?? "").trim() : "";
      return url ? [url] : [];
    });
  });
}

function strictAttributes(value: unknown) {
  const source = Array.isArray(value) ? value.map(recordValue) : [];
  const withoutColor = source.filter((attribute) =>
    !["색상", "색깔", "Color"].includes(String(attribute.attributeTypeName ?? "").trim()));
  return [
    ...withoutColor,
    { attributeTypeName: "색상", attributeValueName: coupangExactQaRecoveryIdentity.color },
  ];
}

export function prepareCoupangExactQaRecoveryArguments(
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  const binding = coupangExactQaRecoveryBinding(argumentsValue, "listing.update");
  if (!binding) throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
  const body = structuredClone(recordValue(argumentsValue.body));
  const items = Array.isArray(body.items) ? body.items.map(recordValue) : [];
  if (String(body.sellerProductId ?? "") !== binding.sellerProductId || items.length !== 1) {
    throw new Error("COUPANG_EXACT_QA_PATCH_IDENTITY_MISMATCH");
  }
  const item = items[0];
  const details = exactDetailImageUrls(item.contents);
  if (details.length !== 8 || new Set(details).size !== 8) {
    throw new Error("COUPANG_EXACT_QA_BUYER_CONTENT_IMAGES_REQUIRED");
  }

  return {
    ...argumentsValue,
    sellerpilotCoupangNoticeCategory: coupangExactQaRecoveryIdentity.noticeCategoryName,
    facts: {
      ...recordValue(argumentsValue.facts),
      color: coupangExactQaRecoveryIdentity.color,
      brandName: coupangExactQaRecoveryIdentity.brand,
      manufacturer: coupangExactQaRecoveryIdentity.manufacturer,
      countryOfOrigin: coupangExactQaRecoveryIdentity.countryOfOriginName,
      countryOfOriginCode: coupangExactQaRecoveryIdentity.countryOfOriginCode,
    },
    body: {
      ...body,
      sellerProductId: Number(coupangExactQaRecoveryIdentity.sellerProductId),
      displayCategoryCode: coupangExactQaRecoveryIdentity.displayCategoryCode,
      sellerProductName: "부착형 케이블 정리 클립 6개 세트",
      displayProductName: "부착형 케이블 정리 클립 6개 세트",
      brand: coupangExactQaRecoveryIdentity.brand,
      manufacture: coupangExactQaRecoveryIdentity.manufacturer,
      generalProductName: "케이블 정리소품",
      items: [{
        ...item,
        sellerpilotItemMatchId: coupangExactQaRecoveryIdentity.vendorItemId,
        itemName: "부착형 케이블 정리 클립 검정색 6개",
        modelNo: coupangExactQaRecoveryIdentity.sellerSku,
        attributes: strictAttributes(item.attributes),
        notices: [],
      }],
    },
  };
}

export function assertCoupangExactQaCurrentProduct(
  currentValue: unknown,
  binding: CoupangExactQaRecoveryBinding,
) {
  if (binding.phase !== "listing.update" && binding.phase !== "listing.stop") {
    throw new Error("COUPANG_EXACT_QA_RECOVERY_PHASE_INVALID");
  }
  return exactItem(currentValue);
}

export function assertCoupangExactQaUpdateReadback(
  currentValue: unknown,
  binding: CoupangExactQaRecoveryBinding,
) {
  const { current, item } = assertCoupangExactQaCurrentProduct(currentValue, binding);
  const attributes = Array.isArray(item.attributes) ? item.attributes.map(recordValue) : [];
  const notices = Array.isArray(item.notices) ? item.notices.map(recordValue) : [];
  const details = exactDetailImageUrls(item.contents);
  const noticeText = JSON.stringify(notices);
  const noticeCategories = new Set(notices.map((notice) => String(notice.noticeCategoryName ?? "").trim()));
  if (Number(current.displayCategoryCode) !== coupangExactQaRecoveryIdentity.displayCategoryCode
      || current.brand !== coupangExactQaRecoveryIdentity.brand
      || current.manufacture !== coupangExactQaRecoveryIdentity.manufacturer
      || /화이트|white/iu.test(String(current.sellerProductName ?? ""))
      || /화이트|white/iu.test(String(item.itemName ?? ""))
      || !attributes.some((attribute) =>
        String(attribute.attributeTypeName ?? "").trim() === "색상"
        && String(attribute.attributeValueName ?? "").trim() === coupangExactQaRecoveryIdentity.color)
      || details.length !== 8
      || new Set(details).size !== 8
      || notices.length === 0
      || noticeCategories.size !== 1
      || !noticeCategories.has(coupangExactQaRecoveryIdentity.noticeCategoryName)
      || !noticeText.includes(coupangExactQaRecoveryIdentity.countryOfOriginName)
      || !noticeText.includes(coupangExactQaRecoveryIdentity.manufacturer)) {
    throw new Error("COUPANG_EXACT_QA_UPDATE_READBACK_MISMATCH");
  }
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
