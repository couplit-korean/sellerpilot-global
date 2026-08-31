export const coupangExactQaRecoveryContract =
  "coupang_exact_qa_recovery_v1" as const;

export const coupangExactQaRecoveryArgument =
  "sellerpilotCoupangExactQaRecovery" as const;

export const coupangExactQaRecoveryIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "7ffc6e46-3173-4695-9889-5fa1529765f1",
  sellerProductId: "16356981734",
  vendorItemId: "95962393877",
  sellerSku: "QA-20260823-CC-001",
  locale: "ko-KR",
  currency: "KRW",
  priceKrw: 5_000,
  stock: 1,
  representativeImageCount: 1,
  detailImageCount: 8,
  displayCategoryCode: 64574,
  sellerProductName: "부착형 케이블 정리 클립 6개 세트",
  itemName: "부착형 케이블 정리 클립 검정색 6개",
  color: "검정색",
  brand: "No Brand",
  manufacturer: "Generic OEM",
  countryOfOriginCode: "CN",
  countryOfOriginName: "중국",
  noticeCategoryName: "기타 재화",
});

export type CoupangExactQaRecoveryPhase = "listing.update" | "listing.stop";

export type CoupangExactQaRecoveryBinding = {
  contract: typeof coupangExactQaRecoveryContract;
  phase: CoupangExactQaRecoveryPhase;
  productId: string;
  listingId: string;
  sellerProductId: string;
  vendorItemId: string;
  sellerSku: string;
  sellerAccountLineage: "validated_by_service_rpc";
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
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

/**
 * Coupang exposes one representative plus eight detail gallery positions for
 * this exact recovery. The eight approved detail assets are also carried in
 * buyer content; additional first-stage gallery variants must not displace
 * them from the exact outbound gallery.
 */
export function buildCoupangExactQaGalleryImages(
  galleryValue: unknown,
  detailValue: unknown,
) {
  const gallery = uniqueHttpsUrls(galleryValue);
  const details = uniqueHttpsUrls(detailValue);
  if (details.length !== coupangExactQaRecoveryIdentity.detailImageCount) return null;
  const representative = gallery.find((url) => !details.includes(url));
  if (!representative) return null;
  return [representative, ...details].map((vendorPath, imageOrder) => ({
    imageOrder,
    imageType: imageOrder === 0 ? "REPRESENTATION" : "DETAIL",
    vendorPath,
  }));
}

function exactBoundDetailUrls(argumentsValue: Record<string, unknown>) {
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const transport = Array.isArray(binding?.providerTransportImages)
    ? binding.providerTransportImages.map(recordValue)
    : [];
  if (binding?.contract !== "sellerpilot_publication_asset_binding_v1"
      || binding.providerImageSurface !== "detail_content"
      || transport.some((image) => !image)
      || transport.length !== coupangExactQaRecoveryIdentity.detailImageCount) {
    return [];
  }
  return uniqueHttpsUrls(transport.map((image) => image?.publicUrl));
}

export function coupangExactQaRecoveryBindingValue(
  value: unknown,
  phase?: CoupangExactQaRecoveryPhase,
): CoupangExactQaRecoveryBinding | null {
  const binding = recordValue(value);
  if (!binding
      || binding.contract !== coupangExactQaRecoveryContract
      || (binding.phase !== "listing.update" && binding.phase !== "listing.stop")
      || (phase && binding.phase !== phase)
      || binding.productId !== coupangExactQaRecoveryIdentity.productId
      || binding.listingId !== coupangExactQaRecoveryIdentity.listingId
      || String(binding.sellerProductId ?? "") !== coupangExactQaRecoveryIdentity.sellerProductId
      || String(binding.vendorItemId ?? "") !== coupangExactQaRecoveryIdentity.vendorItemId
      || binding.sellerSku !== coupangExactQaRecoveryIdentity.sellerSku
      || binding.sellerAccountLineage !== "validated_by_service_rpc") {
    return null;
  }
  return binding as CoupangExactQaRecoveryBinding;
}

export function coupangExactQaRecoveryBinding(
  argumentsValue: Record<string, unknown>,
  phase?: CoupangExactQaRecoveryPhase,
) {
  return coupangExactQaRecoveryBindingValue(
    argumentsValue[coupangExactQaRecoveryArgument],
    phase,
  );
}

export function bindCoupangExactQaRecoveryArguments(
  argumentsValue: Record<string, unknown>,
  phase: CoupangExactQaRecoveryPhase,
) {
  const binding: CoupangExactQaRecoveryBinding = {
    contract: coupangExactQaRecoveryContract,
    phase,
    productId: coupangExactQaRecoveryIdentity.productId,
    listingId: coupangExactQaRecoveryIdentity.listingId,
    sellerProductId: coupangExactQaRecoveryIdentity.sellerProductId,
    vendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
    sellerSku: coupangExactQaRecoveryIdentity.sellerSku,
    sellerAccountLineage: "validated_by_service_rpc",
  };
  return {
    ...argumentsValue,
    [coupangExactQaRecoveryArgument]: binding,
  };
}

export function assertCoupangExactQaProviderContract(
  argumentsValue: Record<string, unknown>,
  phase: CoupangExactQaRecoveryPhase,
  options: { sanitizedUpdate?: boolean } = {},
) {
  const binding = coupangExactQaRecoveryBinding(argumentsValue, phase);
  if (!binding) {
    throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
  }

  if (phase === "listing.update") {
    const body = recordValue(argumentsValue.body);
    const items = Array.isArray(body?.items) ? body.items.map(recordValue) : [];
    const item = items.length === 1 ? items[0] : null;
    const boundDetails = exactBoundDetailUrls(argumentsValue);
    const mismatches = [
      ...(String(body?.sellerProductId ?? "") === binding.sellerProductId ? [] : ["sellerProductId"]),
      ...(argumentsValue.publicationIntent === "live" ? [] : ["publicationIntent"]),
      ...(argumentsValue.publicationStateContract === "verified_remote_state_v1" ? [] : ["publicationStateContract"]),
      ...(argumentsValue.publicationExpectedLocale === coupangExactQaRecoveryIdentity.locale ? [] : ["publicationExpectedLocale"]),
      ...(/^[a-f0-9]{64}$/u.test(exactText(argumentsValue.publicationExpectedFingerprint)) ? [] : ["publicationExpectedFingerprint"]),
      ...(argumentsValue.publicationExpectedImageCount === coupangExactQaRecoveryIdentity.detailImageCount ? [] : ["publicationExpectedImageCount"]),
      ...(item ? [] : ["item"]),
      ...(item && (options.sanitizedUpdate
        ? exactText(item.sellerpilotItemMatchId) === binding.vendorItemId
        : exactText(item.externalVendorSku) === binding.sellerSku) ? [] : ["externalVendorSku"]),
      ...(item && exactText(item.modelNo) === binding.sellerSku ? [] : ["modelNo"]),
      ...(options.sanitizedUpdate || (item && Number(item.originalPrice) === coupangExactQaRecoveryIdentity.priceKrw) ? [] : ["originalPrice"]),
      ...(options.sanitizedUpdate || (item && Number(item.salePrice) === coupangExactQaRecoveryIdentity.priceKrw) ? [] : ["salePrice"]),
      ...(options.sanitizedUpdate || (item && Number(item.maximumBuyCount) === coupangExactQaRecoveryIdentity.stock) ? [] : ["maximumBuyCount"]),
      ...(options.sanitizedUpdate || boundDetails.length === coupangExactQaRecoveryIdentity.detailImageCount ? [] : ["sellerpilotPublicationAssetBinding"]),
    ];
    if (mismatches.length) {
      throw new Error(`COUPANG_EXACT_QA_PROVIDER_CONTRACT_MISMATCH:${mismatches.join(",")}`);
    }
  } else if (String(argumentsValue.sellerProductId ?? "") !== binding.sellerProductId
      || String(argumentsValue.vendorItemId ?? "") !== binding.vendorItemId
      || argumentsValue.sellerSku !== binding.sellerSku
      || argumentsValue.publicationExpectedImageCount !== 0) {
    throw new Error("COUPANG_EXACT_QA_PROVIDER_CONTRACT_MISMATCH");
  }

  return binding;
}

export function coupangExactQaCreateForbidden(input: {
  productId?: string | null;
  argumentsValue?: Record<string, unknown> | null;
}) {
  if (input.productId === coupangExactQaRecoveryIdentity.productId) return true;
  const argumentsValue = input.argumentsValue ?? {};
  const body = recordValue(argumentsValue.body);
  const items = Array.isArray(body?.items)
    ? body.items.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return String(argumentsValue.resumeRemoteId ?? "") === coupangExactQaRecoveryIdentity.sellerProductId
    || String(body?.sellerProductId ?? "") === coupangExactQaRecoveryIdentity.sellerProductId
    || items.some((item) => [item.externalVendorSku, item.modelNo]
      .some((value) => value === coupangExactQaRecoveryIdentity.sellerSku));
}

export function coupangExactQaRecoveryCandidate(input: {
  channel: string;
  listingId?: string | null;
  remoteId?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
  failureClass?: string | null;
}) {
  return input.channel === "coupang"
    && input.listingId === coupangExactQaRecoveryIdentity.listingId
    && input.remoteId === coupangExactQaRecoveryIdentity.sellerProductId
    && input.status === "failed"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown"
    && !input.providerStatus
    && !input.publishedAt
    && (!input.failureClass || input.failureClass === "external_action");
}

export function coupangExactQaCentralSkuVerified(value: unknown) {
  const context = recordValue(value);
  const product = recordValue(context?.product);
  const manualFields = recordValue(context?.manualFields);
  const productSku = typeof product?.sku === "string" ? product.sku.trim() : "";
  const manualSku = typeof manualFields?.sellerSku === "string" ? manualFields.sellerSku.trim() : "";
  return (productSku === coupangExactQaRecoveryIdentity.sellerSku
      || manualSku === coupangExactQaRecoveryIdentity.sellerSku)
    && (!productSku || productSku === coupangExactQaRecoveryIdentity.sellerSku)
    && (!manualSku || manualSku === coupangExactQaRecoveryIdentity.sellerSku);
}

export function coupangExactQaNoticeContent(detailNameValue: unknown) {
  const detailName = String(detailNameValue ?? "").replace(/\s+/gu, " ").trim();
  if (!detailName) return null;
  if (/품명|모델명/u.test(detailName)) return "부착형 케이블 정리 클립 6개 세트";
  if (/인증|허가/u.test(detailName)) return "해당사항 없음";
  if (/제조국|원산지/u.test(detailName)) return coupangExactQaRecoveryIdentity.countryOfOriginName;
  if (/제조자|수입자/u.test(detailName)) return coupangExactQaRecoveryIdentity.manufacturer;
  if (/소비자상담|A\/?S|전화번호/u.test(detailName)) return "쿠팡 판매자 문의 이용";
  if (/품질보증/u.test(detailName)) return "관련 법 및 소비자분쟁해결기준에 따름";
  return null;
}
