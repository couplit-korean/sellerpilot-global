import { createHash } from "node:crypto";
import {
  listingPublicationLanguageVerified,
  parseListingPublicationAssetBinding,
} from "./listing-publication-content";
import { shopeeSgExistingAdoptionIdentity } from "./shopee-sg-existing-adoption";

type UnknownRecord = Record<string, unknown>;

export const shopeeSgExistingUpdateArgument =
  "sellerpilotShopeeSgExistingUpdate" as const;
export const shopeeSgExistingUpdateContract =
  "sellerpilot_shopee_sg_existing_update_v1" as const;

export type ShopeeSgExistingUpdatePhase = "content" | "inventory";

type ShopeeSgExistingApprovedAsset = {
  role: string;
  sourceSha256: string;
  contentSha256: string;
};

export type ShopeeSgExistingApprovedAssetEvidence = {
  contract: "sellerpilot_shopee_sg_exact_assets_v1";
  representativeImage: ShopeeSgExistingApprovedAsset & {
    role: "gallery-representative";
  };
  detailImages: ShopeeSgExistingApprovedAsset[];
};

export type ShopeeSgExistingUpdateIdentity = {
  status: "allowed";
  contract: "sellerpilot_shopee_sg_existing_update_identity_v1";
  phase: ShopeeSgExistingUpdatePhase;
  listingId: string;
  productId: string;
  credentialId: string;
  sellerAccountKey: string;
  itemId: string;
  sku: string;
  merchantId: string;
  shopId: string;
  market: "SG";
  locale: "en-SG";
  currency: "SGD";
  priceSgd: number;
  stock: 1;
  providerStatus: "UNLIST";
  adoptionAttestationId: string;
  adoptionGatewayJobId: string;
  adoptionEvidenceDigest: string;
  approvedAssetEvidence: ShopeeSgExistingApprovedAssetEvidence | null;
};

export type ShopeeSgExistingUpdateBinding = Omit<
  ShopeeSgExistingUpdateIdentity,
  "status" | "contract"
> & {
  contract: typeof shopeeSgExistingUpdateContract;
  releaseSha: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
const releasePattern = /^[a-f0-9]{40}$/u;

const bindingKeys = [
  "contract", "phase", "listingId", "productId", "credentialId",
  "sellerAccountKey", "itemId", "sku", "merchantId", "shopId", "market",
  "locale", "currency", "priceSgd", "stock", "providerStatus",
  "adoptionAttestationId", "adoptionGatewayJobId", "adoptionEvidenceDigest",
  "approvedAssetEvidence", "releaseSha",
] as const;

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function exactKeys(value: UnknownRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const ordered = [...expected].sort();
  return actual.length === ordered.length
    && actual.every((key, index) => key === ordered[index]);
}

function uniqueTexts(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(exactText).filter(Boolean))]
    : [];
}

function itemPrice(item: UnknownRecord) {
  const priceRows = Array.isArray(item.price_info)
    ? item.price_info.map(recordValue)
    : [];
  for (const field of ["current_price", "original_price"] as const) {
    const values = [item[field], ...priceRows.map((row) => row[field])]
      .map((value) => Number(exactText(value)))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value * 100) / 100);
    const unique = [...new Set(values)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return null;
  }
  return null;
}

function itemCurrency(item: UnknownRecord) {
  const values = [
    item.currency,
    ...((Array.isArray(item.price_info) ? item.price_info : [])
      .map(recordValue)
      .map((row) => row.currency)),
  ].map(exactText).map((value) => value.toUpperCase()).filter(Boolean);
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : "";
}

function exactRemoteItem(remoteData: UnknownRecord, itemId: string) {
  const response = recordValue(remoteData.response);
  const rows = Array.isArray(response.item_list)
    ? response.item_list.map(recordValue)
    : [];
  const identities = new Set(rows.map((row) => exactText(row.item_id)).filter(Boolean));
  const matches = rows.filter((row) => exactText(row.item_id) === itemId);
  return matches.length === 1 && identities.size === 1 ? matches[0] : null;
}

