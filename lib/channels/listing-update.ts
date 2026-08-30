import type { ActiveChannelKey } from "./catalog";
import {
  elevenstListingUpdatePatchFromProduct,
  elevenstListingUpdateProjection,
} from "./elevenst-listing";

export type ListingUpdateReference = {
  remoteId: string | null;
  status: string;
  publishedAt?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
};

export const productEditFieldKeys = [
  "productName",
  "description",
  "options",
  "saleConfiguration",
  "requiredInformation",
  "images",
  "price",
  "inventory",
] as const;

export type ProductEditFieldKey = (typeof productEditFieldKeys)[number];
export type ProductEditFieldState = "supported" | "partial" | "blocked";
export type ProductEditFieldOperation = "local.update" | "listing.update" | "price.update" | "inventory.update";
export type ProductEditFieldSupport = {
  state: ProductEditFieldState;
  operation: ProductEditFieldOperation;
  writablePaths: string[];
  reason: string;
};

export type ProductEditRemotePlan = {
  state: "verified_remote_update_available" | "verified_partial_remote_update_available" | "manual_external_update_required";
  listingUpdateAvailable: boolean;
  centralWrite: "separate";
  remoteWrite: "not_automatic";
  manualRequired: boolean;
  remotelyWritableFields: ProductEditFieldKey[];
  partiallyWritableFields: ProductEditFieldKey[];
  manualFields: ProductEditFieldKey[];
  message: string;
};

function fieldSupport(
  state: ProductEditFieldState,
  operation: ProductEditFieldOperation,
  writablePaths: readonly string[],
  reason: string,
): ProductEditFieldSupport {
  return { state, operation, writablePaths: [...writablePaths], reason };
}

const blockedRemotePrice = () => fieldSupport(
  "blocked",
  "price.update",
  [],
  "중앙 판매가·통화에는 저장되지만 원격 쓰기 뒤 동일 상품의 통화·가격 readback이 없어 자동 수정을 차단했습니다. 외부 채널은 수동 반영이 필요합니다.",
);

const blockedRemoteOptions = () => fieldSupport(
  "blocked",
  "listing.update",
  [],
  "옵션 ID·SKU별 중앙·원격 매칭 원장이 없어 기존 옵션을 추측해서 수정하지 않습니다. 외부 채널 옵션은 수동 반영이 필요합니다.",
);

const blockedRemoteSaleConfiguration = () => fieldSupport(
  "blocked",
  "listing.update",
  [],
  "1개·1+1 판매구성은 중앙 상품 정보에는 저장되지만 기존 원격 옵션/SKU 구조를 바꾸지 않습니다. 외부 채널은 수동 반영이 필요합니다.",
);

const blockedRemoteContent = (reason: string) => fieldSupport("blocked", "listing.update", [], reason);
const blockedRemoteInventory = (reason: string) => fieldSupport("blocked", "inventory.update", [], reason);

const centralProductEditFields: Record<ProductEditFieldKey, ProductEditFieldSupport> = {
  productName: fieldSupport("supported", "local.update", ["productName"], "중앙 상품명 원장에 저장합니다."),
  description: fieldSupport("supported", "local.update", [
    "researchInput", "description", "productUrl",
  ], "상품 링크·조사 입력, 상품 설명, 원본 URL을 중앙 상품 원장에 저장합니다."),
  options: fieldSupport("blocked", "local.update", [], "현재 중앙 상품 편집 스키마에는 옵션 조합 원장이 없어 임의 옵션을 만들거나 덮어쓰지 않습니다."),
  saleConfiguration: fieldSupport("supported", "local.update", ["packageContents"], "판매구성 1개·1+1 값을 중앙 상품 정보에 저장합니다."),
  requiredInformation: fieldSupport("supported", "local.update", [
    "sellerSku", "categoryHint", "brandName", "manufacturer", "countryOfOrigin", "material", "condition", "gtinStatus", "gtin",
    "weightKg", "packageLengthCm", "packageWidthCm", "packageHeightCm",
    "shippingFeeKrw", "shippingRule", "packagingRule", "imageRightsConfirmed", "productFactsConfirmed",
  ], "등록 때 사용하는 판매자 필수정보·포장·배송·권리 확인값을 중앙 상품 정보에 저장합니다."),
  images: fieldSupport("blocked", "local.update", [], "상품 이미지 교체는 생성 자산·원본 자산의 영구 경로와 역할을 함께 갱신해야 하므로 현재 텍스트 편집 API에서 분리했습니다."),
  price: fieldSupport("supported", "local.update", ["sellingPrice", "currency"], "중앙 판매가와 통화를 저장합니다."),
  inventory: fieldSupport("supported", "local.update", ["stock"], "중앙 실재고를 예약재고보다 낮지 않게 저장합니다."),
};

