import { marketplaceChannelDetailImageCount } from "./marketplace-image-contract";
import { sha256HexUtf8 } from "../sha256-portable";
import {
  temuExactExistingUpdateArgument,
  temuExactExistingUpdateContract,
  temuExactExistingUpdateIdentity,
  temuExactPreservedAssetsArgument,
  temuExactPreservedAssetsContract,
} from "./temu-existing-update-shared";

export {
  temuExactExistingUpdateArgument,
  temuExactExistingUpdateCandidate,
  temuExactExistingUpdateContract,
  temuExactExistingUpdateIdentity,
  temuExactPreservedAssetsArgument,
  temuExactPreservedAssetsContract,
} from "./temu-existing-update-shared";

type UnknownRecord = Record<string, unknown>;

export type TemuExactExistingUpdateBinding = {
  contract: typeof temuExactExistingUpdateContract;
  productId: typeof temuExactExistingUpdateIdentity.productId;
  listingId: string;
  credentialId: string;
  goodsId: typeof temuExactExistingUpdateIdentity.goodsId;
  skuId: typeof temuExactExistingUpdateIdentity.skuId;
  externalGoodsId: string;
  externalSkuId: string;
  sellerAccountKey: string;
  approvedManifestDigest: string;
  releaseSha: string;
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function exactUuid(value: unknown) {
  const text = exactText(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text)
    ? text
    : "";
}

function exactExternalId(value: unknown) {
  const text = exactText(value);
  return text && text.length <= 128 && !/\p{Cc}/u.test(text) ? text : "";
}

function exactContent(value: unknown, max: number) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  const text = value.normalize("NFC");
  return text.length > 0 && text.length <= max && !/\p{Cc}/u.test(text)
    ? text
    : "";
}

function exactStringArray(value: unknown, maxEntries: number, maxEntryLength: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxEntries) return null;
  const values = value.map((entry) => exactContent(entry, maxEntryLength));
  return values.every(Boolean) && new Set(values).size === values.length ? values : null;
}

function exactImageArray(value: unknown, expectedCount: number) {
  if (!Array.isArray(value) || value.length !== expectedCount) return null;
  const values = value.map((entry) => exactText(entry));
  return values.every((url) => /^https:\/\/[^\s]+$/u.test(url))
      && new Set(values).size === expectedCount
    ? values
    : null;
}

function contentLooksKorean(value: string) {
  return /[가-힣]/u.test(value)
    && !/(?:unknown|tbd|n\/?a|미확인|확인\s*필요)/iu.test(value);
}

function normalizedAssetIdentity(value: unknown) {
  const publicUrl = exactText(value);
  try {
    const url = new URL(publicUrl);
    const match = decodeURIComponent(url.pathname).match(
      /(?:^|\/)(normalized\/([0-9a-f]{2})\/([0-9a-f]{64})\.jpg)$/u,
    );
    if (url.protocol !== "https:" || url.username || url.password
        || !match || match[2] !== match[3].slice(0, 2)) return null;
    return { publicUrl, objectPath: match[1], contentSha256: match[3] };
  } catch {
    return null;
  }
}

function preservedAssetEvidence(argumentsValue: Record<string, unknown>) {
  const body = recordValue(argumentsValue.body);
  const goodsBasic = recordValue(body.goodsBasic);
  const representativeUrls = exactImageArray(goodsBasic.goodsCarouselImage, 1);
  const detailUrls = exactImageArray(goodsBasic.detailImage, marketplaceChannelDetailImageCount);
  const publication = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const approved = Array.isArray(publication.approvedDetailImages)
    ? publication.approvedDetailImages.map(recordValue)
    : [];
  const transport = Array.isArray(publication.providerTransportImages)
    ? publication.providerTransportImages.map(recordValue)
    : [];
  const representative = representativeUrls ? normalizedAssetIdentity(representativeUrls[0]) : null;
  if (!representative || !detailUrls
      || publication.contract !== "sellerpilot_publication_asset_binding_v1"
      || publication.providerImageSurface !== "detail_content"
      || approved.length !== marketplaceChannelDetailImageCount
      || transport.length !== marketplaceChannelDetailImageCount) return null;
  const details = detailUrls.map((publicUrl, index) => {
    const approvedImage = approved[index];
    const transportImage = transport[index];
    const normalized = normalizedAssetIdentity(publicUrl);
    const role = exactText(approvedImage.role);
    const approvedObjectPath = exactText(approvedImage.approvedObjectPath);
    const approvedSourceSha256 = exactText(approvedImage.approvedSourceSha256);
    if (!normalized || !role || role !== exactText(transportImage.role)
        || publicUrl !== exactText(approvedImage.publicUrl)
        || publicUrl !== exactText(transportImage.publicUrl)
        || normalized.objectPath !== exactText(approvedImage.objectPath)
        || normalized.objectPath !== exactText(transportImage.objectPath)
        || normalized.contentSha256 !== exactText(approvedImage.contentSha256)
        || normalized.contentSha256 !== exactText(transportImage.contentSha256)
        || !/^results\/[0-9a-f-]+\/claims\/[0-9a-f-]+\/[^/]+\.png$/iu.test(approvedObjectPath)
        || !/^[a-f0-9]{64}$/u.test(approvedSourceSha256)) return null;
    return {
      role,
      publicUrl,
      approvedObjectPath,
      approvedSourceSha256,
      objectPath: normalized.objectPath,
      contentSha256: normalized.contentSha256,
    };
  });
  if (details.some((detail) => !detail)
      || new Set(details.map((detail) => detail?.role)).size !== marketplaceChannelDetailImageCount
      || new Set(details.map((detail) => detail?.approvedObjectPath)).size !== marketplaceChannelDetailImageCount
      || new Set(details.map((detail) => detail?.approvedSourceSha256)).size !== marketplaceChannelDetailImageCount
      || new Set(details.map((detail) => detail?.contentSha256)).size !== marketplaceChannelDetailImageCount
      || details.some((detail) => detail?.publicUrl === representative.publicUrl)) return null;
  return {
    contract: temuExactPreservedAssetsContract,
    representativeImage: {
      role: "gallery-representative",
      publicUrl: representative.publicUrl,
      objectPath: representative.objectPath,
      sourceKind: "normalized_output",
      sourceSha256: representative.contentSha256,
      contentSha256: representative.contentSha256,
    },
    detailImages: details,
  };
}

