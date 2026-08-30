import { assertPublicReferenceUrl } from "../public-reference-fetch";
import type { GatewayClaim } from "./gateway-contract";
import {
  mergeShopeeRequiredAttributes,
  normalizeCoupangAttributeValue,
  normalizeTenWonAmount,
  replaceMarketplaceImageUrls,
} from "./listing-normalization";
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
  const globalCategoryId = Number(body.category_id);
  if (!Number.isSafeInteger(globalCategoryId) || globalCategoryId <= 0) {
    throw new Error("SHOPEE_GLOBAL_CATEGORY_MISSING");
  }
  const shopRequest = dependencies.shopRequest ?? shopeeRequest;
  const merchantRequest = dependencies.merchantRequest ?? shopeeMerchantRequest;
  const uploadImage = dependencies.uploadImage ?? uploadShopeeImage;
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
  assertShopeeLeafCategory(globalCategoryRemote, globalCategoryId, "SHOPEE_GLOBAL_CATEGORY_INVALID");
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
  const productHint = `${String(publishItem.item_name ?? body.global_item_name ?? "")} ${String(publishItem.description ?? body.description ?? "")}`;
  const globalAttributes = requiredShopeeAttributes({
    supplied: body.attribute_list,
    metadata: globalAttributeMetadata,
    productHint,
    errorCode: "SHOPEE_GLOBAL_REQUIRED_ATTRIBUTES_MISSING",
  });
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