const verifiedInventoryChannels = new Set<ActiveChannelKey>([
  "qoo10", "shopee", "lazada", "coupang", "smartstore", "temu",
]);

const releasedListingContent: Partial<Record<ActiveChannelKey, Partial<Record<ProductEditFieldKey, ProductEditFieldSupport>>>> = {
  qoo10: {
    productName: fieldSupport("supported", "listing.update", ["params.ItemTitle"], "Qoo10 상품명을 수정하고 ItemCode readback으로 확인합니다."),
    description: fieldSupport("supported", "listing.update", ["params.PromotionName", "params.ItemDescription", "params.Keyword"], "요약·상세 HTML·검색어를 수정하고 상세페이지 readback으로 확인합니다."),
    requiredInformation: fieldSupport("partial", "listing.update", ["params.IndustrialCode", "params.ProductionPlace"], "GTIN과 원산지는 수정하지만 SellerCode·브랜드·옵션 식별값은 변경하지 않습니다."),
    images: fieldSupport("supported", "listing.update", ["params.StandardImage", "params.ItemDescription"], "대표 이미지와 상세 HTML 이미지를 수정하고 실제 상세 이미지 수를 다시 확인합니다."),
  },
  shopee: {
    productName: fieldSupport("supported", "listing.update", ["body.item_name"], "로컬 item_id의 상품명을 수정하고 같은 item_id를 readback합니다."),
    description: fieldSupport("supported", "listing.update", ["body.description"], "로컬 상품 설명을 수정하고 같은 item_id에서 값을 다시 확인합니다."),
    requiredInformation: fieldSupport("partial", "listing.update", ["body.category_id", "body.brand", "body.condition", "body.gtin_code", "body.weight", "body.dimension", "body.attribute_list"], "카테고리·브랜드·상태·GTIN·포장·확정 속성만 수정하며 SKU와 옵션 모델 ID는 변경하지 않습니다."),
    images: fieldSupport("supported", "listing.update", ["body.image"], "영구 이미지 업로드 결과를 로컬 상품에 반영하고 같은 item_id에서 확인합니다."),
  },
  lazada: {
    productName: fieldSupport("supported", "listing.update", ["request.Request.Product.Attributes.name"], "Lazada item_id의 name 속성을 수정하고 같은 item_id를 readback합니다."),
    description: fieldSupport("supported", "listing.update", ["request.Request.Product.Attributes.description", "request.Request.Product.Attributes.short_description"], "상세·요약 설명을 수정하고 상품 속성을 다시 확인합니다."),
    requiredInformation: fieldSupport("partial", "listing.update", ["request.Request.Product.Attributes"], "확정된 상품 속성은 수정하지만 SellerSku·SKU 옵션·포장값은 기존 원격 구조를 보존합니다."),
    images: fieldSupport("supported", "listing.update", ["request.Request.Product.Images"], "상품 이미지를 수정하고 같은 item_id의 Images를 다시 확인합니다."),
  },
  coupang: {
    productName: fieldSupport("supported", "listing.update", ["body.sellerProductName", "body.displayProductName", "body.items[].itemName"], "sellerProductId를 사전 조회한 뒤 상품명 필드를 병합하고 readback합니다."),
    description: fieldSupport("supported", "listing.update", ["body.items[].contents"], "기존 vendor item을 보존하면서 상세 콘텐츠만 병합하고 다시 확인합니다."),
    requiredInformation: fieldSupport("partial", "listing.update", ["body.displayCategoryCode", "body.brand", "body.generalProductName", "body.items[].barcode", "body.items[].modelNo", "body.items[].notices", "body.items[].attributes", "body.items[].certifications"], "카테고리·브랜드·바코드·고시·속성·인증만 수정하며 판매가·수량·배송정책은 기존 값을 보존합니다."),
    images: fieldSupport("supported", "listing.update", ["body.items[].images"], "원격 item을 식별해 이미지를 병합하고 sellerProductId readback으로 확인합니다."),
  },
  smartstore: {
    productName: fieldSupport("supported", "listing.update", ["body.originProduct.name", "body.smartstoreChannelProduct.channelProductName"], "원상품명·채널상품명을 수정하고 originProductNo에서 다시 확인합니다."),
    description: fieldSupport("supported", "listing.update", ["body.originProduct.detailContent"], "상세 HTML만 기존 원상품에 병합하고 readback합니다."),
    requiredInformation: fieldSupport("partial", "listing.update", ["body.originProduct.leafCategoryId", "body.originProduct.detailAttribute.originAreaInfo"], "카테고리와 원산지만 수정하며 판매·노출·배송·A/S 정책은 기존 원격 값을 보존합니다."),
    images: fieldSupport("supported", "listing.update", ["body.originProduct.images"], "대표·추가 이미지를 원상품에 병합하고 originProductNo에서 다시 확인합니다."),
  },
  elevenst: {
    productName: fieldSupport("supported", "listing.update", ["productPatch.prdNm"], "검증된 최초 등록 원본에 상품명만 병합하고 같은 prdNo에서 다시 확인합니다."),
    description: fieldSupport("supported", "listing.update", ["productPatch.htmlDetail"], "검증된 최초 등록 원본에 상세 HTML만 병합하고 같은 prdNo에서 다시 확인합니다."),
    requiredInformation: fieldSupport("partial", "listing.update", ["productPatch.brand", "productPatch.orgnNmVal", "productPatch.prdStatCd", "productPatch.asDetail", "productPatch.rtngExchDetail", "productPatch.ProductNotification"], "브랜드·원산지·상품상태·고시 내용을 수정하되 카테고리·인증·판매·배송 정책은 최초 등록 원본을 그대로 보존합니다."),
    images: fieldSupport("supported", "listing.update", ["productPatch.prdImage01", "productPatch.prdImage02", "productPatch.prdImage03", "productPatch.prdImage04"], "대표·추가 이미지를 최초 등록 원본에 병합하고 같은 prdNo에서 다시 확인합니다."),
  },
};

