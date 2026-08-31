import { assertPublicReferenceUrl } from "../public-reference-fetch";
import type { GatewayClaim } from "./gateway-contract";
import {
  mergeShopeeRequiredAttributes,
  normalizeCoupangAttributeValue,
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
} from "./listing-normalization";
import {
  assertLazadaExistingListingGetProductsPreflight,
  assertLazadaExistingListingUpdatePreflight,
  bindLazadaExistingSkuToUpdateRequest,
  lazadaCategoryAttributeCount,
  lazadaCategoryTreeLeaf,
  lazadaPrimaryCategory,
  lazadaRequestedUpdateSellerSku,
} from "./lazada-listing-update";
import {
  assertLazadaExactExistingUpdateArguments,
  lazadaExactExistingCreateForbidden,
  lazadaExactExistingUpdateTarget,
} from "./lazada-exact-existing-identity";
import {
  assertLazadaKrwMyrPricePolicy,
  loadAuthoritativeKrwPerMyr,
  type LazadaKrwMyrRateEvidence,
} from "./lazada-price-policy";
import { downloadMarketplaceImage } from "./marketplace-images";
import {
  buildShopeeSignature,
  coupangRequest,
  fetchNaverAccessToken,
  lazadaRequest,
  naverRequest,
  readStoredNaverAccessToken,
  shopeeEnvironment,
  shopeeMerchantRequest,
  shopeeRequest,
  textValue,
  type SecretPayload,
} from "./protocols";
import {
  bindSmartstoreUploadedProductImages,
  finalizeSmartstoreListingBody,
  smartstoreImageUploadPlan,
} from "./smartstore-image-contract";
import {
  smartstoreExactQaRecoveryArgument,
  smartstoreExactQaRecoveryBinding,
  smartstoreExactQaRecoveryIdentity,
} from "./smartstore-exact-qa-recovery";
import {
  coupangExactQaNoticeContent,
  coupangExactQaRecoveryBinding,
  coupangExactQaRecoveryIdentity,
} from "./coupang-exact-qa-recovery";
import { prepareCoupangExactQaRecoveryArguments } from "./coupang-listing-update";
import {
  assertShopeeSgExactCreateProviderBinding,
  assertShopeeSgCurrentPrice,
  buildShopeeSgPreparedCreateEvidence,
  loadAuthoritativeKrwSgdUsdRate,
  shopeeSgExpectedCategoryPathVerified,
  shopeeSgExactCreateRequested,
  shopeeSgListingCreateExpectation,
  shopeeSgListingCreateRequested,
} from "./shopee-sg-listing-create";

type UnknownRecord = Record<string, unknown>;
type ListingOperation = "listing.create" | "listing.update";

export type ProviderListingRuntimeHooks = {
  assertLeaseHealthy: () => Promise<void>;
  beginProviderMutation: () => Promise<void>;
};

export type PrepareProviderListingInput = {
  channel: GatewayClaim["channel"];
  operation: ListingOperation;
  credential: SecretPayload;
  arguments: UnknownRecord;
  environment: GatewayClaim["environment"];
  signal: AbortSignal;
  hooks: ProviderListingRuntimeHooks;
  shopeeShopCredential?: SecretPayload;
};

export type PreparedProviderListing = {
  arguments: UnknownRecord;
  mediaMutationObserved: boolean;
};

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function objectRecords(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 8 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => objectRecords(item, depth + 1));
  const row = recordValue(value);
  if (!row) return [];
  return [row, ...Object.values(row).flatMap((item) => objectRecords(item, depth + 1))];
}

function uniqueImageUrls(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((url) => url.trim()).filter(Boolean))].slice(0, maximum);
}

function composedSignal(ownerSignal: AbortSignal, timeoutMs: number) {
  return AbortSignal.any([ownerSignal, AbortSignal.timeout(timeoutMs)]);
}

async function publicImage(urlValue: string, signal: AbortSignal) {
  try {
    return await downloadMarketplaceImage(urlValue, signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new Error("MARKETPLACE_IMAGE_DOWNLOAD_FAILED", { cause: error });
  }
}

async function uploadShopeeImage(
  payload: SecretPayload,
  environment: GatewayClaim["environment"],
  imageUrl: string,
  signal: AbortSignal,
  hooks: ProviderListingRuntimeHooks,
  scene: "normal" | "desc" = "normal",
) {
  const partnerId = textValue(payload, "partner_id");
  const partnerKey = textValue(payload, "partner_key");
  const shopId = textValue(payload, "shop_id");
  const merchantId = textValue(payload, "merchant_id");
  const accessToken = textValue(payload, "access_token");
  const targetId = merchantId || shopId;
  const targetKey = merchantId ? "merchant_id" : "shop_id";
  if (!partnerId || !partnerKey || !targetId || !accessToken) {
    throw new Error("SHOPEE_CREDENTIALS_MISSING");
  }
  const path = "/api/v2/media_space/upload_image";
  await hooks.assertLeaseHealthy();
  const image = await publicImage(imageUrl, signal);
  if (image.contentType !== "image/jpeg" && image.contentType !== "image/png") {
    throw new Error("SHOPEE_IMAGE_FORMAT_UNSUPPORTED");
  }
  const extension = image.contentType === "image/png"
    ? "png"
    : "jpg";

  const upload = async (scope: "target" | "partner") => {
    const timestamp = Math.floor(Date.now() / 1_000);
    const query = scope === "partner"
      ? new URLSearchParams({
        partner_id: partnerId,
        timestamp: String(timestamp),
        sign: buildShopeeSignature({ partnerId, partnerKey, path, timestamp }),
      })
      : new URLSearchParams({
        partner_id: partnerId,
        timestamp: String(timestamp),
        access_token: accessToken,
        [targetKey]: targetId,
        sign: buildShopeeSignature({
          partnerId,
          partnerKey,
          path,
          timestamp,
          accessToken,
          ...(merchantId ? { merchantId } : { shopId }),
        }),
      });
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
      `sellerpilot.${extension}`,
    );
    form.append("scene", scene);
    await hooks.assertLeaseHealthy();
    await hooks.beginProviderMutation();
    const response = await fetch(`${shopeeEnvironment(environment)}${path}?${query}`, {
      method: "POST",
      body: form,
      signal: composedSignal(signal, 30_000),
      headers: {
        accept: "application/json",
        "user-agent": "SellerPilot-Shopee-Media/1.0",
      },
    });
    return {
      response,
      data: recordValue(await response.json().catch(() => null)) ?? {},
    };
  };

  await hooks.assertLeaseHealthy();
  let remote = await upload("target");
  if (remote.data.error === "error_sign") {
    await hooks.assertLeaseHealthy();
    remote = await upload("partner");
  }
  const responseData = recordValue(remote.data.response);
  const imageInfo = recordValue(responseData?.image_info);
  const imageId = String(imageInfo?.image_id ?? responseData?.image_id ?? "").trim();
  if (!remote.response.ok || remote.data.error || !imageId) {
    throw new Error("SHOPEE_IMAGE_UPLOAD_FAILED");
  }
  return imageId;
}

type ShopeeRemote = Awaited<ReturnType<typeof shopeeRequest>>;

export type ShopeeGlobalListingRuntimeDependencies = {
  shopRequest?: typeof shopeeRequest;
  merchantRequest?: typeof shopeeMerchantRequest;
  uploadImage?: typeof uploadShopeeImage;
  loadKrwSgdUsdRate?: typeof loadAuthoritativeKrwSgdUsdRate;
};

export type ShopeeGlobalImagePlan = {
  providerImageSurface: "gallery" | "detail_content";
  galleryImageCount: number;
  descriptionImageCount: number;
};

function successfulShopeeRead(remote: ShopeeRemote, errorCode: string) {
  if (!remote.response.ok || remote.data.error) throw new Error(errorCode);
  return recordValue(remote.data.response) ?? {};
}

type ShopeeExactInventoryRead = (
  path: string,
  query: URLSearchParams,
) => Promise<ShopeeRemote>;

const shopeeExactInventoryPageSize = 100;
const shopeeExactInventoryDetailBatchSize = 50;
const shopeeExactLocalItemStatuses = [
  "NORMAL",
  "UNLIST",
  "BANNED",
  "DELETED",
] as const;

function shopeeInventoryRows(
  response: UnknownRecord,
  listKeys: readonly string[],
  errorCode: string,
) {
  const presentKeys = listKeys.filter((key) => Object.hasOwn(response, key));
  const listValue = presentKeys.length === 1 ? response[presentKeys[0]] : null;
  if (!Array.isArray(listValue)) {
    throw new Error(errorCode);
  }
  const rows = listValue.map(recordValue);
  if (rows.some((row) => !row)) throw new Error(errorCode);
  return rows as UnknownRecord[];
}

function shopeeInventoryId(value: unknown, errorCode: string) {
  const id = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  if (!/^[1-9][0-9]{0,31}$/u.test(id)) throw new Error(errorCode);
  return id;
}