function itemImageIds(item: UnknownRecord) {
  const image = recordValue(item.image);
  const imageInfo = recordValue(item.image_info);
  return uniqueTexts(
    image.image_id_list
      ?? image.image_url_list
      ?? imageInfo.image_id_list
      ?? imageInfo.image_url_list
      ?? item.image_id_list,
  );
}

function itemAvailableStock(item: UnknownRecord) {
  const stockInfo = recordValue(item.stock_info_v2);
  const summary = recordValue(stockInfo.summary_info);
  const parsed = Number(summary.total_available_stock);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function providerImageIdentityDigest(imageIds: string[]) {
  return createHash("sha256")
    .update(JSON.stringify(imageIds), "utf8")
    .digest("hex");
}

function providerTextIdentityDigest(value: string) {
  return createHash("sha256")
    .update(value.trim(), "utf8")
    .digest("hex");
}

export function shopeeSgExistingContentDigests(argumentsValue: unknown) {
  const body = recordValue(recordValue(argumentsValue).body);
  const title = exactText(body.item_name);
  const description = exactText(body.description);
  if (!title || !description) return null;
  return {
    titleDigest: providerTextIdentityDigest(title),
    descriptionDigest: providerTextIdentityDigest(description),
  };
}

export function shopeeSgExistingApprovedAssetEvidence(
  argumentsValue: unknown,
): ShopeeSgExistingApprovedAssetEvidence | null {
  const argumentsRecord = recordValue(argumentsValue);
  const binding = parseListingPublicationAssetBinding(
    argumentsRecord.sellerpilotPublicationAssetBinding,
  );
  if (!binding
      || binding.providerImageSurface !== "gallery"
      || binding.providerTransportImages.length !== 9
      || binding.providerTransportImages[0]?.role !== "gallery-representative") {
    return null;
  }
  const representative = binding.providerTransportImages[0];
  const transportDetails = binding.providerTransportImages.slice(1);
  if (!representative.approvedObjectPath
      || !digestPattern.test(representative.approvedSourceSha256 ?? "")
      || transportDetails.some((item, index) => (
        item.role !== binding.approvedDetailImages[index]?.role
        || item.contentSha256 !== binding.approvedDetailImages[index]?.contentSha256
      ))) {
    return null;
  }
  const evidence: ShopeeSgExistingApprovedAssetEvidence = {
    contract: "sellerpilot_shopee_sg_exact_assets_v1",
    representativeImage: {
      role: "gallery-representative",
      sourceSha256: representative.approvedSourceSha256!,
      contentSha256: representative.contentSha256,
    },
    detailImages: binding.approvedDetailImages.map((item) => ({
      role: item.role,
      sourceSha256: item.approvedSourceSha256!,
      contentSha256: item.contentSha256,
    })),
  };
  const allSourceDigests = [
    evidence.representativeImage.sourceSha256,
    ...evidence.detailImages.map((item) => item.sourceSha256),
  ];
  const allContentDigests = [
    evidence.representativeImage.contentSha256,
    ...evidence.detailImages.map((item) => item.contentSha256),
  ];
  return evidence.detailImages.length === 8
    && new Set(evidence.detailImages.map((item) => item.role)).size === 8
    && allSourceDigests.every((value) => digestPattern.test(value))
    && allContentDigests.every((value) => digestPattern.test(value))
    && new Set(allSourceDigests).size === 9
    && new Set(allContentDigests).size === 9
    ? evidence
    : null;
}

function exactApprovedAssetEvidence(value: unknown) {
  const record = recordValue(value);
  const representative = recordValue(record.representativeImage);
  const details = Array.isArray(record.detailImages)
    ? record.detailImages.map(recordValue)
    : [];
  const sourceDigests = [
    exactText(representative.sourceSha256),
    ...details.map((item) => exactText(item.sourceSha256)),
  ];
  const contentDigests = [
    exactText(representative.contentSha256),
    ...details.map((item) => exactText(item.contentSha256)),
  ];
  if (!exactKeys(record, ["contract", "representativeImage", "detailImages"])
      || record.contract !== "sellerpilot_shopee_sg_exact_assets_v1"
      || !exactKeys(representative, ["role", "sourceSha256", "contentSha256"])
      || representative.role !== "gallery-representative"
      || !digestPattern.test(exactText(representative.sourceSha256))
      || !digestPattern.test(exactText(representative.contentSha256))
      || details.length !== 8
      || details.some((item) => !exactKeys(item, ["role", "sourceSha256", "contentSha256"])
        || !/^detail-[a-z0-9-]+$/u.test(exactText(item.role))
        || !digestPattern.test(exactText(item.sourceSha256))
        || !digestPattern.test(exactText(item.contentSha256)))
      || new Set(details.map((item) => exactText(item.role))).size !== 8
      || new Set(sourceDigests).size !== 9
      || new Set(contentDigests).size !== 9) {
    return null;
  }
  return value as ShopeeSgExistingApprovedAssetEvidence;
}

export function bindShopeeSgExistingPreparedAssetEvidence(
  argumentsValue: UnknownRecord,
) {
  const binding = shopeeSgExistingUpdateBinding(argumentsValue, "content");
  const evidence = shopeeSgExistingApprovedAssetEvidence(argumentsValue);
  if (!binding || !evidence) {
    throw new Error("SHOPEE_SG_EXISTING_APPROVED_ASSET_EVIDENCE_REQUIRED");
  }
  return {
    ...argumentsValue,
    [shopeeSgExistingUpdateArgument]: {
      ...binding,
      approvedAssetEvidence: evidence,
    },
  };
}

export function shopeeSgExistingUpdateCandidate(input: {
  channel: string;
  operation: string;
  productId?: string;
  remoteId?: string | null;
  marketplaceSku?: string | null;
  market?: string | null;
  targetId?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
}) {
  const identity = shopeeSgExistingAdoptionIdentity;
  return input.channel === "shopee"
    && (input.operation === "listing.update" || input.operation === "inventory.update")
    && input.productId === identity.productId
    && input.remoteId === identity.itemId
    && input.marketplaceSku === identity.sku
    && input.market === identity.market
    && input.targetId === identity.shopId
    && input.status === "paused"
    && input.requestedPublicationIntent === "safe_test"
    && input.remoteVisibility === "non_public"
    && input.providerStatus === "UNLIST"
    && !input.publishedAt;
}

export function shopeeSgExistingCentralProductVerified(value: unknown) {
  const context = recordValue(value);
  const product = recordValue(context.product);
  const manualFields = recordValue(context.manualFields);
  const sku = exactText(manualFields.sellerSku ?? product.sku);
  const stock = Number(manualFields.stock ?? product.on_hand ?? product.onHand);
  return sku === shopeeSgExistingAdoptionIdentity.sku
    && Number.isSafeInteger(stock)
    && stock === 1;
}

export function shopeeSgExistingUpdateIdentity(
  value: unknown,
  phase: ShopeeSgExistingUpdatePhase,
): ShopeeSgExistingUpdateIdentity | null {
  const record = recordValue(value);
  const identity = shopeeSgExistingAdoptionIdentity;
  if (record.status !== "allowed"
      || record.contract !== "sellerpilot_shopee_sg_existing_update_identity_v1"
      || record.phase !== phase
      || !uuidPattern.test(exactText(record.listingId))
      || record.productId !== identity.productId
      || !uuidPattern.test(exactText(record.credentialId))
      || !digestPattern.test(exactText(record.sellerAccountKey))
      || record.itemId !== identity.itemId
      || record.sku !== identity.sku
      || record.merchantId !== identity.merchantId
      || record.shopId !== identity.shopId
      || record.market !== identity.market
      || record.locale !== identity.locale
      || record.currency !== identity.currency
      || typeof record.priceSgd !== "number"
      || record.priceSgd !== identity.priceSgd
      || Number(record.stock) !== 1
      || record.providerStatus !== identity.providerStatus
      || !uuidPattern.test(exactText(record.adoptionAttestationId))
      || !uuidPattern.test(exactText(record.adoptionGatewayJobId))
      || !digestPattern.test(exactText(record.adoptionEvidenceDigest))) {
    return null;
  }
  return record as ShopeeSgExistingUpdateIdentity;
}

export function bindShopeeSgExistingUpdateArguments(input: {
  argumentsValue: UnknownRecord;
  identity: ShopeeSgExistingUpdateIdentity;
  releaseSha: string;
}) {
  if (!releasePattern.test(input.releaseSha)) {
    throw new Error("SHOPEE_SG_EXISTING_UPDATE_RELEASE_INVALID");
  }
  const identity = shopeeSgExistingUpdateIdentity(
    input.identity,
    input.identity.phase,
  );
  if (!identity) throw new Error("SHOPEE_SG_EXISTING_UPDATE_IDENTITY_INVALID");
  const marker: ShopeeSgExistingUpdateBinding = {
    contract: shopeeSgExistingUpdateContract,
    phase: identity.phase,
    listingId: identity.listingId,
    productId: identity.productId,
    credentialId: identity.credentialId,
    sellerAccountKey: identity.sellerAccountKey,
    itemId: identity.itemId,
    sku: identity.sku,
    merchantId: identity.merchantId,
    shopId: identity.shopId,
    market: identity.market,
    locale: identity.locale,
    currency: identity.currency,
    priceSgd: identity.priceSgd,
    stock: 1,
    providerStatus: "UNLIST",
    adoptionAttestationId: identity.adoptionAttestationId,
    adoptionGatewayJobId: identity.adoptionGatewayJobId,
    adoptionEvidenceDigest: identity.adoptionEvidenceDigest,
    approvedAssetEvidence: identity.approvedAssetEvidence,
    releaseSha: input.releaseSha,
  };
  if (identity.phase === "inventory") {
    return {
      [shopeeSgExistingUpdateArgument]: marker,
      shopId: identity.shopId,
      country: "sg",
      itemId: identity.itemId,
      quantity: 1,
    };
  }
  const body = recordValue(input.argumentsValue.body);
  const title = exactText(body.item_name);
  const description = exactText(body.description);
  const assets = recordValue(input.argumentsValue.sellerpilotAssets);
  if (!listingPublicationLanguageVerified("en-SG", title, "title")
      || !listingPublicationLanguageVerified("en-SG", description)
      || !Object.keys(assets).length) {
    throw new Error("SHOPEE_SG_EXISTING_CONTENT_CONTRACT_REQUIRED");
  }
  // The exact existing-item path must never inherit the generic Shopee body.
  // update_item replaces every supplied mutable field, so keep only the two
  // reviewed content fields plus the immutable item id. Approved image lineage
  // is bound later by the server-owned detail manifest workflow.
  return {
    [shopeeSgExistingUpdateArgument]: marker,
    shopId: identity.shopId,
    country: "sg",
    localItemId: identity.itemId,
    sellerpilotAssets: structuredClone(assets),
    body: {
      item_id: Number(identity.itemId),
      item_name: title,
      description,
    },
  };
}

export function shopeeSgExistingUpdateBinding(
  argumentsValue: unknown,
  phase?: ShopeeSgExistingUpdatePhase,
): ShopeeSgExistingUpdateBinding | null {
  const value = recordValue(
    recordValue(argumentsValue)[shopeeSgExistingUpdateArgument],
  );
  const identity = shopeeSgExistingAdoptionIdentity;
  if (!exactKeys(value, bindingKeys)
      || value.contract !== shopeeSgExistingUpdateContract
      || (phase && value.phase !== phase)
      || !["content", "inventory"].includes(exactText(value.phase))
      || !uuidPattern.test(exactText(value.listingId))
      || value.productId !== identity.productId
      || !uuidPattern.test(exactText(value.credentialId))
      || !digestPattern.test(exactText(value.sellerAccountKey))
      || value.itemId !== identity.itemId
      || value.sku !== identity.sku
      || value.merchantId !== identity.merchantId
      || value.shopId !== identity.shopId
      || value.market !== identity.market
      || value.locale !== identity.locale
      || value.currency !== identity.currency
      || typeof value.priceSgd !== "number"
      || value.priceSgd !== identity.priceSgd
      || Number(value.stock) !== 1
      || value.providerStatus !== identity.providerStatus
      || !uuidPattern.test(exactText(value.adoptionAttestationId))
      || !uuidPattern.test(exactText(value.adoptionGatewayJobId))
      || !digestPattern.test(exactText(value.adoptionEvidenceDigest))
      || !releasePattern.test(exactText(value.releaseSha))
      || (value.approvedAssetEvidence !== null
        && !exactApprovedAssetEvidence(value.approvedAssetEvidence))) {
    return null;
  }
  return value as ShopeeSgExistingUpdateBinding;
}

function exactItemCore(
  binding: ShopeeSgExistingUpdateBinding,
  remoteData: UnknownRecord,
) {
  const item = exactRemoteItem(remoteData, binding.itemId);
  const price = item ? itemPrice(item) : null;
  if (!item
      || exactText(item.item_sku) !== binding.sku
      || exactText(item.item_status).toUpperCase() !== "UNLIST"
      || itemCurrency(item) !== "SGD"
      || price === null
      || Math.abs(price - binding.priceSgd) > 0.000_001) {
    return null;
  }
  return item;
}

function credentialMerchantMatches(
  credential: UnknownRecord,
  merchantId: string,
) {
  if (exactText(credential.merchant_id) === merchantId) return true;
  const merchantIds = uniqueTexts(credential.merchant_ids);
  if (merchantIds.includes(merchantId)) return true;
  const targets = Array.isArray(credential.shopee_targets)
    ? credential.shopee_targets.map(recordValue)
    : [];
  return targets.some((target) => (
    target.type === "merchant" && exactText(target.id) === merchantId
  ));
}

export function verifyShopeeSgExistingUpdatePrewrite(input: {
  argumentsValue: UnknownRecord;
  credentialPayload: UnknownRecord;
  shopRemoteData: UnknownRecord;
  itemRemoteData: UnknownRecord;
  phase: ShopeeSgExistingUpdatePhase;
}) {
  const binding = shopeeSgExistingUpdateBinding(input.argumentsValue, input.phase);
  const item = binding ? exactItemCore(binding, input.itemRemoteData) : null;
  const shop = recordValue(input.shopRemoteData.response);
  return Boolean(
    binding
    && item
    && exactText(input.credentialPayload.shop_id) === binding.shopId
    && credentialMerchantMatches(input.credentialPayload, binding.merchantId)
    && exactText(shop.shop_id) === binding.shopId
    && itemImageIds(item).length === 9,
  );
}

export function verifyShopeeSgExistingContentReadback(input: {
  argumentsValue: UnknownRecord;
  remoteData: UnknownRecord;
}) {
  const binding = shopeeSgExistingUpdateBinding(input.argumentsValue, "content");
  const item = binding ? exactItemCore(binding, input.remoteData) : null;
  const body = recordValue(input.argumentsValue.body);
  const title = exactText(body.item_name);
  const description = exactText(body.description);
  const contentDigests = shopeeSgExistingContentDigests(input.argumentsValue);
  const expectedImageIds = uniqueTexts(recordValue(body.image).image_id_list);
  const providerDetailIds = uniqueTexts(
    input.argumentsValue.sellerpilotProviderDetailImageIds,
  );
  const actualImageIds = item ? itemImageIds(item) : [];
  const approvedAssetEvidence = binding
    ? exactApprovedAssetEvidence(binding.approvedAssetEvidence)
    : null;
  if (!binding
      || !item
      || exactText(item.item_name) !== title
      || exactText(item.description) !== description
      || !listingPublicationLanguageVerified("en-SG", title, "title")
      || !listingPublicationLanguageVerified("en-SG", description)
      || !contentDigests
      || expectedImageIds.length !== 9
      || providerDetailIds.length !== 8
      || expectedImageIds.slice(1).some((id, index) => id !== providerDetailIds[index])
      || actualImageIds.length !== 9
      || actualImageIds.some((id, index) => id !== expectedImageIds[index])
      || !approvedAssetEvidence
      || JSON.stringify(approvedAssetEvidence)
        !== JSON.stringify(shopeeSgExistingApprovedAssetEvidence(input.argumentsValue))) {
    return null;
  }
  return {
    contract: "sellerpilot_shopee_sg_existing_content_readback_v1" as const,
    itemId: binding.itemId,
    sku: binding.sku,
    currency: "SGD" as const,
    priceSgd: binding.priceSgd,
    providerStatus: "UNLIST" as const,
    visibility: "non_public" as const,
    providerImageIdentityDigest: providerImageIdentityDigest(actualImageIds),
    titleDigest: contentDigests.titleDigest,
    descriptionDigest: contentDigests.descriptionDigest,
    representativeImageCount: 1 as const,
    detailImageCount: 8 as const,
    titleLanguageVerified: true as const,
    descriptionLanguageVerified: true as const,
    approvedAssetEvidence,
  };
}

export function verifyShopeeSgExistingInventoryReadback(input: {
  argumentsValue: UnknownRecord;
  remoteData: UnknownRecord;
}) {
  const binding = shopeeSgExistingUpdateBinding(input.argumentsValue, "inventory");
  const item = binding ? exactItemCore(binding, input.remoteData) : null;
  const title = exactText(item?.item_name);
  const description = exactText(item?.description);
  const titleDigest = providerTextIdentityDigest(title);
  const descriptionDigest = providerTextIdentityDigest(description);
  const images = item ? itemImageIds(item) : [];
  const approvedAssetEvidence = binding
    ? exactApprovedAssetEvidence(binding.approvedAssetEvidence)
    : null;
  if (!binding
      || !item
      || input.argumentsValue.itemId !== binding.itemId
      || input.argumentsValue.quantity !== 1
      || itemAvailableStock(item) !== 1
      || !listingPublicationLanguageVerified("en-SG", title, "title")
      || !listingPublicationLanguageVerified("en-SG", description)
      || images.length !== 9
      || !approvedAssetEvidence) {
    return null;
  }
  return {
    contract: "sellerpilot_shopee_sg_existing_inventory_readback_v1" as const,
    itemId: binding.itemId,
    sku: binding.sku,
    currency: "SGD" as const,
    priceSgd: binding.priceSgd,
    stock: 1 as const,
    providerStatus: "UNLIST" as const,
    visibility: "non_public" as const,
    providerImageIdentityDigest: providerImageIdentityDigest(images),
    titleDigest,
    descriptionDigest,
    representativeImageCount: 1 as const,
    detailImageCount: 8 as const,
    titleLanguageVerified: true as const,
    descriptionLanguageVerified: true as const,
    approvedAssetEvidence,
  };
}

export function assertShopeeSgExistingContentSource(
  argumentsValue: UnknownRecord,
) {
  const binding = shopeeSgExistingUpdateBinding(argumentsValue, "content");
  const body = recordValue(argumentsValue.body);
  const imageUrls = uniqueTexts(argumentsValue.imageUrls);
  const assets = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const transport = Array.isArray(assets.providerTransportImages)
    ? assets.providerTransportImages.map(recordValue)
    : [];
  const transportUrls = transport.map((row) => exactText(row.publicUrl)).filter(Boolean);
  const evidence = shopeeSgExistingApprovedAssetEvidence(argumentsValue);
  const title = exactText(body.item_name);
  const description = exactText(body.description);
  const providerDetailIds = uniqueTexts(
    argumentsValue.sellerpilotProviderDetailImageIds,
  );
  const providerImageIds = uniqueTexts(recordValue(body.image).image_id_list);
  const providerPrepared = Object.hasOwn(
    argumentsValue,
    "sellerpilotProviderDetailImageIds",
  ) || Object.hasOwn(body, "image");
  const expectedTopLevelKeys = [
    shopeeSgExistingUpdateArgument,
    "localItemId",
    "shopId",
    "country",
    "body",
    "publicationStateContract",
    "publicationIntent",
    "publicationExpectedLocale",
    "publicationExpectedImageCount",
    "publicationExpectedFingerprint",
    "imageUrls",
    "sellerpilotPublicationAssetBinding",
    ...(providerPrepared
      ? ["sellerpilotProviderDetailImageIds", "sellerpilotProviderImageSurface"]
      : []),
  ];
  const expectedBodyKeys = [
    "item_id", "item_name", "description", ...(providerPrepared ? ["image"] : []),
  ];
  if (!binding
      || !exactKeys(argumentsValue, expectedTopLevelKeys)
      || !exactKeys(body, expectedBodyKeys)
      || argumentsValue.localItemId !== binding.itemId
      || exactText(body.item_id) !== binding.itemId
      || argumentsValue.shopId !== binding.shopId
      || argumentsValue.country !== "sg"
      || argumentsValue.publicationStateContract !== "verified_remote_state_v1"
      || argumentsValue.publicationIntent !== "safe_test"
      || argumentsValue.publicationExpectedLocale !== "en-SG"
      || argumentsValue.publicationExpectedImageCount !== 8
      || !listingPublicationLanguageVerified("en-SG", title, "title")
      || !listingPublicationLanguageVerified("en-SG", description)
      || imageUrls.length !== 9
      || assets.contract !== "sellerpilot_publication_asset_binding_v1"
      || assets.providerImageSurface !== "gallery"
      || transportUrls.length !== 9
      || imageUrls.some((url, index) => url !== transportUrls[index])
      || !evidence
      || JSON.stringify(binding.approvedAssetEvidence) !== JSON.stringify(evidence)
      || (providerPrepared && (
        argumentsValue.sellerpilotProviderImageSurface !== "gallery"
        || providerDetailIds.length !== 8
        || providerImageIds.length !== 9
        || providerImageIds.slice(1).some((id, index) => id !== providerDetailIds[index])
      ))) {
    throw new Error("SHOPEE_SG_EXISTING_CONTENT_CONTRACT_REQUIRED");
  }
  return binding;
}

export function assertShopeeSgExistingInventorySource(
  argumentsValue: UnknownRecord,
) {
  const binding = shopeeSgExistingUpdateBinding(argumentsValue, "inventory");
  if (!binding
      || !exactKeys(argumentsValue, [
        shopeeSgExistingUpdateArgument, "shopId", "country", "itemId", "quantity",
      ])
      || argumentsValue.shopId !== binding.shopId
      || argumentsValue.country !== "sg"
      || argumentsValue.itemId !== binding.itemId
      || argumentsValue.quantity !== 1
      || !exactApprovedAssetEvidence(binding.approvedAssetEvidence)) {
    throw new Error("SHOPEE_SG_EXISTING_INVENTORY_CONTRACT_REQUIRED");
  }
  return binding;
}
