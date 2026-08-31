import { isDeepStrictEqual } from "node:util";
import {
  assertCoupangExactQaProviderContract,
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

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function strictBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return undefined;
}

function uniqueHttpsUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const urls = value.map(exactText).filter((url) => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  });
  return urls.length === value.length && new Set(urls).size === urls.length
    ? urls
    : [];
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

function exactBoundDetailImageUrls(argumentsValue: Record<string, unknown>) {
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const transport = Array.isArray(binding.providerTransportImages)
    ? binding.providerTransportImages.map(recordValue)
    : [];
  return uniqueHttpsUrls(transport.map((image) => image.publicUrl));
}

function exactGalleryImageUrls(imagesValue: unknown) {
  const images = Array.isArray(imagesValue) ? imagesValue.map(recordValue) : [];
  const expectedCount = coupangExactQaRecoveryIdentity.representativeImageCount
    + coupangExactQaRecoveryIdentity.detailImageCount;
  if (images.length !== expectedCount
      || images.some((image, index) => Number(image.imageOrder) !== index)) return null;
  const representations = images.filter((image) =>
    exactText(image.imageType).toUpperCase() === "REPRESENTATION");
  const details = images.filter((image) =>
    exactText(image.imageType).toUpperCase() === "DETAIL");
  const urls = uniqueHttpsUrls(images.map((image) => image.vendorPath));
  if (representations.length !== coupangExactQaRecoveryIdentity.representativeImageCount
      || details.length !== coupangExactQaRecoveryIdentity.detailImageCount
      || exactText(images[0]?.imageType).toUpperCase() !== "REPRESENTATION"
      || images.slice(1).some((image) => exactText(image.imageType).toUpperCase() !== "DETAIL")
      || urls.length !== expectedCount) return null;
  return {
    representative: urls[0],
    details: urls.slice(1),
  };
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
  const binding = assertCoupangExactQaProviderContract(
    argumentsValue,
    "listing.update",
  );
  const body = structuredClone(recordValue(argumentsValue.body));
  const items = Array.isArray(body.items) ? body.items.map(recordValue) : [];
  if (String(body.sellerProductId ?? "") !== binding.sellerProductId || items.length !== 1) {
    throw new Error("COUPANG_EXACT_QA_PATCH_IDENTITY_MISMATCH");
  }
  const item = items[0];
  const details = exactDetailImageUrls(item.contents);
  const boundDetails = exactBoundDetailImageUrls(argumentsValue);
  const gallery = exactGalleryImageUrls(item.images);
  if (details.length !== coupangExactQaRecoveryIdentity.detailImageCount
      || new Set(details).size !== coupangExactQaRecoveryIdentity.detailImageCount
      || uniqueHttpsUrls(details).length !== coupangExactQaRecoveryIdentity.detailImageCount
      || boundDetails.length !== coupangExactQaRecoveryIdentity.detailImageCount
      || details.some((url, index) => url !== boundDetails[index])) {
    throw new Error("COUPANG_EXACT_QA_BUYER_CONTENT_IMAGES_REQUIRED");
  }
  if (!gallery
      || gallery.details.some((url, index) => url !== boundDetails[index])
      || boundDetails.includes(gallery.representative)) {
    throw new Error("COUPANG_EXACT_QA_GALLERY_IMAGES_REQUIRED");
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
      sellerProductName: coupangExactQaRecoveryIdentity.sellerProductName,
      displayProductName: coupangExactQaRecoveryIdentity.sellerProductName,
      brand: coupangExactQaRecoveryIdentity.brand,
      manufacture: coupangExactQaRecoveryIdentity.manufacturer,
      generalProductName: "케이블 정리소품",
      items: [{
        ...item,
        sellerpilotItemMatchId: coupangExactQaRecoveryIdentity.vendorItemId,
        itemName: coupangExactQaRecoveryIdentity.itemName,
        modelNo: coupangExactQaRecoveryIdentity.sellerSku,
        originalPrice: coupangExactQaRecoveryIdentity.priceKrw,
        salePrice: coupangExactQaRecoveryIdentity.priceKrw,
        maximumBuyCount: coupangExactQaRecoveryIdentity.stock,
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
  const exact = exactItem(currentValue);
  const status = exactText(
    exact.current.statusName
      ?? exact.current.approvalStatus
      ?? exact.current.status,
  ).toUpperCase();
  if (strictBoolean(exact.current.requested) !== true
      || !/(?:부분승인완료|승인완료|PARTIAL_APPROVED|APPROVED)/u.test(status)) {
    throw new Error("COUPANG_EXACT_QA_REMOTE_PUBLICATION_STATE_MISMATCH");
  }
  return exact;
}

export function assertCoupangExactQaInventoryReadback(
  currentValue: unknown,
  binding: CoupangExactQaRecoveryBinding,
) {
  if (binding.phase !== "listing.update") {
    throw new Error("COUPANG_EXACT_QA_RECOVERY_PHASE_INVALID");
  }
  const current = recordValue(currentValue);
  const remoteItemId = exactText(current.vendorItemId ?? current.sellerItemId);
  if (remoteItemId !== binding.vendorItemId
      || Number(current.salePrice) !== coupangExactQaRecoveryIdentity.priceKrw
      || Number(current.amountInStock) !== coupangExactQaRecoveryIdentity.stock
      || strictBoolean(current.onSale) !== true) {
    throw new Error("COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH");
  }
  return current;
}

export function assertCoupangExactQaUpdateReadback(
  currentValue: unknown,
  binding: CoupangExactQaRecoveryBinding,
) {
  const { current, item } = assertCoupangExactQaCurrentProduct(currentValue, binding);
  const attributes = Array.isArray(item.attributes) ? item.attributes.map(recordValue) : [];
  const notices = Array.isArray(item.notices) ? item.notices.map(recordValue) : [];
  const details = exactDetailImageUrls(item.contents);
  const gallery = exactGalleryImageUrls(item.images);
  const displayProductName = exactText(current.displayProductName);
  const noticeText = JSON.stringify(notices);
  const noticeCategories = new Set(notices.map((notice) => String(notice.noticeCategoryName ?? "").trim()));
  if (Number(current.displayCategoryCode) !== coupangExactQaRecoveryIdentity.displayCategoryCode
      || current.sellerProductName !== coupangExactQaRecoveryIdentity.sellerProductName
      || !/[가-힣]/u.test(displayProductName)
      || /화이트|white/iu.test(displayProductName)
      || current.brand !== coupangExactQaRecoveryIdentity.brand
      || current.manufacture !== coupangExactQaRecoveryIdentity.manufacturer
      || item.itemName !== coupangExactQaRecoveryIdentity.itemName
      || Number(item.originalPrice) !== coupangExactQaRecoveryIdentity.priceKrw
      || Number(item.salePrice) !== coupangExactQaRecoveryIdentity.priceKrw
      || Number(item.maximumBuyCount) !== coupangExactQaRecoveryIdentity.stock
      || !attributes.some((attribute) =>
        String(attribute.attributeTypeName ?? "").trim() === "색상"
        && String(attribute.attributeValueName ?? "").trim() === coupangExactQaRecoveryIdentity.color)
      || details.length !== coupangExactQaRecoveryIdentity.detailImageCount
      || new Set(details).size !== coupangExactQaRecoveryIdentity.detailImageCount
      || !gallery
      || gallery.details.some((url, index) => url !== details[index])
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