async function readCompleteShopeeInventoryIds(input: {
  read: ShopeeExactInventoryRead;
  path: string;
  listKeys: readonly string[];
  idKey: string;
  errorCode: string;
  fixedQuery?: Record<string, string>;
}) {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;
  for (let page = 0; page < 1_000; page += 1) {
    const remote = await input.read(input.path, new URLSearchParams({
      ...(input.fixedQuery ?? {}),
      offset: String(offset),
      page_size: String(shopeeExactInventoryPageSize),
    }));
    const response = successfulShopeeRead(remote, input.errorCode);
    const totalCount = integerLimit(response.total_count);
    if (totalCount === null
        || (expectedTotal !== null && totalCount !== expectedTotal)) {
      throw new Error(input.errorCode);
    }
    expectedTotal ??= totalCount;
    const rows = shopeeInventoryRows(response, input.listKeys, input.errorCode);
    if (rows.length > shopeeExactInventoryPageSize
        || offset + rows.length > expectedTotal
        || (offset < expectedTotal && rows.length === 0)) {
      throw new Error(input.errorCode);
    }
    for (const row of rows) {
      const id = shopeeInventoryId(row[input.idKey], input.errorCode);
      if (seenIds.has(id)) throw new Error(input.errorCode);
      seenIds.add(id);
      ids.push(id);
    }
    const complete = offset + rows.length === expectedTotal;
    if (Object.hasOwn(response, "has_next_page")) {
      if (typeof response.has_next_page !== "boolean"
          || response.has_next_page !== !complete) {
        throw new Error(input.errorCode);
      }
    }
    if (complete) return ids;
    offset += rows.length;
  }
  throw new Error(input.errorCode);
}

async function readExactShopeeSkuMatches(input: {
  ids: readonly string[];
  read: ShopeeExactInventoryRead;
  path: string;
  queryKey: "global_item_id_list" | "item_id_list";
  listKeys: readonly string[];
  idKey: "global_item_id" | "item_id";
  skuKey: "global_item_sku" | "item_sku";
  sku: string;
  errorCode: string;
}) {
  const matches: string[] = [];
  for (let offset = 0; offset < input.ids.length; offset += shopeeExactInventoryDetailBatchSize) {
    const batch = input.ids.slice(offset, offset + shopeeExactInventoryDetailBatchSize);
    const remote = await input.read(input.path, new URLSearchParams({
      [input.queryKey]: batch.join(","),
    }));
    const response = successfulShopeeRead(remote, input.errorCode);
    const rows = shopeeInventoryRows(response, input.listKeys, input.errorCode);
    if (rows.length !== batch.length) throw new Error(input.errorCode);
    const expectedIds = new Set(batch);
    const returnedIds = new Set<string>();
    for (const row of rows) {
      const id = shopeeInventoryId(row[input.idKey], input.errorCode);
      if (!expectedIds.has(id) || returnedIds.has(id)
          || !Object.hasOwn(row, input.skuKey)
          || (typeof row[input.skuKey] !== "string"
            && typeof row[input.skuKey] !== "number")) {
        throw new Error(input.errorCode);
      }
      returnedIds.add(id);
      if (String(row[input.skuKey]).trim() === input.sku) matches.push(id);
    }
    if (returnedIds.size !== expectedIds.size) throw new Error(input.errorCode);
  }
  return matches;
}

async function assertShopeeSgExactSkuAbsent(input: {
  merchantRead: ShopeeExactInventoryRead;
  shopRead: ShopeeExactInventoryRead;
  sku: string;
}) {
  const globalIds = await readCompleteShopeeInventoryIds({
    read: input.merchantRead,
    path: "/api/v2/global_product/get_global_item_list",
    listKeys: ["global_item_list"],
    idKey: "global_item_id",
    errorCode: "SHOPEE_SG_EXACT_GLOBAL_INVENTORY_INCOMPLETE",
  });
  const globalMatches = await readExactShopeeSkuMatches({
    ids: globalIds,
    read: input.merchantRead,
    path: "/api/v2/global_product/get_global_item_info",
    queryKey: "global_item_id_list",
    listKeys: ["global_item_list"],
    idKey: "global_item_id",
    skuKey: "global_item_sku",
    sku: input.sku,
    errorCode: "SHOPEE_SG_EXACT_GLOBAL_INVENTORY_INCOMPLETE",
  });
  if (globalMatches.length) {
    throw new Error("SHOPEE_SG_EXACT_SKU_ALREADY_EXISTS_GLOBAL");
  }

  const localIds: string[] = [];
  const seenLocalIds = new Set<string>();
  for (const itemStatus of shopeeExactLocalItemStatuses) {
    const statusIds = await readCompleteShopeeInventoryIds({
      read: input.shopRead,
      path: "/api/v2/product/get_item_list",
      listKeys: ["item", "item_list"],
      idKey: "item_id",
      errorCode: "SHOPEE_SG_EXACT_LOCAL_INVENTORY_INCOMPLETE",
      fixedQuery: { item_status: itemStatus },
    });
    for (const id of statusIds) {
      if (seenLocalIds.has(id)) {
        throw new Error("SHOPEE_SG_EXACT_LOCAL_INVENTORY_INCOMPLETE");
      }
      seenLocalIds.add(id);
      localIds.push(id);
    }
  }
  const localMatches = await readExactShopeeSkuMatches({
    ids: localIds,
    read: input.shopRead,
    path: "/api/v2/product/get_item_base_info",
    queryKey: "item_id_list",
    listKeys: ["item_list"],
    idKey: "item_id",
    skuKey: "item_sku",
    sku: input.sku,
    errorCode: "SHOPEE_SG_EXACT_LOCAL_INVENTORY_INCOMPLETE",
  });
  if (localMatches.length) {
    throw new Error("SHOPEE_SG_EXACT_SKU_ALREADY_EXISTS_LOCAL");
  }
  return {
    contract: "sellerpilot_shopee_sg_exact_sku_absence_v1",
    sku: input.sku,
    globalItemCount: globalIds.length,
    localItemCount: localIds.length,
    localStatuses: [...shopeeExactLocalItemStatuses],
  } as const;
}

function integerLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Uses Shopee's category-scoped upload-control response. Gallery capacity is
 * not a constant: the provider returns it from get_global_item_limit.
 */
export function planShopeeGlobalImages(
  globalLimitResponse: unknown,
  localLimitResponse: unknown,
): ShopeeGlobalImagePlan {
  const globalResponse = recordValue(recordValue(globalLimitResponse)?.response) ?? {};
  const localResponse = recordValue(recordValue(localLimitResponse)?.response) ?? {};
  const globalGalleryLimit = recordValue(globalResponse.global_item_image_count_limit) ?? {};
  const localGalleryLimit = recordValue(localResponse.item_image_count_limit) ?? {};
  const galleryMins = [
    integerLimit(globalGalleryLimit.min_limit),
    integerLimit(localGalleryLimit.min_limit),
  ];
  const galleryMaxes = [
    integerLimit(globalGalleryLimit.max_limit),
    integerLimit(localGalleryLimit.max_limit),
  ];
  const galleryMin = galleryMins.every((value) => value !== null)
    ? Math.max(...galleryMins as number[])
    : null;
  const galleryMax = galleryMaxes.every((value) => value !== null)
    ? Math.min(...galleryMaxes as number[])
    : null;
  const requestedGalleryCount = 9;
  if (galleryMin === null || galleryMax === null || galleryMin < 1 || galleryMax < galleryMin) {
    throw new Error("SHOPEE_GLOBAL_ITEM_IMAGE_LIMIT_INVALID");
  }
  if (galleryMin <= requestedGalleryCount && galleryMax >= requestedGalleryCount) {
    return {
      providerImageSurface: "gallery",
      galleryImageCount: requestedGalleryCount,
      descriptionImageCount: 0,
    };
  }
  if (galleryMax < 1 || galleryMin > requestedGalleryCount) {
    throw new Error("SHOPEE_GLOBAL_ITEM_IMAGE_COUNT_UNSUPPORTED");
  }
  const globalExtendedLimit = recordValue(globalResponse.extended_description_limit) ?? {};
  const localExtendedLimit = recordValue(localResponse.extended_description_limit) ?? {};
  const descriptionMins = [
    integerLimit(globalExtendedLimit.description_image_num_min),
    integerLimit(localExtendedLimit.description_image_num_min),
  ];
  const descriptionMaxes = [
    integerLimit(globalExtendedLimit.description_image_num_max),
    integerLimit(localExtendedLimit.description_image_num_max),
  ];
  const descriptionMin = descriptionMins.every((value) => value !== null)
    ? Math.max(...descriptionMins as number[])
    : null;
  const descriptionMax = descriptionMaxes.every((value) => value !== null)
    ? Math.min(...descriptionMaxes as number[])
    : null;
  if (descriptionMin === null || descriptionMax === null
      || descriptionMin > 8 || descriptionMax < 8) {
    throw new Error("SHOPEE_EXTENDED_DESCRIPTION_IMAGES_UNAVAILABLE");
  }
  return {
    providerImageSurface: "detail_content",
    galleryImageCount: galleryMax,
    descriptionImageCount: 8,
  };
}