function cloneFieldMap(source: Record<ProductEditFieldKey, ProductEditFieldSupport>) {
  return Object.fromEntries(productEditFieldKeys.map((key) => [key, {
    ...source[key],
    writablePaths: [...source[key].writablePaths],
  }])) as Record<ProductEditFieldKey, ProductEditFieldSupport>;
}

export function centralProductEditFieldSupport() {
  return cloneFieldMap(centralProductEditFields);
}

export function channelProductEditFieldSupport(channel: ActiveChannelKey) {
  const listingReason = channel === "elevenst"
    ? "중앙 상품 원장 저장값은 유지합니다. 검증된 최초 등록 원본이 없는 기존 상품은 전체 XML을 추측하지 않고 원격 수정을 차단합니다."
    : channel === "temu"
      ? "중앙 상품 원장 저장값은 유지합니다. Temu 판매자별 수정 스키마와 SKU 식별값이 원장에 확정되지 않아 원격 상품 수정을 차단하며 외부 채널 수동 반영이 필요합니다."
      : channel === "ebay"
        ? "중앙 상품 원장 저장값은 유지합니다. eBay offer ID와 SKU가 상품 원장에 함께 보존되지 않아 게시 listing ID만으로 수정하지 않으며 외부 채널 수동 반영이 필요합니다."
        : "중앙 상품 원장 저장값은 유지합니다. 이 채널의 안전한 상품 수정 경로가 출시되지 않아 외부 채널 수동 반영이 필요합니다.";
  const released = releasedListingContent[channel] ?? {};
  const inventory = verifiedInventoryChannels.has(channel)
    ? fieldSupport("supported", "inventory.update", ["quantity"], "정확한 원격 상품을 지정해 수량을 쓰고 같은 상품의 재고를 readback합니다.")
    : blockedRemoteInventory(channel === "ebay"
      ? "게시 listing ID에서 eBay inventory SKU를 추측하지 않으므로 상품 편집의 원격 재고 수정을 차단했습니다."
      : "이 채널은 정확한 상품 식별값과 재고 readback 경로가 확인되지 않았습니다.");
  const result: Record<ProductEditFieldKey, ProductEditFieldSupport> = {
    productName: released.productName ?? blockedRemoteContent(listingReason),
    description: released.description ?? blockedRemoteContent(listingReason),
    options: blockedRemoteOptions(),
    saleConfiguration: blockedRemoteSaleConfiguration(),
    requiredInformation: released.requiredInformation ?? blockedRemoteContent(listingReason),
    images: released.images ?? blockedRemoteContent(listingReason),
    price: blockedRemotePrice(),
    inventory,
  };
  return cloneFieldMap(result);
}