export function bindTemuExactPreservedAssetEvidence(
  argumentsValue: Record<string, unknown>,
) {
  const next = structuredClone(argumentsValue);
  delete next[temuExactPreservedAssetsArgument];
  const evidence = preservedAssetEvidence(next);
  if (evidence) next[temuExactPreservedAssetsArgument] = evidence;
  return next;
}

function exactContentDigest(goodsName: string, goodsDesc: string, bulletPoints: string[]) {
  return sha256HexUtf8(
    `${goodsName}\u001f${goodsDesc}\u001f${bulletPoints.join("\u001e")}`,
  );
}

export function temuExactExistingUpdateBindingValue(value: unknown) {
  const marker = recordValue(value);
  const expectedKeys = [
    "approvedManifestDigest",
    "contract",
    "credentialId",
    "externalGoodsId",
    "externalSkuId",
    "goodsId",
    "listingId",
    "productId",
    "releaseSha",
    "sellerAccountKey",
    "skuId",
  ].sort();
  const keys = Object.keys(marker).sort();
  const binding = {
    contract: marker.contract,
    productId: exactUuid(marker.productId),
    listingId: exactUuid(marker.listingId),
    credentialId: exactUuid(marker.credentialId),
    goodsId: exactText(marker.goodsId),
    skuId: exactText(marker.skuId),
    externalGoodsId: exactExternalId(marker.externalGoodsId),
    externalSkuId: exactExternalId(marker.externalSkuId),
    sellerAccountKey: exactText(marker.sellerAccountKey),
    approvedManifestDigest: exactText(marker.approvedManifestDigest),
    releaseSha: exactText(marker.releaseSha),
  };
  if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])
      || binding.contract !== temuExactExistingUpdateContract
      || binding.productId !== temuExactExistingUpdateIdentity.productId
      || !binding.listingId
      || !binding.credentialId
      || binding.goodsId !== temuExactExistingUpdateIdentity.goodsId
      || binding.skuId !== temuExactExistingUpdateIdentity.skuId
      || !binding.externalGoodsId
      || !binding.externalSkuId
      || !/^[a-f0-9]{64}$/u.test(binding.sellerAccountKey)
      || !/^[a-f0-9]{64}$/u.test(binding.approvedManifestDigest)
      || !/^[a-f0-9]{40}$/u.test(binding.releaseSha)) {
    return null;
  }
  return binding as TemuExactExistingUpdateBinding;
}

