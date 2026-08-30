import {
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
} from "./listing-normalization";

type UnknownRecord = Record<string, unknown>;

export const smartstoreDetailImageCount = 8;
export const smartstoreUploadedImageHost = "shop-phinf.pstatic.net";

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

export function smartstoreHtmlImageUrls(value: unknown) {
  const html = typeof value === "string" ? value : "";
  const urls: string[] = [];
  for (const match of html.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu,
  )) {
    const url = String(match[1] ?? match[2] ?? match[3] ?? "")
      .replaceAll("&amp;", "&")
      .trim();
    if (url) urls.push(url);
  }
  return [...new Set(urls)];
}

/**
 * Naver Commerce API confirmed that product-image upload responses use this
 * exact HTTPS host without an explicit port, query, or fragment. Keep this
 * provider boundary strict so a source or signed SellerPilot URL cannot be
 * mistaken for a durable Naver image.
 */
export function strictSmartstoreUploadedImageUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:"
        && url.hostname === smartstoreUploadedImageHost
        && url.port === ""
        && url.username === ""
        && url.password === ""
        && url.search === ""
        && url.hash === ""
        && /^\/.+\.[a-z0-9]+$/iu.test(url.pathname)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export type SmartstoreImageUploadPlan = {
  representativeSourceUrl: string;
  detailSourceUrls: string[];
  sourceUrls: string[];
};

export function smartstoreImageUploadPlan(input: {
  imageUrls: unknown;
  body: unknown;
}): SmartstoreImageUploadPlan {
  const body = recordValue(input.body);
  const originProduct = recordValue(body.originProduct);
  const detailSourceUrls = smartstoreHtmlImageUrls(originProduct.detailContent);
  if (detailSourceUrls.length !== smartstoreDetailImageCount) {
    throw new Error("NAVER_DETAIL_IMAGES_INVALID");
  }
  const detailSet = new Set(detailSourceUrls);
  const representativeSourceUrl = uniqueStrings(input.imageUrls)
    .find((url) => !detailSet.has(url)) ?? "";
  if (!representativeSourceUrl) {
    throw new Error("NAVER_REPRESENTATIVE_IMAGE_MISSING");
  }
  const sourceUrls = [representativeSourceUrl, ...detailSourceUrls];
  if (new Set(sourceUrls).size !== smartstoreDetailImageCount + 1) {
    throw new Error("NAVER_LISTING_IMAGES_INVALID");
  }
  return { representativeSourceUrl, detailSourceUrls, sourceUrls };
}

export function bindSmartstoreUploadedProductImages(input: {
  body: unknown;
  sourceUrls: readonly string[];
  uploadedUrls: readonly string[];
}) {
  if (input.sourceUrls.length !== smartstoreDetailImageCount + 1
      || new Set(input.sourceUrls).size !== smartstoreDetailImageCount + 1
      || input.uploadedUrls.length !== smartstoreDetailImageCount + 1
      || new Set(input.uploadedUrls).size !== smartstoreDetailImageCount + 1
      || input.uploadedUrls.some((url) => !strictSmartstoreUploadedImageUrl(url))) {
    throw new Error("NAVER_IMAGE_UPLOAD_RESPONSE_INVALID");
  }
  const replacements = new Map<string, string>();
  input.sourceUrls.forEach((source, index) => {
    replacements.set(source, input.uploadedUrls[index]);
    const htmlEncodedSource = source.replaceAll("&", "&amp;");
    if (htmlEncodedSource !== source) {
      replacements.set(htmlEncodedSource, input.uploadedUrls[index]);
    }
  });
  const rewrittenBody = replaceMarketplaceImageUrls(
    structuredClone(recordValue(input.body)),
    replacements,
  );
  const body = recordValue(rewrittenBody);
  const originProduct = recordValue(body.originProduct);
  originProduct.images = {
    representativeImage: { url: input.uploadedUrls[0] },
    optionalImages: input.uploadedUrls.slice(1).map((url) => ({ url })),
  };
  body.originProduct = originProduct;

  const rewrittenDetailUrls = smartstoreHtmlImageUrls(originProduct.detailContent);
  if (rewrittenDetailUrls.length !== smartstoreDetailImageCount
      || rewrittenDetailUrls.some((url, index) => url !== input.uploadedUrls[index + 1])
      || input.sourceUrls.some((url) => {
        const detailContent = String(originProduct.detailContent ?? "");
        return detailContent.includes(url)
          || detailContent.includes(url.replaceAll("&", "&amp;"));
      })) {
    throw new Error("NAVER_DETAIL_IMAGE_REWRITE_FAILED");
  }
  return body;
}