export function productEditRemotePlan(
  channel: ActiveChannelKey,
  listingUpdateAvailable: boolean,
): ProductEditRemotePlan {
  const fields = channelProductEditFieldSupport(channel);
  const remotelyWritableFields = productEditFieldKeys.filter((key) => fields[key].state === "supported");
  const partiallyWritableFields = productEditFieldKeys.filter((key) => fields[key].state === "partial");
  const manualFields = productEditFieldKeys.filter((key) => fields[key].state !== "supported");
  return {
    state: !listingUpdateAvailable
      ? "manual_external_update_required"
      : manualFields.length
        ? "verified_partial_remote_update_available"
        : "verified_remote_update_available",
    listingUpdateAvailable,
    centralWrite: "separate",
    remoteWrite: "not_automatic",
    manualRequired: manualFields.length > 0 || !listingUpdateAvailable,
    remotelyWritableFields,
    partiallyWritableFields,
    manualFields,
    message: listingUpdateAvailable
      ? "중앙 원장 저장과 외부 쓰기는 분리됩니다. 지원 필드는 명시적 확인 후 검증된 원격 수정으로 반영하고, 중앙만·일부 지원 필드는 외부 채널 수동 반영이 필요합니다."
      : "중앙 상품 원장 저장값은 유지되며 이 채널에는 원격 상품 쓰기를 실행하지 않습니다. 외부 채널 수동 반영이 필요합니다.",
  };
}

export function remoteProductEditIdempotencyKey(input: {
  productId: string;
  listingId: string;
  mutationId: string;
}) {
  return `product-edit:${input.productId}:${input.listingId}:${input.mutationId}`;
}

export function listingWriteOperation(listing: ListingUpdateReference | null | undefined): "listing.create" | "listing.update" {
  const hasRemoteIdentity = Boolean(listing?.remoteId?.trim());
  // A remote identifier is an immutable identity fence even when its latest
  // visibility readback is stale, pending, rejected, or otherwise blocked.
  // The workbench decides whether the row may be acted on; this selector must
  // never turn an existing remote product into a second create attempt.
  return hasRemoteIdentity ? "listing.update" : "listing.create";
}

function listingHasVerifiedUpdateIdentity(listing: ListingUpdateReference) {
  const hasRemoteIdentity = Boolean(listing.remoteId?.trim());
  const hasPublishedAt = Boolean(listing.publishedAt?.trim());
  const hasVerifiedSafeIdentity = listing.requestedPublicationIntent === "safe_test"
    && (listing.remoteVisibility === "non_public" || listing.remoteVisibility === "withdrawn")
    && (listing.status === "paused" || listing.status === "failed")
    && !hasPublishedAt;
  const hasVerifiedLiveIdentity = listing.requestedPublicationIntent === "live"
    && listing.remoteVisibility === "live"
    && (listing.status === "published" || listing.status === "failed")
    && hasPublishedAt;
  return hasRemoteIdentity && (hasVerifiedSafeIdentity || hasVerifiedLiveIdentity);
}

export type ListingCoreContent = {
  title: string;
  shortDescription: string;
  description: string;
};

export function listingCoreContentForOperation(input: {
  operation: "listing.create" | "listing.update";
  central: { title: string; description: string };
  localized?: Partial<ListingCoreContent>;
}): ListingCoreContent {
  const centralTitle = input.central.title.trim();
  const centralDescription = input.central.description.trim();
  const description = input.localized?.description?.trim() || centralDescription;
  return {
    title: input.localized?.title?.trim() || centralTitle,
    shortDescription: input.localized?.shortDescription?.trim() || description.slice(0, 500),
    description,
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function definedEntries(source: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.flatMap((key) => Object.hasOwn(source, key) && source[key] !== undefined
    ? [[key, structuredClone(source[key])]]
    : []));
}

function optionalArgument(source: Record<string, unknown>, key: string) {
  return source[key] === undefined ? {} : { [key]: structuredClone(source[key]) };
}

function nonEmptyEntries(source: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(definedEntries(source, keys))
    .filter(([, value]) => typeof value !== "string" || value.trim().length > 0));
}

function identityValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function listingUpdateRemoteIdentity(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>) {
  const params = recordValue(argumentsValue.params);
  const body = recordValue(argumentsValue.body);
  if (channel === "shopee" && (argumentsValue.globalItemId !== undefined || argumentsValue.itemId !== undefined)) {
    throw new Error("SHOPEE_LOCAL_ITEM_ID_REQUIRED");
  }
  const candidates = channel === "qoo10"
    ? [params.ItemCode]
    : channel === "shopee"
      ? [argumentsValue.localItemId, body.item_id]
      : channel === "lazada"
        ? [argumentsValue.itemId]
        : channel === "coupang"
          ? [body.sellerProductId]
          : channel === "smartstore"
            ? [argumentsValue.originProductNo]
            : channel === "elevenst"
              ? [argumentsValue.productNo]
              : channel === "ebay"
                ? [argumentsValue.offerId]
                : [];
  const identities = [...new Set(candidates.map(identityValue).filter(Boolean))];
  if (identities.length !== 1) {
    throw new Error(identities.length ? "LISTING_UPDATE_IDENTITY_MISMATCH" : "LISTING_UPDATE_IDENTITY_REQUIRED");
  }
  return identities[0];
}

function remoteNumberOrText(remoteId: string) {
  return /^\d+$/.test(remoteId) ? Number(remoteId) : remoteId;
}

const qoo10MutableFields = [
  "ItemTitle",
  "PromotionName",
  "IndustrialCode",
  "ProductionPlace",
  "StandardImage",
  "ItemDescription",
  "Keyword",
] as const;

const shopeeMutableFields = [
  "category_id",
  "item_name",
  "description",
  "brand",
  "condition",
  "gtin_code",
  "image",
  "weight",
  "dimension",
  "attribute_list",
] as const;

const coupangMutableProductFields = [
  "displayCategoryCode",
  "sellerProductName",
  "displayProductName",
  "brand",
  "generalProductName",
] as const;

const coupangMutableItemFields = [
  "itemName",
  "barcode",
  "emptyBarcode",
  "emptyBarcodeReason",
  "modelNo",
  "images",
  "notices",
  "attributes",
  "contents",
  "certifications",
] as const;

function safeLazadaProduct(value: unknown) {
  const product = recordValue(value);
  return {
    ...optionalArgument(product, "Attributes"),
    ...optionalArgument(product, "Images"),
  };
}

function safeCoupangItems(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const source = recordValue(item);
      const mutable = definedEntries(source, coupangMutableItemFields);
      const matchId = identityValue(source.sellerpilotItemMatchId)
        || identityValue(source.vendorItemId)
        || identityValue(source.externalVendorSku)
        || identityValue(source.modelNo);
      return Object.keys(mutable).length || matchId
        ? [{ ...mutable, ...(matchId ? { sellerpilotItemMatchId: matchId } : {}) }]
        : [];
    })
    : [];
}

function safeSmartstoreBody(value: unknown) {
  const body = recordValue(value);
  const originProduct = recordValue(body.originProduct);
  const detailAttribute = recordValue(originProduct.detailAttribute);
  const smartstoreChannelProduct = recordValue(body.smartstoreChannelProduct);
  const safeDetailAttribute = definedEntries(detailAttribute, [
    "originAreaInfo",
  ]);
  const safeOriginProduct = {
    ...definedEntries(originProduct, ["leafCategoryId", "name", "detailContent", "images"]),
    ...(Object.keys(safeDetailAttribute).length ? { detailAttribute: safeDetailAttribute } : {}),
  };
  const safeChannelProduct = definedEntries(smartstoreChannelProduct, ["channelProductName"]);
  return {
    ...(Object.keys(safeOriginProduct).length ? { originProduct: safeOriginProduct } : {}),
    ...(Object.keys(safeChannelProduct).length ? { smartstoreChannelProduct: safeChannelProduct } : {}),
  };
}

