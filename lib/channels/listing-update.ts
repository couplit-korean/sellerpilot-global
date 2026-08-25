import type { ActiveChannelKey } from "./catalog";

export type ListingUpdateReference = {
  remoteId: string | null;
  status: string;
  publishedAt?: string | null;
};

export function listingWriteOperation(listing: ListingUpdateReference | null | undefined): "listing.create" | "listing.update" {
  const hasPublishedIdentity = Boolean(listing?.remoteId?.trim())
    && (listing?.status === "published" || Boolean(listing?.publishedAt));
  return hasPublishedIdentity ? "listing.update" : "listing.create";
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
  if (input.operation === "listing.update") {
    return {
      title: centralTitle,
      shortDescription: centralDescription.slice(0, 500),
      description: centralDescription,
    };
  }
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
  if (listingWriteOperation(listing) !== "listing.update" || !remoteId) {
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
  return {};
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