function assertShopeeLeafCategory(remote: ShopeeRemote, categoryId: number, errorCode: string) {
  const response = successfulShopeeRead(remote, errorCode);
  const categories = Array.isArray(response.category_list)
    ? response.category_list.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
    : [];
  const matches = categories.filter((row) => Number(row.category_id) === categoryId);
  const hasChildren = matches[0]?.has_children;
  if (matches.length !== 1 || (hasChildren !== false && hasChildren !== 0 && hasChildren !== "0")) {
    throw new Error(errorCode);
  }
}

function recommendedShopeeLeafCategory(
  recommendationRemote: ShopeeRemote,
  categoryRemote: ShopeeRemote,
  errorCode: string,
) {
  const recommendation = successfulShopeeRead(recommendationRemote, errorCode);
  const recommendedIds = Array.isArray(recommendation.category_id)
    ? recommendation.category_id
      .map(Number)
      .filter((categoryId) => Number.isSafeInteger(categoryId) && categoryId > 0)
    : [];
  const categoryResponse = successfulShopeeRead(categoryRemote, errorCode);
  const categories = Array.isArray(categoryResponse.category_list)
    ? categoryResponse.category_list
      .map(recordValue)
      .filter((row): row is UnknownRecord => Boolean(row))
    : [];
  const leafIds = new Set(categories.flatMap((row) => {
    const categoryId = Number(row.category_id);
    const hasChildren = row.has_children;
    return Number.isSafeInteger(categoryId)
      && categoryId > 0
      && (hasChildren === false || hasChildren === 0 || hasChildren === "0")
      ? [categoryId]
      : [];
  }));
  const categoryId = recommendedIds.find((candidate) => leafIds.has(candidate));
  if (!categoryId) throw new Error(errorCode);
  return categoryId;
}

const shopeeGlobalPublishItemFields = new Set([
  "item_name",
  "description",
  "item_status",
  "original_price",
  "image",
  "model",
  "size_chart",
  "logistic",
  "pre_order",
  "description_type",
  "description_info",
  "standardise_tier_variation",
]);

function documentedShopeeGlobalPublishItem(value: UnknownRecord) {
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => shopeeGlobalPublishItemFields.has(key) && item !== undefined));
}

function exactShopeeAttributeMetadata(
  remote: ShopeeRemote,
  categoryId: number,
  errorCode: string,
) {
  const response = successfulShopeeRead(remote, errorCode);
  const results = Array.isArray(response.list)
    ? response.list.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
    : [];
  const matches = results.filter((row) => Number(row.category_id) === categoryId);
  if (matches.length !== 1 || !Array.isArray(matches[0].attribute_tree)) {
    throw new Error(errorCode);
  }
  return objectRecords(matches[0].attribute_tree)
    .filter((row) => row.attribute_id !== undefined)
    .filter((row) => row.is_mandatory !== undefined || row.mandatory !== undefined);
}

function requiredShopeeAttributes(input: {
  supplied: unknown;
  metadata: UnknownRecord[];
  productHint: string;
  errorCode: string;
}) {
  const metadataIds = new Set(input.metadata
    .map((row) => Number(row.attribute_id))
    .filter((attributeId) => Number.isSafeInteger(attributeId) && attributeId > 0));
  const metadataById = new Map(input.metadata.map((row) => [Number(row.attribute_id), row]));
  const supplied = Array.isArray(input.supplied)
    ? input.supplied
      .map(recordValue)
      .filter((row): row is UnknownRecord => Boolean(row))
      .filter((row) => metadataIds.has(Number(row.attribute_id)))
    : [];
  const required = mergeShopeeRequiredAttributes(supplied, input.metadata, input.productHint);
  if (required.unresolved.length) throw new Error(input.errorCode);
  const incomplete = required.attributes.some((attribute) => {
    const values = Array.isArray(attribute.attribute_value_list)
      ? attribute.attribute_value_list.map(recordValue).filter(Boolean)
      : [];
    return !Number.isSafeInteger(Number(attribute.attribute_id))
      || !metadataIds.has(Number(attribute.attribute_id))
      || values.length === 0
      || values.some((value) => {
        const valueId = Number(value?.value_id);
        const customValue = String(value?.original_value_name ?? "").trim();
        const metadata = metadataById.get(Number(attribute.attribute_id));
        const allowedValueIds = new Set(Array.isArray(metadata?.attribute_value_list)
          ? metadata.attribute_value_list
            .map(recordValue)
            .filter((row): row is UnknownRecord => Boolean(row))
            .map((row) => Number(row.value_id))
            .filter((candidate) => Number.isSafeInteger(candidate) && candidate > 0)
          : []);
        if (Number.isSafeInteger(valueId) && valueId > 0) return !allowedValueIds.has(valueId);
        const inputType = Number(recordValue(metadata?.attribute_info)?.input_type);
        return !customValue || ![2, 3, 5].includes(inputType);
      });
  });
  if (incomplete) throw new Error(input.errorCode);
  return required.attributes;
}

async function activeShopeeLogistics(
  payload: SecretPayload,
  environment: GatewayClaim["environment"],
  hooks: ProviderListingRuntimeHooks,
  request: typeof shopeeRequest = shopeeRequest,
) {
  await hooks.assertLeaseHealthy();
  const logisticsRemote = await request({
    payload,
    environment,
    method: "GET",
    path: "/api/v2/logistics/get_channel_list",
  });
  const logistics = objectRecords(logisticsRemote.data)
    .flatMap((row) => {
      const id = row.logistics_channel_id ?? row.logistic_id ?? row.channel_id;
      const enabled = row.enabled ?? row.is_enabled;
      return (typeof id === "string" || typeof id === "number")
        && (enabled === true || enabled === 1 || enabled === "1")
        ? [{ logistic_id: Number(id), enabled: true }]
        : [];
    })
    .filter((row, index, rows) =>
      Number.isSafeInteger(row.logistic_id)
      && row.logistic_id > 0
      && rows.findIndex((item) => item.logistic_id === row.logistic_id) === index);
  if (!logisticsRemote.response.ok || logisticsRemote.data.error || !logistics.length) {
    throw new Error("SHOPEE_LOGISTICS_MISSING");
  }
  return logistics;
}

async function prepareShopeeListing(
  input: PrepareProviderListingInput,
): Promise<UnknownRecord> {
  const imageUrls = uniqueImageUrls(input.arguments.imageUrls, 9);
  if (!imageUrls.length) throw new Error("SHOPEE_LISTING_IMAGES_MISSING");
  const logistics = await activeShopeeLogistics(
    input.credential,
    input.environment,
    input.hooks,
  );
  const imageIds: string[] = [];
  for (const imageUrl of imageUrls) {
    await input.hooks.assertLeaseHealthy();
    imageIds.push(await uploadShopeeImage(
      input.credential,
      input.environment,
      imageUrl,
      input.signal,
      input.hooks,
    ));
  }
  return {
    ...input.arguments,
    body: {
      ...(recordValue(input.arguments.body) ?? {}),
      image: { image_id_list: imageIds },
      logistic_info: logistics,
    },
  };
}