async function prepareLazadaListing(input: PrepareProviderListingInput): Promise<UnknownRecord> {
  const imageUrls = uniqueImageUrls(input.arguments.imageUrls, 20);
  if (!imageUrls.length) throw new Error("LAZADA_LISTING_IMAGES_MISSING");
  const migrated: string[] = [];
  for (const imageUrl of imageUrls) {
    await input.hooks.assertLeaseHealthy();
    await assertPublicReferenceUrl(imageUrl, { signal: input.signal });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Request><Image><Url>${xmlEscape(imageUrl)}</Url></Image></Request>`;
    await input.hooks.beginProviderMutation();
    const remote = await lazadaRequest({
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

  const request = structuredClone(recordValue(input.arguments.request) ?? {});
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot?.Product);
  if (!requestRoot || !product) throw new Error("CHANNEL_ARGUMENT_REQUIRED:request.Request.Product");
  const replacements = new Map(imageUrls.map((source, index) => [source, migrated[index]]));
  const migratedProduct = recordValue(replaceMarketplaceImageUrls(product, replacements));
  if (!migratedProduct) throw new Error("LAZADA_PRODUCT_IMAGE_REWRITE_FAILED");
  requestRoot.Product = migratedProduct;
  const listingImages = migrated.slice(0, 8);
  migratedProduct.Images = { Image: listingImages };
  const skusRoot = recordValue(migratedProduct.Skus);
  const skus = Array.isArray(skusRoot?.Sku) ? skusRoot.Sku : [];
  for (const sku of skus) {
    const row = recordValue(sku);
    if (row) row.Images = { Image: listingImages };
  }
  return { ...input.arguments, request };
}

async function prepareSmartstoreListing(input: PrepareProviderListingInput): Promise<UnknownRecord> {
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

  if (!Array.isArray(item.notices) || !item.notices.length) {
    const noticeCategories = Array.isArray(metadata.noticeCategories)
      ? metadata.noticeCategories.map(recordValue).filter((row): row is UnknownRecord => Boolean(row))
      : [];
    const noticeCategory = noticeCategories.find((category) =>
      Array.isArray(category.noticeCategoryDetailNames)
      && category.noticeCategoryDetailNames.some((detail) =>
        recordValue(detail)?.required === "MANDATORY"))
      ?? noticeCategories[0];
    const details = Array.isArray(noticeCategory?.noticeCategoryDetailNames)
      ? noticeCategory.noticeCategoryDetailNames
        .map(recordValue)
        .filter((row): row is UnknownRecord => Boolean(row))
      : [];
    const notices = details
      .filter((detail) => detail.required === "MANDATORY")
      .map((detail) => ({
        noticeCategoryName: String(noticeCategory?.noticeCategoryName ?? ""),
        noticeCategoryDetailName: String(detail.noticeCategoryDetailName ?? ""),
        content: "상품상세 참조",
      }));
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
  const body = structuredClone(recordValue(input.arguments.body) ?? {});
  const categoryCode = Number(body.displayCategoryCode);
  if (!Number.isSafeInteger(categoryCode) || categoryCode <= 0) {
    throw new Error("COUPANG_DISPLAY_CATEGORY_REQUIRED");
  }
  const vendorId = textValue(input.credential, "vendor_id");
  await input.hooks.assertLeaseHealthy();
  const [outboundRemote, returnRemote, metadataRemote] = await Promise.all([
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
  ]);
  if (!outboundRemote.response.ok) throw new Error("COUPANG_OUTBOUND_QUERY_FAILED");
  if (!returnRemote.response.ok) throw new Error("COUPANG_RETURN_CENTER_QUERY_FAILED");
  if (!metadataRemote.response.ok) throw new Error("COUPANG_CATEGORY_METADATA_FAILED");

  const outboundCenters = nestedContent(outboundRemote.data)
    .map(recordValue)
    .filter((row): row is UnknownRecord => Boolean(row));
  const returnCenters = nestedContent(returnRemote.data)
    .map(recordValue)
    .filter((row): row is UnknownRecord => Boolean(row));
  const outbound = outboundCenters.find((center) =>
    coupangUsable(center.usable) && preferredKoreanAddress(center.placeAddresses));
  const returnCenter = returnCenters.find((center) =>
    coupangUsable(center.usable) && preferredKoreanAddress(center.placeAddresses));
  if (!returnCenter) {
    throw new Error(`COUPANG_USABLE_RETURN_CENTER_MISSING:${safeCoupangCenterSummary(returnCenters)}`);
  }
  if (!outbound) {
    throw new Error(`COUPANG_USABLE_OUTBOUND_CENTER_MISSING:${safeCoupangCenterSummary(outboundCenters)}`);
  }
  const returnAddress = preferredKoreanAddress(returnCenter.placeAddresses);
  if (!returnAddress) throw new Error("COUPANG_RETURN_ADDRESS_MISSING");
  const contractedDeliveryCode = String(returnCenter.deliverCode ?? "").trim();
  const returnFee = positiveFee(returnCenter) ?? 3_000;
  const returnCenterCode = contractedDeliveryCode
    ? String(returnCenter.returnCenterCode)
    : "NO_RETURN_CENTERCODE";
  const metadata = coupangMetadata(metadataRemote.data);
  const facts = recordValue(input.arguments.facts) ?? {};
  const items = Array.isArray(body.items)
    ? body.items.map((item) => {
      const prepared = prepareCoupangItem(item, metadata, facts);
      prepared.originalPrice = normalizeTenWonAmount(prepared.originalPrice);
      prepared.salePrice = normalizeTenWonAmount(prepared.salePrice);
      return prepared;
    })
    : [];
  if (!items.length) throw new Error("COUPANG_ITEMS_MISSING");

  return {
    ...input.arguments,
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
      requested: input.arguments.publicationIntent === "safe_test" ? false : true,
      items,
    },
  };
}

export async function prepareMarketplaceListingArguments(
  input: PrepareProviderListingInput,
): Promise<PreparedProviderListing> {
  if (input.channel === "shopee") {
    if (input.arguments.globalProduct === true) {
      if (input.operation !== "listing.create" || input.arguments.resumeOnly === true) {
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
  if (input.channel === "coupang" && input.operation === "listing.create") {
    return {
      arguments: await prepareCoupangListing(input),
      mediaMutationObserved: false,
    };
  }
  return { arguments: input.arguments, mediaMutationObserved: false };
}