/**
 * Converts the already validated create draft into the documented update shape.
 * This function does not execute a remote write. The caller must still gate the
 * operation with `channelOperationAvailable` and obtain an explicit write
 * confirmation before sending the result to the channel operation route.
 */
export function prepareListingUpdateArguments(
  channel: ActiveChannelKey,
  createArguments: Record<string, unknown>,
  listing: ListingUpdateReference,
) {
  const remoteId = listing.remoteId?.trim() ?? "";
  // Public callers must pass the verified ledger classifier above. The
  // provider executor also re-normalizes an already authorized update using
  // a minimal published reference, so keep that internal compatibility path
  // identity-only and never use it to select the write operation.
  const authorizedProviderReference = listing.status === "published" && Boolean(remoteId);
  if ((!listingHasVerifiedUpdateIdentity(listing) && !authorizedProviderReference) || !remoteId) {
    throw new Error("PUBLISHED_REMOTE_LISTING_REQUIRED");
  }

  if (channel === "qoo10") {
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      params: { ...nonEmptyEntries(recordValue(createArguments.params), qoo10MutableFields), ItemCode: remoteId },
    };
  }

  if (channel === "shopee") {
    const publish = recordValue(createArguments.publish);
    const publishedItem = recordValue(publish.item);
    const createBody = recordValue(createArguments.body);
    const body = Object.keys(publishedItem).length ? publishedItem : createBody;
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      ...optionalArgument(createArguments, "imageUrls"),
      ...optionalArgument(createArguments, "shopId"),
      ...optionalArgument(createArguments, "country"),
      localItemId: remoteId,
      body: { ...definedEntries(body, shopeeMutableFields), item_id: remoteNumberOrText(remoteId) },
    };
  }

  if (channel === "lazada") {
    const request = recordValue(createArguments.request);
    const requestRoot = recordValue(request.Request);
    const product = safeLazadaProduct(requestRoot.Product);
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      ...optionalArgument(createArguments, "imageUrls"),
      ...optionalArgument(createArguments, "country"),
      itemId: remoteId,
      request: { Request: { Product: product } },
    };
  }

  if (channel === "coupang") {
    const sourceBody = recordValue(createArguments.body);
    const items = safeCoupangItems(sourceBody.items);
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      body: {
        ...definedEntries(sourceBody, coupangMutableProductFields),
        sellerProductId: remoteNumberOrText(remoteId),
        ...(items.length ? { items } : {}),
      },
    };
  }

  if (channel === "smartstore") {
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      ...optionalArgument(createArguments, "imageUrls"),
      originProductNo: remoteId,
      body: safeSmartstoreBody(createArguments.body),
    };
  }

  if (channel === "ebay") {
    const suppliedBody = recordValue(createArguments.body);
    const sourceOffer = Object.keys(suppliedBody).length
      ? suppliedBody
      : recordValue(createArguments.offer);
    if (!Object.keys(sourceOffer).length) throw new Error("EBAY_OFFER_UPDATE_BODY_REQUIRED");
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      ...optionalArgument(createArguments, "sku"),
      offerId: remoteId,
      body: structuredClone(sourceOffer),
    };
  }

  if (channel === "elevenst") {
    const suppliedPatch = recordValue(createArguments.productPatch);
    const suppliedProduct = recordValue(createArguments.product);
    const hasSuppliedPatch = Object.keys(suppliedPatch).length > 0;
    return {
      ...optionalArgument(createArguments, "sellerpilotAssets"),
      ...optionalArgument(createArguments, "sellerpilotSnapshotMutableFingerprint"),
      productNo: remoteId,
      productPatch: hasSuppliedPatch
        ? structuredClone(suppliedPatch)
        : elevenstListingUpdatePatchFromProduct(createArguments.product),
      ...(hasSuppliedPatch && Object.keys(suppliedProduct).length
        ? { product: structuredClone(suppliedProduct) }
        : {}),
    };
  }

  throw new Error(`LISTING_UPDATE_NOT_RELEASED:${channel}`);
}

function htmlComparable(value: string) {
  const imageUrls = [...value.matchAll(/(?:src\s*=\s*["']|src\s*=\s*&quot;)([^"'\s>]+)(?:["']|&quot;)/gi)]
    .map((match) => match[1].replaceAll("&amp;", "&"));
  const text = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { text, imageUrls };
}