export async function prepareShopeeGlobalListing(
  input: PrepareProviderListingInput,
  dependencies: ShopeeGlobalListingRuntimeDependencies = {},
): Promise<UnknownRecord> {
  const shopPayload = input.shopeeShopCredential;
  if (!shopPayload) throw new Error("SHOPEE_GLOBAL_SHOP_CREDENTIAL_MISSING");
  const imageUrls = uniqueImageUrls(input.arguments.imageUrls, 9);
  if (imageUrls.length !== 9) throw new Error("SHOPEE_APPROVED_DETAIL_IMAGES_INCOMPLETE");
  const body = structuredClone(recordValue(input.arguments.body) ?? {});
  const publish = structuredClone(recordValue(input.arguments.publish) ?? {});
  const publishItem = recordValue(publish.item) ?? {};
  const strictSgCreate = input.operation === "listing.create"
    && shopeeSgListingCreateRequested(input.arguments);
  const strictExpectation = strictSgCreate
    ? shopeeSgListingCreateExpectation(input.arguments)
    : null;
  if (strictSgCreate && (!strictExpectation || !strictExpectation.ok)) {
    throw new Error("SHOPEE_SG_CREATE_PREWRITE_MISMATCH");
  }
  const exactCreateIdentity = strictExpectation?.ok
    ? assertShopeeSgExactCreateProviderBinding({
        expectation: strictExpectation.expectation,
        merchantCredential: input.credential,
        shopCredential: shopPayload,
      })
    : null;
  const globalCategoryId = Number(body.category_id);
  if (!Number.isSafeInteger(globalCategoryId) || globalCategoryId <= 0) {
    throw new Error("SHOPEE_GLOBAL_CATEGORY_MISSING");
  }
  const shopRequest = dependencies.shopRequest ?? shopeeRequest;
  const merchantRequest = dependencies.merchantRequest ?? shopeeMerchantRequest;
  const uploadImage = dependencies.uploadImage ?? uploadShopeeImage;
  const loadKrwSgdUsdRate = dependencies.loadKrwSgdUsdRate ?? loadAuthoritativeKrwSgdUsdRate;
  const merchantRead = async (path: string, query: URLSearchParams) => {
    await input.hooks.assertLeaseHealthy();
    return merchantRequest({
      payload: input.credential,
      environment: input.environment,
      method: "GET",
      path,
      query,
    });
  };
  const shopRead = async (path: string, query: URLSearchParams) => {
    await input.hooks.assertLeaseHealthy();
    return shopRequest({
      payload: shopPayload,
      environment: input.environment,
      method: "GET",
      path,
      query,
    });
  };

  // Every provider validation is completed before the first media mutation.
  // This prevents a category/logistics failure from leaving orphaned uploads.
  const logistics = await activeShopeeLogistics(
    shopPayload,
    input.environment,
    input.hooks,
    shopRequest,
  );
  const globalCategoryRemote = await merchantRead(
    "/api/v2/global_product/get_category",
    new URLSearchParams({ language: "en" }),
  );
  const providerGlobalCategoryPath = strictExpectation?.ok
    ? shopeeSgExpectedCategoryPathVerified(
        globalCategoryRemote.data,
        strictExpectation.expectation.context,
      )
    : null;
  if (strictExpectation?.ok && !providerGlobalCategoryPath) {
    throw new Error("SHOPEE_SG_EXACT_CATEGORY_PATH_INVALID");
  }
  if (!strictExpectation) {
    assertShopeeLeafCategory(globalCategoryRemote, globalCategoryId, "SHOPEE_GLOBAL_CATEGORY_INVALID");
  }
  const globalAttributeRemote = await merchantRead(
    "/api/v2/global_product/get_attribute_tree",
    new URLSearchParams({ category_id_list: String(globalCategoryId), language: "en" }),
  );
  const globalAttributeMetadata = exactShopeeAttributeMetadata(
    globalAttributeRemote,
    globalCategoryId,
    "SHOPEE_GLOBAL_ATTRIBUTES_QUERY_FAILED",
  );
  const localizedItemName = String(publishItem.item_name ?? "").trim();
  if (!localizedItemName) throw new Error("SHOPEE_LOCAL_ITEM_NAME_MISSING");
  const localRecommendationRemote = await shopRead(
    "/api/v2/product/category_recommend",
    new URLSearchParams({ item_name: localizedItemName }),
  );
  const localCategoryRemote = await shopRead(
    "/api/v2/product/get_category",
    new URLSearchParams({ language: "en" }),
  );
  const localCategoryId = recommendedShopeeLeafCategory(
    localRecommendationRemote,
    localCategoryRemote,
    "SHOPEE_LOCAL_CATEGORY_RECOMMENDATION_INVALID",
  );
  const limitRemote = await merchantRead(
    "/api/v2/global_product/get_global_item_limit",
    new URLSearchParams({ category_id: String(globalCategoryId) }),
  );
  successfulShopeeRead(limitRemote, "SHOPEE_GLOBAL_ITEM_LIMIT_QUERY_FAILED");
  const localLimitRemote = await shopRead(
    "/api/v2/product/get_item_limit",
    new URLSearchParams({ category_id: String(localCategoryId) }),
  );
  successfulShopeeRead(localLimitRemote, "SHOPEE_LOCAL_ITEM_LIMIT_QUERY_FAILED");
  const imagePlan = planShopeeGlobalImages(limitRemote.data, localLimitRemote.data);
  if (strictExpectation?.ok) {
    await input.hooks.assertLeaseHealthy();
    const authoritativeRate = await loadKrwSgdUsdRate({ signal: input.signal });
    assertShopeeSgCurrentPrice({ expectation: strictExpectation.expectation, authoritativeRate });
  }
  const productHint = `${String(publishItem.item_name ?? body.global_item_name ?? "")} ${String(publishItem.description ?? body.description ?? "")}`;
  const globalAttributes = requiredShopeeAttributes({
    supplied: body.attribute_list,
    metadata: globalAttributeMetadata,
    productHint,
    errorCode: "SHOPEE_GLOBAL_REQUIRED_ATTRIBUTES_MISSING",
  });
  const exactSkuAbsenceEvidence = exactCreateIdentity
    ? await assertShopeeSgExactSkuAbsent({
        merchantRead,
        shopRead,
        sku: exactCreateIdentity.sku,
      })
    : null;
  const imageIds: string[] = [];
  for (const [index, imageUrl] of imageUrls.entries()) {
    await input.hooks.assertLeaseHealthy();
    imageIds.push(await uploadImage(
      shopPayload,
      input.environment,
      imageUrl,
      input.signal,
      input.hooks,
      imagePlan.providerImageSurface === "detail_content" && index > 0 ? "desc" : "normal",
    ));
  }
  const detailImageIds = imageIds.slice(1);
  if (detailImageIds.length !== 8 || new Set(detailImageIds).size !== 8) {
    throw new Error("SHOPEE_APPROVED_DETAIL_IMAGE_UPLOAD_INCOMPLETE");
  }
  const galleryImageIds = imageIds.slice(0, imagePlan.galleryImageCount);
  const extendedDescription = imagePlan.providerImageSurface === "detail_content"
    ? {
        description_type: "extended",
        description_info: {
          extended_description: {
            field_list: [
              ...(String(publishItem.description ?? body.description ?? "").trim()
                ? [{ field_type: "text", text: String(publishItem.description ?? body.description).trim() }]
                : []),
              ...detailImageIds.map((imageId) => ({
                field_type: "image",
                image_info: { image_id: imageId },
              })),
            ],
          },
        },
      }
    : {};
  publish.item = {
    ...documentedShopeeGlobalPublishItem(publishItem),
    ...extendedDescription,
    image: { image_id_list: galleryImageIds },
    logistic: logistics,
  };
  return {
    ...input.arguments,
    ...(exactSkuAbsenceEvidence
      ? { sellerpilotShopeeSgExactSkuAbsenceEvidence: exactSkuAbsenceEvidence }
      : {}),
    ...(providerGlobalCategoryPath
      ? { sellerpilotProviderGlobalCategoryPath: providerGlobalCategoryPath }
      : {}),
    ...(strictExpectation?.ok && providerGlobalCategoryPath
      ? {
          sellerpilotShopeeSgPreparedCreateEvidence: buildShopeeSgPreparedCreateEvidence({
            expectation: strictExpectation.expectation,
            providerGlobalCategoryPath,
            providerLocalCategoryId: String(localCategoryId),
          }),
        }
      : {}),
    sellerpilotProviderLocalCategoryId: localCategoryId,
    sellerpilotProviderDetailImageIds: detailImageIds,
    sellerpilotProviderImageSurface: imagePlan.providerImageSurface,
    sellerpilotProviderImageContract: imagePlan.providerImageSurface === "gallery"
      ? "representative_plus_approved_detail_8_exact_gallery_9"
      : "approved_detail_content_exact_8",
    body: {
      ...body,
      ...extendedDescription,
      image: { image_id_list: galleryImageIds },
      attribute_list: globalAttributes,
    },
    publish,
  };
}

function xmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character] ?? character);
}

function lazadaAccepted(remote: Awaited<ReturnType<typeof lazadaRequest>>) {
  return remote.response.ok && String(remote.data.code ?? "").trim() === "0";
}

function lazadaLanguageCode(country: string) {
  const values: Record<string, string> = {
    id: "id_ID",
    my: "ms_MY",
    ph: "en_PH",
    sg: "en_SG",
    th: "th_TH",
    vn: "vi_VN",
  };
  return values[country];
}

function lazadaBoundPublicationImageSources(argumentsValue: UnknownRecord) {
  const allSources = uniqueImageUrls(argumentsValue.imageUrls, 32);
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const strict = argumentsValue.publicationStateContract === "verified_remote_state_v1";
  if (!strict) return {
    representative: allSources[0] ?? "",
    details: allSources.slice(1, 9),
    migrationSources: allSources,
  };
  const transportRows = Array.isArray(binding?.providerTransportImages)
    ? binding.providerTransportImages.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
    : [];
  const details = transportRows.map((row) => String(row.publicUrl ?? "").trim()).filter(Boolean);
  const assets = recordValue(argumentsValue.sellerpilotAssets);
  const gallery = uniqueImageUrls(assets?.galleryImageUrls, 20);
  const representative = gallery[0] ?? allSources.find((url) => !details.includes(url)) ?? "";
  if (binding?.contract !== "sellerpilot_publication_asset_binding_v1"
      || binding.providerImageSurface !== "detail_content"
      || details.length !== 8
      || new Set(details).size !== 8
      || !representative
      || details.includes(representative)
      || !allSources.includes(representative)
      || details.some((url) => !allSources.includes(url))) {
    throw new Error("LAZADA_PUBLICATION_IMAGE_BINDING_INVALID");
  }
  return {
    representative,
    details,
    migrationSources: [representative, ...details],
  };
}