export function finalizeSmartstoreListingBody(input: {
  body: unknown;
  operation: "listing.create" | "listing.update";
  publicationIntent: unknown;
  afterServicePhone: string;
}) {
  const body = structuredClone(recordValue(input.body));
  const originProduct = recordValue(body.originProduct);
  if (Object.hasOwn(originProduct, "salePrice")) {
    originProduct.salePrice = normalizeTenWonAmount(originProduct.salePrice);
  }
  if (input.operation === "listing.create") {
    const detailAttribute = recordValue(originProduct.detailAttribute);
    const existingProvidedNotice = recordValue(detailAttribute.productInfoProvidedNotice);
    const existingEtcNotice = recordValue(existingProvidedNotice.etc);
    const productName = String(originProduct.name ?? "상품상세 참조").trim()
      || "상품상세 참조";
    const sellerCodeInfo = recordValue(detailAttribute.sellerCodeInfo);
    const sellerCode = String(sellerCodeInfo.sellerManagementCode ?? productName).trim()
      || productName;
    const providedNotice = String(
      existingProvidedNotice.productInfoProvidedNoticeType ?? "",
    ).trim()
      ? structuredClone(existingProvidedNotice)
      : {
        productInfoProvidedNoticeType: "ETC",
        etc: {
          returnCostReason: "상품상세 참조",
          noRefundReason: "상품상세 참조",
          qualityAssuranceStandard: "상품상세 참조",
          compensationProcedure: "상품상세 참조",
          troubleShootingContents: "상품상세 참조",
          itemName: productName.slice(0, 50),
          modelName: sellerCode.slice(0, 50),
          certificateDetails: "해당사항 없음",
          manufacturer: "상품상세 참조",
          customerServicePhoneNumber: input.afterServicePhone,
        },
      };
    if (providedNotice.productInfoProvidedNoticeType === "ETC") {
      const etc: UnknownRecord = {
        ...existingEtcNotice,
        ...recordValue(providedNotice.etc),
        customerServicePhoneNumber: input.afterServicePhone,
      };
      delete etc.afterServiceDirector;
      providedNotice.etc = etc;
    }
    originProduct.detailAttribute = {
      ...detailAttribute,
      minorPurchasable: typeof detailAttribute.minorPurchasable === "boolean"
        ? detailAttribute.minorPurchasable
        : true,
      productInfoProvidedNotice: providedNotice,
      afterServiceInfo: {
        afterServiceTelephoneNumber: input.afterServicePhone,
        afterServiceGuideContent: "상품 상세 설명과 스마트스토어 판매자 안내를 확인해 주세요.",
      },
    };
  }
  if (input.publicationIntent === "safe_test") originProduct.statusType = "SUSPENSION";
  if (input.publicationIntent === "live") originProduct.statusType = "SALE";
  body.originProduct = originProduct;

  const smartstoreChannelProduct = recordValue(body.smartstoreChannelProduct);
  if (input.operation === "listing.create") {
    smartstoreChannelProduct.naverShoppingRegistration =
      smartstoreChannelProduct.naverShoppingRegistration === true;
  }
  if (input.publicationIntent === "safe_test") {
    smartstoreChannelProduct.channelProductDisplayStatusType = "SUSPENSION";
  } else if (input.publicationIntent === "live") {
    smartstoreChannelProduct.channelProductDisplayStatusType = "ON";
  } else if (input.operation === "listing.create"
      && !["ON", "SUSPENSION"].includes(
        String(smartstoreChannelProduct.channelProductDisplayStatusType),
      )) {
    smartstoreChannelProduct.channelProductDisplayStatusType = "ON";
  }
  body.smartstoreChannelProduct = smartstoreChannelProduct;
  return body;
}

export type SmartstoreReadbackImageProjection = {
  representativeImageUrl: string;
  optionalImageUrls: string[];
  detailImageUrls: string[];
  verified: boolean;
};

export function smartstoreReadbackImageProjection(
  originProductValue: unknown,
): SmartstoreReadbackImageProjection {
  const originProduct = recordValue(originProductValue);
  const images = recordValue(originProduct.images);
  const representativeImageUrl = strictSmartstoreUploadedImageUrl(
    recordValue(images.representativeImage).url,
  );
  const optionalImageUrls = Array.isArray(images.optionalImages)
    ? images.optionalImages
      .map((item) => strictSmartstoreUploadedImageUrl(recordValue(item).url))
      .filter(Boolean)
    : [];
  const detailImageUrls = smartstoreHtmlImageUrls(originProduct.detailContent);
  const providerDetailImageUrls = detailImageUrls
    .map(strictSmartstoreUploadedImageUrl)
    .filter(Boolean);
  const verified = Boolean(representativeImageUrl)
    && optionalImageUrls.length === smartstoreDetailImageCount
    && new Set([representativeImageUrl, ...optionalImageUrls]).size === smartstoreDetailImageCount + 1
    && detailImageUrls.length === smartstoreDetailImageCount
    && providerDetailImageUrls.length === smartstoreDetailImageCount
    && providerDetailImageUrls.every((url, index) => url === optionalImageUrls[index]);
  return {
    representativeImageUrl,
    optionalImageUrls,
    detailImageUrls,
    verified,
  };
}