function normalizedScalar(value: string | number | boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  const text = String(value).replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (/<[a-z][\s\S]*>/i.test(text)) return htmlComparable(text);
  return text;
}

function normalizedComparable(value: unknown): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return normalizedScalar(value);
  if (Array.isArray(value)) return value.map(normalizedComparable);
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, normalizedComparable(item)]));
}

function canonicalComparableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalComparableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalComparableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stable, representation-normalized input for the server-side SHA-256 that
 * binds an 11st full-overwrite update to the last trusted Product snapshot.
 * The exact GET must yield the same mutable projection before a PUT is sent.
 */
export function elevenstListingUpdateProjectionDigestInput(value: unknown) {
  return canonicalComparableJson(normalizedComparable(elevenstListingUpdateProjection(value)));
}

function subsetMismatches(expectedValue: unknown, actualValue: unknown, path = ""): string[] {
  const expected = normalizedComparable(expectedValue);
  const actual = normalizedComparable(actualValue);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [path || "value"];
    return expected.flatMap((expectedItem, index) => {
      const matched = actual.some((actualItem) => subsetMismatches(expectedItem, actualItem, path).length === 0);
      return matched ? [] : [`${path}[${index}]`];
    });
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return [path || "value"];
    return Object.entries(expected as Record<string, unknown>).flatMap(([key, item]) =>
      subsetMismatches(item, (actual as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  const numericEquivalent = (typeof expected === "number" && typeof actual === "string" && actual.trim() !== "" && Number(actual) === expected)
    || (typeof actual === "number" && typeof expected === "string" && expected.trim() !== "" && Number(expected) === actual);
  return Object.is(expected, actual) || numericEquivalent ? [] : [path || "value"];
}

function firstRecursiveValue(value: unknown, aliases: readonly string[], depth = 0): unknown {
  if (depth > 7 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstRecursiveValue(item, aliases, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const normalizedAliases = aliases.map((item) => item.toLocaleLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const [key, item] of entries) {
    if (normalizedAliases.includes(key.toLocaleLowerCase().replace(/[^a-z0-9]/g, ""))) return item;
  }
  for (const [, item] of entries) {
    const found = firstRecursiveValue(item, aliases, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function qoo10ReadbackProjection(argumentsValue: Record<string, unknown>, remoteData: Record<string, unknown>) {
  const params = recordValue(argumentsValue.params);
  const aliases: Record<string, string[]> = {
    ItemTitle: ["ItemTitle", "GdNm", "item_name"],
    PromotionName: ["PromotionName", "PromotionNm"],
    IndustrialCode: ["IndustrialCode", "barcode", "gtin"],
    ProductionPlace: ["ProductionPlace", "origin", "originCountry"],
    StandardImage: ["StandardImage", "ImageUrl", "mainImage"],
    ItemDescription: ["ItemDetail", "ItemDescription", "description"],
    Keyword: ["Keyword", "keywords"],
  };
  return Object.fromEntries(Object.keys(definedEntries(params, qoo10MutableFields)).map((key) => [
    key,
    firstRecursiveValue(remoteData.ResultObject ?? remoteData, aliases[key] ?? [key]),
  ]));
}

function lazadaComparableImages(value: unknown) {
  const record = recordValue(value);
  return record.Image ?? record.image ?? value;
}

function lazadaReadbackProjection(remoteData: Record<string, unknown>) {
  const data = recordValue(remoteData.data);
  const item = Object.keys(recordValue(data.item)).length ? recordValue(data.item) : data;
  const attributes = Object.keys(recordValue(item.Attributes)).length
    ? recordValue(item.Attributes)
    : Object.keys(recordValue(item.attributes)).length
      ? recordValue(item.attributes)
      : item;
  const images = item.Images ?? item.images ?? data.Images ?? data.images;
  return {
    Attributes: attributes,
    ...(images !== undefined ? { Images: { Image: lazadaComparableImages(images) } } : {}),
  };
}

function expectedListingUpdateProjection(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>) {
  if (channel === "qoo10") return definedEntries(recordValue(argumentsValue.params), qoo10MutableFields);
  if (channel === "shopee") return definedEntries(recordValue(argumentsValue.body), shopeeMutableFields);
  if (channel === "lazada") {
    const product = recordValue(recordValue(recordValue(argumentsValue.request).Request).Product);
    return {
      ...optionalArgument(product, "Attributes"),
      ...(product.Images === undefined ? {} : { Images: { Image: lazadaComparableImages(product.Images) } }),
    };
  }
  if (channel === "coupang") {
    const body = recordValue(argumentsValue.body);
    const items = Array.isArray(body.items)
      ? body.items.map((item) => definedEntries(recordValue(item), coupangMutableItemFields))
      : [];
    return { ...definedEntries(body, coupangMutableProductFields), ...(items.length ? { items } : {}) };
  }
  if (channel === "smartstore") return safeSmartstoreBody(argumentsValue.body);
  if (channel === "elevenst") return recordValue(argumentsValue.productPatch);
  return {};
}

function mutableLeafPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    if (!value.length) return path ? [path] : [];
    return value.flatMap((item, index) => mutableLeafPaths(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => mutableLeafPaths(item, path ? `${path}.${key}` : key));
  }
  return path ? [path] : [];
}

export function listingUpdateMutablePaths(
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
) {
  return mutableLeafPaths(expectedListingUpdateProjection(channel, argumentsValue));
}

function actualListingUpdateProjection(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>, remoteData: Record<string, unknown>) {
  if (channel === "qoo10") return qoo10ReadbackProjection(argumentsValue, remoteData);
  if (channel === "shopee") {
    const response = recordValue(remoteData.response);
    const itemList = Array.isArray(response.item_list) ? response.item_list : [];
    const localItemId = identityValue(argumentsValue.localItemId);
    return recordValue(itemList.find((item) => identityValue(recordValue(item).item_id) === localItemId));
  }
  if (channel === "lazada") return lazadaReadbackProjection(remoteData);
  if (channel === "coupang") return Object.keys(recordValue(remoteData.data)).length ? recordValue(remoteData.data) : remoteData;
  if (channel === "smartstore") return remoteData;
  if (channel === "elevenst") return recordValue(remoteData.product);
  return {};
}

export function verifyListingUpdateReadback(
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
  remoteData: Record<string, unknown>,
) {
  const expected = expectedListingUpdateProjection(channel, argumentsValue);
  const actual = actualListingUpdateProjection(channel, argumentsValue, remoteData);
  const mismatches = subsetMismatches(expected, actual).filter(Boolean);
  return { ok: Object.keys(expected).length > 0 && mismatches.length === 0, mismatches };
}

export function mergeListingUpdatePatch(currentValue: unknown, patchValue: unknown): unknown {
  if (Array.isArray(patchValue)) return structuredClone(patchValue);
  if (!patchValue || typeof patchValue !== "object") return structuredClone(patchValue);
  const current = recordValue(currentValue);
  return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(patchValue as Record<string, unknown>)])]
    .map((key) => {
      const patch = (patchValue as Record<string, unknown>)[key];
      if (patch === undefined) return [key, structuredClone(current[key])];
      const existing = current[key];
      return [key, patch && typeof patch === "object" && !Array.isArray(patch)
        ? mergeListingUpdatePatch(existing, patch)
        : structuredClone(patch)];
    }));
}

export function mergeCoupangListingUpdateBody(currentValue: unknown, patchValue: unknown) {
  const current = recordValue(currentValue);
  const patch = recordValue(patchValue);
  const patchItems = Array.isArray(patch.items) ? patch.items.map(recordValue) : [];
  const currentItems = Array.isArray(current.items) ? current.items.map(recordValue) : [];
  const items = currentItems.map((item, index) => {
    const itemIds = [item.vendorItemId, item.externalVendorSku, item.modelNo].map(identityValue).filter(Boolean);
    const matchingPatch = patchItems.find((candidate, patchIndex) => {
      const matchId = identityValue(candidate.sellerpilotItemMatchId);
      return matchId ? itemIds.includes(matchId) : patchIndex === index;
    });
    if (!matchingPatch) return structuredClone(item);
    const mutablePatch = definedEntries(matchingPatch, coupangMutableItemFields);
    return mergeListingUpdatePatch(item, mutablePatch) as Record<string, unknown>;
  });
  const topPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "items"));
  const merged = mergeListingUpdatePatch(current, topPatch) as Record<string, unknown>;
  if (items.length) merged.items = items;
  return merged;
}