export function bindTemuExactExistingUpdateArguments(
  argumentsValue: Record<string, unknown>,
  binding: TemuExactExistingUpdateBinding,
) {
  const sanitized = structuredClone(argumentsValue);
  delete sanitized[temuExactExistingUpdateArgument];
  const body = recordValue(sanitized.body);
  const goodsBasic = recordValue(body.goodsBasic);
  const skuList = Array.isArray(body.skuList) ? body.skuList.map(recordValue) : [];
  const goodsName = exactContent(goodsBasic.goodsName, 500);
  const goodsDesc = exactContent(goodsBasic.goodsDesc, 10_000);
  const bulletPoints = exactStringArray(goodsBasic.bulletPoints, 10, 500);
  const representativeImages = exactImageArray(goodsBasic.goodsCarouselImage, 1);
  const detailImages = exactImageArray(
    goodsBasic.detailImage,
    marketplaceChannelDetailImageCount,
  );
  const sku = skuList.length === 1 ? skuList[0] : {};
  const price = recordValue(recordValue(sku.price).basePrice);
  if ((body.language !== "ko" && body.language !== "ko-KR")
      || !goodsName
      || !goodsDesc
      || !bulletPoints
      || !contentLooksKorean(goodsName)
      || !contentLooksKorean(goodsDesc)
      || !bulletPoints.every(contentLooksKorean)
      || !representativeImages
      || !detailImages
      || detailImages.includes(representativeImages[0])
      || exactText(sku.externalSkuId) !== binding.externalSkuId
      || exactText(price.amount) !== String(temuExactExistingUpdateIdentity.price)
      || exactText(price.currency).toUpperCase() !== temuExactExistingUpdateIdentity.currency
      || Number(sku.quantity) !== temuExactExistingUpdateIdentity.stock
      ) {
    throw new Error("TEMU_EXACT_EXISTING_UPDATE_ARGUMENTS_INVALID");
  }
  const contentDigest = exactContentDigest(goodsName, goodsDesc, bulletPoints);
  return bindTemuExactPreservedAssetEvidence({
    ...sanitized,
    goodsId: binding.goodsId,
    externalGoodsId: binding.externalGoodsId,
    body: {
      language: "ko",
      goodsBasic: {
        externalGoodsId: binding.externalGoodsId,
        goodsName,
        goodsDesc,
        bulletPoints,
        goodsCarouselImage: representativeImages,
        detailImage: detailImages,
      },
      skuList: [{
        externalSkuId: binding.externalSkuId,
        price: { basePrice: { amount: String(temuExactExistingUpdateIdentity.price), currency: "KRW" } },
        quantity: temuExactExistingUpdateIdentity.stock,
      }],
    },
    sellerpilotTemuPartialUpdate: {
      operation: temuExactExistingUpdateIdentity.providerOperation,
      mutableFields: ["goodsName", "goodsDesc", "bulletPoints"],
      contentDigest,
    },
    [temuExactExistingUpdateArgument]: structuredClone(binding),
  });
}

export function temuExactExistingUpdateRequest(argumentsValue: Record<string, unknown>) {
  const binding = temuExactExistingUpdateBindingValue(
    argumentsValue[temuExactExistingUpdateArgument],
  );
  const partial = recordValue(argumentsValue.sellerpilotTemuPartialUpdate);
  const preservedAssets = preservedAssetEvidence(argumentsValue);
  const preservedMarker = recordValue(argumentsValue[temuExactPreservedAssetsArgument]);
  const body = recordValue(argumentsValue.body);
  const goodsBasic = recordValue(body.goodsBasic);
  const bulletPoints = exactStringArray(goodsBasic.bulletPoints, 10, 500);
  const goodsName = exactContent(goodsBasic.goodsName, 500);
  const goodsDesc = exactContent(goodsBasic.goodsDesc, 10_000);
  const representativeImages = exactImageArray(goodsBasic.goodsCarouselImage, 1);
  const detailImages = exactImageArray(
    goodsBasic.detailImage,
    marketplaceChannelDetailImageCount,
  );
  const skuList = Array.isArray(body.skuList) ? body.skuList.map(recordValue) : [];
  const sku = skuList.length === 1 ? skuList[0] : {};
  const price = recordValue(recordValue(sku.price).basePrice);
  const mutableFields = Array.isArray(partial.mutableFields)
    ? partial.mutableFields.map(exactText)
    : [];
  const contentDigest = exactContentDigest(goodsName, goodsDesc, bulletPoints ?? []);
  if (!binding
      || partial.operation !== temuExactExistingUpdateIdentity.providerOperation
      || mutableFields.join("\u001f") !== "goodsName\u001fgoodsDesc\u001fbulletPoints"
      || partial.contentDigest !== contentDigest
      || !goodsName
      || !goodsDesc
      || !bulletPoints
      || !contentLooksKorean(goodsName)
      || !contentLooksKorean(goodsDesc)
      || !bulletPoints.every(contentLooksKorean)
      || !preservedAssets
      || JSON.stringify(preservedMarker) !== JSON.stringify(preservedAssets)
      || (body.language !== "ko" && body.language !== "ko-KR")
      || exactText(goodsBasic.externalGoodsId) !== binding.externalGoodsId
      || !representativeImages
      || !detailImages
      || detailImages.includes(representativeImages[0])
      || exactText(sku.externalSkuId) !== binding.externalSkuId
      || exactText(price.amount) !== String(temuExactExistingUpdateIdentity.price)
      || exactText(price.currency).toUpperCase() !== temuExactExistingUpdateIdentity.currency
      || Number(sku.quantity) !== temuExactExistingUpdateIdentity.stock
      || exactText(argumentsValue.goodsId) !== binding.goodsId
      || exactText(argumentsValue.externalGoodsId) !== binding.externalGoodsId) {
    return null;
  }
  return {
    binding,
    providerArguments: {
      goodsId: binding.goodsId,
      goodsName,
      goodsDesc,
      bulletPoints,
    },
    expectedRepresentativeImages: representativeImages,
    expectedDetailImages: detailImages,
    expectedSkus: [{
      skuId: binding.skuId,
      externalSkuId: binding.externalSkuId,
      quantity: temuExactExistingUpdateIdentity.stock,
      basePrice: { amount: String(temuExactExistingUpdateIdentity.price), currency: "KRW" },
    }],
  };
}