export type LazadaListingRuntimeDependencies = {
  assertPublicReferenceUrl: typeof assertPublicReferenceUrl;
  lazadaRequest: typeof lazadaRequest;
  loadKrwPerMyr: (signal: AbortSignal) => Promise<LazadaKrwMyrRateEvidence>;
};

const lazadaListingRuntimeDependencies: LazadaListingRuntimeDependencies = {
  assertPublicReferenceUrl,
  lazadaRequest,
  loadKrwPerMyr: (signal) => loadAuthoritativeKrwPerMyr({ signal }),
};

export async function prepareLazadaListing(
  input: PrepareProviderListingInput,
  dependencies: LazadaListingRuntimeDependencies = lazadaListingRuntimeDependencies,
): Promise<UnknownRecord> {
  if (input.operation === "listing.create"
      && lazadaExactExistingCreateForbidden({ argumentsValue: input.arguments })) {
    throw new Error("LAZADA_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN");
  }
  if (input.operation === "listing.update") {
    assertLazadaExactExistingUpdateArguments(input.arguments);
  }
  const sources = lazadaBoundPublicationImageSources(input.arguments);
  if (!sources.migrationSources.length || !sources.representative) {
    throw new Error("LAZADA_LISTING_IMAGES_MISSING");
  }
  let preparedArguments = input.arguments;
  if (input.operation === "listing.update") {
    const request = recordValue(recordValue(recordValue(input.arguments.request)?.Request)?.Product);
    const primaryCategory = lazadaPrimaryCategory(request ?? {});
    const itemId = String(input.arguments.itemId ?? "").trim();
    const sellerSku = lazadaRequestedUpdateSellerSku(input.arguments);
    const country = String(input.arguments.country ?? textValue(input.credential, "country") ?? "")
      .trim()
      .toLowerCase();
    const languageCode = lazadaLanguageCode(country);
    if (!/^\d+$/u.test(itemId)
        || !/^\d+$/u.test(primaryCategory)
        || !sellerSku
        || !languageCode) {
      throw new Error("LAZADA_UPDATE_PREFLIGHT_ARGUMENTS_INVALID");
    }
    await input.hooks.assertLeaseHealthy();
    const [productsRemote, itemRemote, treeRemote, attributesRemote, authoritativeRate] = await Promise.all([
      dependencies.lazadaRequest({
        payload: input.credential,
        path: "/products/get",
        params: {
          filter: "all",
          sku_seller_list: JSON.stringify([sellerSku]),
          options: "1",
          limit: "100",
          offset: "0",
        },
      }),
      dependencies.lazadaRequest({
        payload: input.credential,
        path: "/product/item/get",
        params: { item_id: itemId },
      }),
      dependencies.lazadaRequest({
        payload: input.credential,
        path: "/category/tree/get",
        params: { language_code: languageCode },
      }),
      dependencies.lazadaRequest({
        payload: input.credential,
        path: "/category/attributes/get",
        params: { primary_category_id: primaryCategory, language_code: languageCode },
      }),
      dependencies.loadKrwPerMyr(input.signal),
    ]);
    if (!lazadaAccepted(productsRemote)) {
      throw new Error("LAZADA_UPDATE_PRODUCTS_PREFLIGHT_FAILED");
    }
    if (!lazadaAccepted(itemRemote)) throw new Error("LAZADA_UPDATE_ITEM_PREFLIGHT_FAILED");
    if (!lazadaAccepted(treeRemote)
        || !lazadaCategoryTreeLeaf(treeRemote.data, primaryCategory)) {
      throw new Error("LAZADA_UPDATE_LEAF_CATEGORY_PREFLIGHT_FAILED");
    }
    if (!lazadaAccepted(attributesRemote)
        || lazadaCategoryAttributeCount(attributesRemote.data) < 1) {
      throw new Error("LAZADA_UPDATE_CATEGORY_ATTRIBUTES_PREFLIGHT_FAILED");
    }
    assertLazadaKrwMyrPricePolicy({
      argumentsValue: input.arguments,
      authoritativeRate,
    });
    const productsPreflight = assertLazadaExistingListingGetProductsPreflight({
      argumentsValue: input.arguments,
      remoteData: productsRemote.data,
    });
    const preflight = assertLazadaExistingListingUpdatePreflight({
      argumentsValue: input.arguments,
      remoteData: itemRemote.data,
      country,
      requiredVisibility: lazadaExactExistingUpdateTarget(input.arguments)
        ? "non_public"
        : "live",
    });
    if (productsPreflight.skuId !== preflight.skuId) {
      throw new Error("LAZADA_UPDATE_PRODUCTS_ITEM_SKU_ID_MISMATCH");
    }
    preparedArguments = bindLazadaExistingSkuToUpdateRequest(input.arguments, preflight);
  }

  await input.hooks.assertLeaseHealthy();
  await Promise.all(sources.migrationSources.map((imageUrl) => (
    dependencies.assertPublicReferenceUrl(imageUrl, { signal: input.signal })
  )));

  const migrated: string[] = [];
  for (const imageUrl of sources.migrationSources) {
    await input.hooks.assertLeaseHealthy();
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Request><Image><Url>${xmlEscape(imageUrl)}</Url></Image></Request>`;
    await input.hooks.beginProviderMutation();
    const remote = await dependencies.lazadaRequest({
      payload: input.credential,
      path: "/image/migrate",
      method: "POST",
      params: { payload: xml },
    });
    const data = recordValue(remote.data.data);
    const image = recordValue(data?.image);
    const url = String(image?.url ?? "").trim();
    if (!remote.response.ok || String(remote.data.code ?? "") !== "0" || !url) {
      throw new Error("LAZADA_IMAGE_MIGRATION_FAILED");
    }
    migrated.push(url);
  }

  const request = structuredClone(recordValue(preparedArguments.request) ?? {});
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot?.Product);
  if (!requestRoot || !product) throw new Error("CHANNEL_ARGUMENT_REQUIRED:request.Request.Product");
  const replacements = new Map(sources.migrationSources.map((source, index) => [source, migrated[index]]));
  const migratedProduct = recordValue(replaceMarketplaceImageUrls(product, replacements));
  if (!migratedProduct) throw new Error("LAZADA_PRODUCT_IMAGE_REWRITE_FAILED");
  requestRoot.Product = migratedProduct;
  const providerRepresentative = replacements.get(sources.representative) ?? "";
  const providerDetails = sources.details.map((url) => replacements.get(url) ?? "");
  if (!providerRepresentative
      || (preparedArguments.publicationStateContract === "verified_remote_state_v1"
        && (providerDetails.length !== 8
          || providerDetails.some((url) => !url)
          || new Set([providerRepresentative, ...providerDetails]).size !== 9))) {
    throw new Error("LAZADA_PROVIDER_IMAGE_BINDING_FAILED");
  }
  const listingImages = preparedArguments.publicationStateContract === "verified_remote_state_v1"
    ? [providerRepresentative, ...providerDetails.slice(0, 7)]
    : migrated.slice(0, 8);
  migratedProduct.Images = { Image: listingImages };
  const skusRoot = recordValue(migratedProduct.Skus);
  const skus = Array.isArray(skusRoot?.Sku) ? skusRoot.Sku : [];
  for (const sku of skus) {
    const row = recordValue(sku);
    if (row) row.Images = { Image: listingImages };
  }
  return {
    ...preparedArguments,
    ...(preparedArguments.publicationStateContract === "verified_remote_state_v1"
      ? {
          sellerpilotProviderImageSurface: "detail_content",
          sellerpilotProviderImageContract: "representative_plus_approved_detail_8_exact_detail_content",
          sellerpilotProviderRepresentativeImageUrl: providerRepresentative,
          sellerpilotProviderDetailImageUrls: providerDetails,
        }
      : {}),
    request,
  };
}

async function prepareSmartstoreListing(input: PrepareProviderListingInput): Promise<UnknownRecord> {
  const exactRecovery = smartstoreExactQaRecoveryBinding(input.arguments);
  if (Object.hasOwn(input.arguments, smartstoreExactQaRecoveryArgument)
      && !exactRecovery) {
    throw new Error("SMARTSTORE_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
  }
  const sourceBody = structuredClone(recordValue(input.arguments.body) ?? {});
  const imagePlan = smartstoreImageUploadPlan({
    imageUrls: input.arguments.imageUrls,
    body: sourceBody,
  });
  const imageUrls = imagePlan.sourceUrls;
  await input.hooks.assertLeaseHealthy();
  const storedAccessToken = readStoredNaverAccessToken(input.credential);
  const token = storedAccessToken
    ? { accessToken: storedAccessToken }
    : await fetchNaverAccessToken(input.credential);
  let phone = input.operation === "listing.create"
    ? textValue(input.credential, "after_service_phone")
    : "";
  if (input.operation === "listing.create" && !phone) {
    await input.hooks.assertLeaseHealthy();
    const addressRemote = await naverRequest({
      accessToken: token.accessToken,
      method: "GET",
      path: "/v1/seller/addressbooks-for-page",
      query: new URLSearchParams({ page: "1" }),
    });
    const addressBooks = Array.isArray(addressRemote.data.addressBooks)
      ? addressRemote.data.addressBooks.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
      : [];
    const address = addressBooks.find((item) => item.addressType === "REPRESENTATIVE")
      ?? addressBooks.find((item) => item.addressType === "RELEASE")
      ?? addressBooks[0];
    phone = String(address?.phoneNumber1 ?? address?.phoneNumber2 ?? "").trim();
    if (!addressRemote.response.ok || !phone) throw new Error("NAVER_AFTER_SERVICE_PHONE_MISSING");
  }

  if (input.operation === "listing.create") {
    const originProduct = recordValue(sourceBody.originProduct) ?? {};
    const categoryId = String(originProduct.leafCategoryId ?? "").trim();
    if (!/^\d+$/.test(categoryId)) throw new Error("NAVER_LEAF_CATEGORY_MISSING");
    await input.hooks.assertLeaseHealthy();
    const categoryRemote = await naverRequest({
      accessToken: token.accessToken,
      method: "GET",
      path: `/v1/categories/${encodeURIComponent(categoryId)}`,
    });
    const category = recordValue(categoryRemote.data) ?? {};
    if (!categoryRemote.response.ok
        || String(category.id ?? "").trim() !== categoryId
        || category.last !== true) {
      throw new Error("NAVER_LEAF_CATEGORY_PREFLIGHT_FAILED");
    }

    const detailAttribute = recordValue(originProduct.detailAttribute) ?? {};
    const sellerCodeInfo = recordValue(detailAttribute.sellerCodeInfo) ?? {};
    const sellerManagementCode = String(sellerCodeInfo.sellerManagementCode ?? "").trim();
    if (!sellerManagementCode) throw new Error("NAVER_SELLER_MANAGEMENT_CODE_MISSING");
    await input.hooks.assertLeaseHealthy();
    const duplicateRemote = await naverRequest({
      accessToken: token.accessToken,
      method: "POST",
      path: "/v1/products/search",
      body: {
        searchKeywordType: "SELLER_CODE",
        sellerManagementCode,
        page: 1,
        size: 50,
        orderType: "NO",
      },
    });
    if (!duplicateRemote.response.ok || !Array.isArray(duplicateRemote.data.contents)) {
      throw new Error("NAVER_DUPLICATE_PREFLIGHT_FAILED");
    }
  } else {
    const remoteId = String(input.arguments.originProductNo ?? "").trim();
    if (!/^\d+$/.test(remoteId)) throw new Error("NAVER_ORIGIN_PRODUCT_ID_MISSING");
    const requestedOriginProduct = recordValue(sourceBody.originProduct) ?? {};
    const requestedDetailAttribute = recordValue(requestedOriginProduct.detailAttribute) ?? {};
    const requestedSellerCodeInfo = recordValue(requestedDetailAttribute.sellerCodeInfo) ?? {};
    const expectedSellerManagementCode = String(
      requestedSellerCodeInfo.sellerManagementCode ?? "",
    ).trim();
    if (!expectedSellerManagementCode) {
      throw new Error("NAVER_SELLER_MANAGEMENT_CODE_MISSING");
    }
    if (exactRecovery) {
      const requestedTitle = String(requestedOriginProduct.name ?? "").trim();
      const requestedDescription = String(requestedOriginProduct.detailContent ?? "").trim();
      const requestedPrice = Number(normalizeTenWonAmount(requestedOriginProduct.salePrice));
      const requestedStock = Number(requestedOriginProduct.stockQuantity);
      if (remoteId !== exactRecovery.originProductNo
          || expectedSellerManagementCode !== exactRecovery.centralSku
          || requestedPrice !== smartstoreExactQaRecoveryIdentity.priceKrw
          || !Number.isSafeInteger(requestedStock)
          || requestedStock < 1
          || requestedStock > 99_999_999
          || input.arguments.publicationIntent !== "live"
          || input.arguments.publicationExpectedLocale !== "ko-KR"
          || input.arguments.publicationExpectedImageCount !== 8
          || !/[가-힣]/u.test(requestedTitle)
          || !/[가-힣]/u.test(requestedDescription)) {
        throw new Error("SMARTSTORE_EXACT_QA_PATCH_CONTRACT_MISMATCH");
      }
    }
    await input.hooks.assertLeaseHealthy();
    const originRemote = await naverRequest({
      accessToken: token.accessToken,
      method: "GET",
      path: `/v2/products/origin-products/${encodeURIComponent(remoteId)}`,
    });
    const currentOriginProduct = recordValue(originRemote.data.originProduct) ?? {};
    const embeddedChannelProduct = recordValue(originRemote.data.smartstoreChannelProduct) ?? {};
    const responseOriginProductNo = String(
      originRemote.data.originProductNo ?? currentOriginProduct.originProductNo ?? "",
    ).trim();
    const responseChannelProductNo = String(
      originRemote.data.smartstoreChannelProductNo
        ?? embeddedChannelProduct.channelProductNo
        ?? "",
    ).trim();
    const currentDetailAttribute = recordValue(currentOriginProduct.detailAttribute) ?? {};
    const currentSellerCodeInfo = recordValue(currentDetailAttribute.sellerCodeInfo) ?? {};
    const originSellerManagementCode = String(
      currentSellerCodeInfo.sellerManagementCode
        ?? currentOriginProduct.sellerManagementCode
        ?? "",
    ).trim();
    if (!originRemote.response.ok
        || !Object.keys(currentOriginProduct).length
        || (responseOriginProductNo && responseOriginProductNo !== remoteId)
        || !/^\d+$/.test(responseChannelProductNo)
        || (exactRecovery
          && responseChannelProductNo !== exactRecovery.channelProductNo)
        || originSellerManagementCode !== expectedSellerManagementCode) {
      throw new Error("NAVER_UPDATE_ORIGIN_PREFLIGHT_FAILED");
    }

    await input.hooks.assertLeaseHealthy();
    const channelRemote = await naverRequest({
      accessToken: token.accessToken,
      method: "GET",
      path: `/v2/products/channel-products/${encodeURIComponent(responseChannelProductNo)}`,
    });
    const currentChannelProduct = recordValue(channelRemote.data.smartstoreChannelProduct) ?? {};
    const authoritativeChannelProductNo = String(
      currentChannelProduct.channelProductNo
        ?? currentChannelProduct.smartstoreChannelProductNo
        ?? channelRemote.data.smartstoreChannelProductNo
        ?? "",
    ).trim();
    const authoritativeOriginProductNo = String(
      currentChannelProduct.originProductNo
        ?? channelRemote.data.originProductNo
        ?? "",
    ).trim();
    const channelSellerManagementCode = String(
      currentChannelProduct.sellerManagementCode ?? expectedSellerManagementCode,
    ).trim();
    if (!channelRemote.response.ok
        || !Object.keys(currentChannelProduct).length
        || authoritativeChannelProductNo !== responseChannelProductNo
        || authoritativeOriginProductNo !== remoteId
        || (exactRecovery
          && authoritativeChannelProductNo !== exactRecovery.channelProductNo)
        || channelSellerManagementCode !== expectedSellerManagementCode) {
      throw new Error("NAVER_UPDATE_CHANNEL_PREFLIGHT_FAILED");
    }
  }

  const form = new FormData();
  for (let index = 0; index < imageUrls.length; index += 1) {
    await input.hooks.assertLeaseHealthy();
    const image = await publicImage(imageUrls[index], input.signal);
    const extension = image.contentType === "image/png"
      ? "png"
      : image.contentType === "image/webp"
        ? "webp"
        : "jpg";
    form.append(
      "imageFiles",
      new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
      `sellerpilot-${index + 1}.${extension}`,
    );
  }
  await input.hooks.assertLeaseHealthy();
  await input.hooks.beginProviderMutation();
  const uploadResponse = await fetch(
    "https://api.commerce.naver.com/external/v1/product-images/upload",
    {
      method: "POST",
      body: form,
      signal: composedSignal(input.signal, 30_000),
      headers: {
        accept: "application/json;charset=UTF-8",
        authorization: `Bearer ${token.accessToken}`,
        "user-agent": "SellerPilot-Naver-Media/1.0",
      },
    },
  );
  const uploadData = recordValue(await uploadResponse.json().catch(() => null)) ?? {};
  const uploadedUrls = Array.isArray(uploadData.images)
    ? uploadData.images
      .map(recordValue)
      .map((image) => String(image?.url ?? "").trim())
      .filter(Boolean)
    : [];
  if (!uploadResponse.ok || uploadedUrls.length !== imageUrls.length) {
    throw new Error("NAVER_IMAGE_UPLOAD_FAILED");
  }

  const providerImageBody = bindSmartstoreUploadedProductImages({
    body: sourceBody,
    sourceUrls: imageUrls,
    uploadedUrls,
  });
  const body = finalizeSmartstoreListingBody({
    body: providerImageBody,
    operation: input.operation,
    publicationIntent: input.arguments.publicationIntent,
    afterServicePhone: phone,
  });
  return { ...input.arguments, imageUrls: uploadedUrls, body };
}

function nestedContent(data: UnknownRecord) {
  if (Array.isArray(data.content)) return data.content;
  const nested = recordValue(data.data);
  if (Array.isArray(nested?.content)) return nested.content;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function coupangUsable(value: unknown) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "TRUE"
    || normalized === "Y"
    || normalized === "YES"
    || normalized === "1";
}

function preferredKoreanAddress(value: unknown): UnknownRecord | null {
  if (!Array.isArray(value)) return null;
  const addresses = value.map(recordValue).filter((row): row is UnknownRecord => Boolean(row));
  const korean = addresses.filter((address) =>
    String(address.countryCode ?? "").trim().toUpperCase() === "KR");
  return korean.find((address) =>
    String(address.addressType ?? "").trim().toUpperCase().includes("ROADNAME"))
    ?? korean.find((address) =>
      String(address.addressType ?? "").trim().toUpperCase() === "JIBUN")
    ?? korean[0]
    ?? null;
}

function safeCoupangCenterSummary(centers: UnknownRecord[]) {
  return [
    `total=${centers.length}`,
    `usable=${centers.filter((center) => coupangUsable(center.usable)).length}`,
    `domestic=${centers.filter((center) => preferredKoreanAddress(center.placeAddresses)).length}`,
  ].join(",");
}

function positiveFee(center: UnknownRecord) {
  for (const key of [
    "returnFee02kg",
    "returnFee05kg",
    "returnFee10kg",
    "returnFee20kg",
    "vendorCreditFee02kg",
    "vendorCreditFee05kg",
    "vendorCashFee02kg",
    "vendorCashFee05kg",
  ]) {
    const value = Number(center[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function coupangAttributeValue(attribute: UnknownRecord, facts: UnknownRecord) {
  const name = String(attribute.attributeTypeName ?? "").replace(/\s+/g, "");
  const usableUnits = Array.isArray(attribute.usableUnits) ? attribute.usableUnits.map(String) : [];
  const firstUnit = (...candidates: string[]) =>
    candidates.find((unit) => usableUnits.includes(unit)) ?? "";
  if (/총?수량|개수|구성수/.test(name)) {
    const unit = firstUnit("개", "세트", "팩", "박스", "매")
      || String(attribute.basicUnit ?? "개").replace(/^없음$/, "개");
    return `1${unit}`;
  }
  if (/중량|무게/.test(name) && Number(facts.weightKg) > 0) {
    const unit = firstUnit("g", "kg");
    return unit === "kg"
      ? `${Number(facts.weightKg)}kg`
      : `${Math.round(Number(facts.weightKg) * 1_000)}g`;
  }
  if (/크기|사이즈/.test(name)
      && Array.isArray(facts.dimensionsCm)
      && facts.dimensionsCm.length === 3) {
    return `${facts.dimensionsCm.map(Number).join("x")}cm`.slice(0, 30);
  }
  const material = String(facts.material ?? "").trim();
  if (/재질|소재/.test(name) && material && !/미확인|미기재/.test(material)) {
    return material.slice(0, 30);
  }
  return "";
}

function coupangMetadata(data: UnknownRecord) {
  return recordValue(data.data) ?? data;
}

function prepareCoupangItem(
  itemValue: unknown,
  metadata: UnknownRecord,
  facts: UnknownRecord,
  exactNoticeCategoryName?: string,
) {
  const item = structuredClone(recordValue(itemValue) ?? {});
  const metaAttributes = Array.isArray(metadata.attributes)
    ? metadata.attributes.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
    : [];
  const suppliedRows = Array.isArray(item.attributes)
    ? item.attributes.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
    : [];
  const supplied = new Map(suppliedRows.map((attribute) => [
    String(attribute.attributeTypeName ?? "").trim(),
    String(attribute.attributeValueName ?? "").trim(),
  ]));
  const metadataByName = new Map(metaAttributes.map((attribute) => [
    String(attribute.attributeTypeName ?? "").trim(),
    attribute,
  ]));
  for (const [name, value] of supplied) {
    supplied.set(name, normalizeCoupangAttributeValue(metadataByName.get(name), value));
  }

  const missing: string[] = [];
  const mandatorySingles = metaAttributes.filter((attribute) =>
    attribute.required === "MANDATORY"
    && String(attribute.groupNumber ?? "NONE") === "NONE"
    && attribute.exposed === "EXPOSED");
  for (const attribute of mandatorySingles) {
    const name = String(attribute.attributeTypeName ?? "").trim();
    if (!name || supplied.get(name)) continue;
    const derived = coupangAttributeValue(attribute, facts);
    if (derived) supplied.set(name, derived);
    else missing.push(name);
  }

  const grouped = new Map<string, UnknownRecord[]>();
  for (const attribute of metaAttributes.filter((row) =>
    row.required === "MANDATORY"
    && !["", "NONE"].includes(String(row.groupNumber ?? ""))
    && row.exposed === "EXPOSED")) {
    const key = String(attribute.groupNumber);
    grouped.set(key, [...(grouped.get(key) ?? []), attribute]);
  }
  for (const attributes of grouped.values()) {
    if (attributes.some((attribute) =>
      supplied.get(String(attribute.attributeTypeName ?? "").trim()))) continue;
    const derivedAttribute = attributes
      .map((attribute) => [attribute, coupangAttributeValue(attribute, facts)] as const)
      .find((entry) => entry[1]);
    if (derivedAttribute) {
      supplied.set(String(derivedAttribute[0].attributeTypeName ?? "").trim(), derivedAttribute[1]);
    } else {
      missing.push(attributes
        .map((attribute) => String(attribute.attributeTypeName ?? "").trim())
        .filter(Boolean)
        .join(" 또는 "));
    }
  }
  if (missing.length) throw new Error("COUPANG_MANDATORY_ATTRIBUTES_MISSING");
  item.attributes = [...supplied.entries()].map(([attributeTypeName, attributeValueName]) => ({
    attributeTypeName,
    attributeValueName,
    ...(metadataByName.get(attributeTypeName)?.exposed
      ? { exposed: metadataByName.get(attributeTypeName)?.exposed }
      : {}),
  }));

  if (exactNoticeCategoryName || !Array.isArray(item.notices) || !item.notices.length) {
    const noticeCategories = Array.isArray(metadata.noticeCategories)
      ? metadata.noticeCategories.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
      : [];
    const noticeCategory = exactNoticeCategoryName
      ? noticeCategories.find((category) =>
        String(category.noticeCategoryName ?? "").trim() === exactNoticeCategoryName)
      : noticeCategories.find((category) =>
        Array.isArray(category.noticeCategoryDetailNames)
        && category.noticeCategoryDetailNames.some((detail) =>
          recordValue(detail)?.required === "MANDATORY"))
        ?? noticeCategories[0];
    if (!noticeCategory) {
      throw new Error(exactNoticeCategoryName
        ? "COUPANG_EXACT_QA_NOTICE_CATEGORY_UNAVAILABLE"
        : "COUPANG_NOTICE_METADATA_MISSING");
    }
    const details = Array.isArray(noticeCategory?.noticeCategoryDetailNames)
      ? noticeCategory.noticeCategoryDetailNames
        .map(recordValue)
        .filter((row): row is UnknownRecord => Boolean(row))
      : [];
    const mandatoryDetails = details.filter((detail) => detail.required === "MANDATORY");
    const notices = mandatoryDetails.map((detail) => ({
      noticeCategoryName: String(noticeCategory?.noticeCategoryName ?? ""),
      noticeCategoryDetailName: String(detail.noticeCategoryDetailName ?? ""),
      content: exactNoticeCategoryName
        ? coupangExactQaNoticeContent(detail.noticeCategoryDetailName)
        : "상품상세 참조",
    }));
    if (exactNoticeCategoryName && notices.some((notice) => !notice.content)) {
      throw new Error("COUPANG_EXACT_QA_NOTICE_DETAIL_UNSUPPORTED");
    }
    if (!notices.length) throw new Error("COUPANG_NOTICE_METADATA_MISSING");
    item.notices = notices;
  }

  if (!Array.isArray(item.certifications) || !item.certifications.length) {
    const mandatoryCertifications = Array.isArray(metadata.certifications)
      ? metadata.certifications
        .map(recordValue)
        .filter((row): row is UnknownRecord => Boolean(row))
        .filter((certification) => certification.required === "MANDATORY")
      : [];
    const coded = mandatoryCertifications.filter((certification) =>
      certification.dataType === "CODE");
    if (coded.length) throw new Error("COUPANG_CERTIFICATION_REQUIRED");
    item.certifications = mandatoryCertifications.map((certification) => ({
      certificationType: certification.certificationType,
      certificationCode: "",
    }));
  }
  return item;
}

async function prepareCoupangListing(input: PrepareProviderListingInput): Promise<UnknownRecord> {
  const requestedBy = textValue(input.credential, "requested_by");
  if (!requestedBy) throw new Error("COUPANG_WING_USER_ID_MISSING");
  const recovery = coupangExactQaRecoveryBinding(input.arguments, "listing.update");
  if (Object.hasOwn(input.arguments, "sellerpilotCoupangExactQaRecovery") && !recovery) {
    throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
  }
  const strictArguments = recovery
    ? prepareCoupangExactQaRecoveryArguments(input.arguments)
    : input.arguments;
  const body = structuredClone(recordValue(strictArguments.body) ?? {});
  const categoryCode = Number(body.displayCategoryCode);
  if (!Number.isSafeInteger(categoryCode) || categoryCode <= 0) {
    throw new Error("COUPANG_DISPLAY_CATEGORY_REQUIRED");
  }
  const vendorId = textValue(input.credential, "vendor_id");
  await input.hooks.assertLeaseHealthy();
  const [outboundRemote, returnRemote, metadataRemote, categoryStatusRemote] = await Promise.all([
    coupangRequest({
      payload: input.credential,
      method: "GET",
      path: "/v2/providers/marketplace_openapi/apis/api/v2/vendor/shipping-place/outbound",
      query: new URLSearchParams({ pageSize: "50", pageNum: "1" }),
    }),
    coupangRequest({
      payload: input.credential,
      method: "GET",
      path: `/v2/providers/openapi/apis/api/v5/vendors/${encodeURIComponent(vendorId)}/returnShippingCenters`,
      query: new URLSearchParams({ pageNum: "1", pageSize: "50" }),
    }),
    coupangRequest({
      payload: input.credential,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${categoryCode}`,
    }),
    recovery ? coupangRequest({
      payload: input.credential,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryCode}/status`,
    }) : Promise.resolve(null),
  ]);
  if (!outboundRemote.response.ok) throw new Error("COUPANG_OUTBOUND_QUERY_FAILED");
  if (!returnRemote.response.ok) throw new Error("COUPANG_RETURN_CENTER_QUERY_FAILED");
  if (!metadataRemote.response.ok) throw new Error("COUPANG_CATEGORY_METADATA_FAILED");
  if (recovery && (!categoryStatusRemote
      || !categoryStatusRemote.response.ok
      || categoryStatusRemote.data.code !== "SUCCESS"
      || categoryStatusRemote.data.data !== true)) {
    throw new Error("COUPANG_EXACT_QA_CATEGORY_INACTIVE");
  }

  const outboundCenters = nestedContent(outboundRemote.data)
    .map(recordValue)
    .filter((row): row is UnknownRecord => Boolean(row));
  const returnCenters = nestedContent(returnRemote.data)
    .map(recordValue)
    .filter((row): row is UnknownRecord => Boolean(row));
  const outbound = outboundCenters.find((center) =>
    coupangUsable(center.usable)
    && preferredKoreanAddress(center.placeAddresses)
    && (!recovery || (Number.isSafeInteger(Number(center.outboundShippingPlaceCode))
      && Number(center.outboundShippingPlaceCode) > 0)));
  const returnCenter = returnCenters.find((center) =>
    coupangUsable(center.usable)
    && preferredKoreanAddress(center.placeAddresses)
    && (!recovery || (String(center.returnCenterCode ?? "").trim()
      && String(center.deliverCode ?? "").trim()
      && positiveFee(center))));
  if (!returnCenter) {
    throw new Error(`COUPANG_USABLE_RETURN_CENTER_MISSING:${safeCoupangCenterSummary(returnCenters)}`);
  }
  if (!outbound) {
    throw new Error(`COUPANG_USABLE_OUTBOUND_CENTER_MISSING:${safeCoupangCenterSummary(outboundCenters)}`);
  }
  const returnAddress = preferredKoreanAddress(returnCenter.placeAddresses);
  if (!returnAddress) throw new Error("COUPANG_RETURN_ADDRESS_MISSING");
  const contractedDeliveryCode = String(returnCenter.deliverCode ?? "").trim();
  const returnFee = positiveFee(returnCenter) ?? (recovery ? null : 3_000);
  if (!returnFee) throw new Error("COUPANG_RETURN_FEE_MISSING");
  const returnCenterCode = contractedDeliveryCode
    ? String(returnCenter.returnCenterCode)
    : "NO_RETURN_CENTERCODE";
  if (recovery && (returnCenterCode === "NO_RETURN_CENTERCODE"
      || !String(returnAddress.companyContactNumber ?? "").trim()
      || !String(returnAddress.returnZipCode ?? "").trim()
      || !String(returnAddress.returnAddress ?? "").trim())) {
    throw new Error("COUPANG_EXACT_QA_ACTIVE_SHIPPING_METADATA_REQUIRED");
  }
  const metadata = coupangMetadata(metadataRemote.data);
  const facts = recordValue(strictArguments.facts) ?? {};
  const items = Array.isArray(body.items)
    ? body.items.map((item) => {
      const prepared = prepareCoupangItem(
        item,
        metadata,
        facts,
        recovery ? coupangExactQaRecoveryIdentity.noticeCategoryName : undefined,
      );
      prepared.originalPrice = normalizeTenWonAmount(prepared.originalPrice);
      prepared.salePrice = normalizeTenWonAmount(prepared.salePrice);
      return prepared;
    })
    : [];
  if (!items.length) throw new Error("COUPANG_ITEMS_MISSING");

  return {
    ...strictArguments,
    body: {
      ...body,
      vendorId,
      displayProductName: body.displayProductName || body.sellerProductName,
      saleStartedAt: body.saleStartedAt
        || new Date(Date.now() - 60_000).toISOString().slice(0, 19),
      saleEndedAt: body.saleEndedAt || "2099-01-01T23:59:59",
      deliveryCompanyCode: contractedDeliveryCode || "CJGLS",
      deliveryChargeType: "FREE",
      deliveryCharge: 0,
      freeShipOverAmount: 0,
      deliveryChargeOnReturn: returnFee,
      remoteAreaDeliverable: "N",
      unionDeliveryType: "UNION_DELIVERY",
      outboundShippingPlaceCode: Number(outbound.outboundShippingPlaceCode),
      returnCenterCode,
      returnChargeName: String(returnCenter.shippingPlaceName ?? ""),
      companyContactNumber: String(returnAddress.companyContactNumber ?? ""),
      returnZipCode: String(returnAddress.returnZipCode ?? ""),
      returnAddress: String(returnAddress.returnAddress ?? ""),
      returnAddressDetail: String(returnAddress.returnAddressDetail ?? ""),
      returnCharge: returnFee,
      vendorUserId: requestedBy,
      requested: strictArguments.publicationIntent === "safe_test" ? false : true,
      items,
    },
  };
}

export async function prepareMarketplaceListingArguments(
  input: PrepareProviderListingInput,
): Promise<PreparedProviderListing> {
  if (input.channel === "shopee") {
    if (input.arguments.globalProduct === true) {
      if (input.operation !== "listing.create") {
        return { arguments: input.arguments, mediaMutationObserved: false };
      }
      if (input.arguments.resumeOnly === true) {
        if (shopeeSgExactCreateRequested(input.arguments)) {
          throw new Error("SHOPEE_SG_EXACT_CREATE_RESUME_REQUIRES_FRESH_PREFLIGHT");
        }
        return { arguments: input.arguments, mediaMutationObserved: false };
      }
      return {
        arguments: await prepareShopeeGlobalListing(input),
        mediaMutationObserved: true,
      };
    }
    return {
      arguments: await prepareShopeeListing(input),
      mediaMutationObserved: true,
    };
  }
  if (input.channel === "lazada") {
    return {
      arguments: await prepareLazadaListing(input),
      mediaMutationObserved: true,
    };
  }
  if (input.channel === "smartstore") {
    return {
      arguments: await prepareSmartstoreListing(input),
      mediaMutationObserved: true,
    };
  }
  if (input.channel === "coupang" && (input.operation === "listing.create"
      || coupangExactQaRecoveryBinding(input.arguments, "listing.update"))) {
    return {
      arguments: await prepareCoupangListing(input),
      mediaMutationObserved: false,
    };
  }
  return { arguments: input.arguments, mediaMutationObserved: false };
}
