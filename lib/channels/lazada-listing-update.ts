type UnknownRecord = Record<string, unknown>;

export const lazadaExistingListingUpdateContract =
  "lazada_existing_listing_update_v1" as const;

export type LazadaExistingListingUpdatePreflight = {
  contract: typeof lazadaExistingListingUpdateContract;
  itemId: string;
  country: string;
  primaryCategory: string;
  sellerSku: string;
  skuId: string;
  price: string;
  quantity: number;
  providerStatus: string;
  updateSkuStatus?: "inactive";
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

function strictArray(value: unknown) {
  if (Array.isArray(value)) return value.map(recordValue);
  const row = recordValue(value);
  return Object.keys(row).length ? [row] : [];
}

function finiteDecimal(value: unknown) {
  const raw = exactText(value);
  if (!raw || !/^\d+(?:\.\d{1,2})?$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 999_999_999
    ? parsed
    : null;
}

function nonNegativeInteger(value: unknown) {
  const raw = exactText(value);
  if (!raw || !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 99_999_999
    ? parsed
    : null;
}

function normalizedMoney(value: number) {
  return value.toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1");
}

export function lazadaProductFromReadback(remoteData: UnknownRecord) {
  const data = recordValue(remoteData.data);
  const item = recordValue(data.item);
  return Object.keys(item).length ? item : data;
}

export function lazadaSkuRows(value: unknown) {
  const product = recordValue(value);
  const skus = recordValue(product.Skus);
  return strictArray(product.skus ?? skus.Sku);
}

export function lazadaPrimaryCategory(value: unknown) {
  const product = recordValue(value);
  return exactText(
    product.PrimaryCategory
      ?? product.primary_category
      ?? product.primaryCategory
      ?? product.primary_category_id,
  );
}

function requestedProduct(argumentsValue: UnknownRecord) {
  return recordValue(recordValue(recordValue(argumentsValue.request).Request).Product);
}

function requestedSku(argumentsValue: UnknownRecord) {
  const skus = lazadaSkuRows(requestedProduct(argumentsValue));
  if (skus.length !== 1) throw new Error("LAZADA_UPDATE_SINGLE_SKU_REQUIRED");
  const sellerSku = exactText(skus[0].SellerSku ?? skus[0].seller_sku);
  const price = finiteDecimal(skus[0].price ?? skus[0].Price);
  const quantity = nonNegativeInteger(skus[0].quantity ?? skus[0].Quantity);
  if (!sellerSku) throw new Error("LAZADA_UPDATE_SELLER_SKU_REQUIRED");
  if (price === null) throw new Error("LAZADA_UPDATE_PRICE_REQUIRED");
  if (quantity === null) throw new Error("LAZADA_UPDATE_QUANTITY_REQUIRED");
  return { sellerSku, price, quantity };
}

export function lazadaRequestedUpdateSellerSku(argumentsValue: UnknownRecord) {
  try {
    return requestedSku(argumentsValue).sellerSku;
  } catch {
    return null;
  }
}

export function lazadaRequestedUpdateQuantity(argumentsValue: UnknownRecord) {
  try {
    return requestedSku(argumentsValue).quantity;
  } catch {
    return null;
  }
}

function providerStatus(product: UnknownRecord, sku: UnknownRecord) {
  return exactText(sku.Status ?? sku.status ?? product.Status ?? product.status)
    .toUpperCase();
}

function remoteSkuId(sku: UnknownRecord) {
  return exactText(sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId);
}

function specialPrice(sku: UnknownRecord) {
  const raw = exactText(sku.special_price ?? sku.SpecialPrice ?? sku.specialPrice);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function productsFromGetProducts(remoteData: UnknownRecord) {
  const data = recordValue(remoteData.data);
  const lowercaseContainer = recordValue(data.products);
  const uppercaseContainer = recordValue(data.Products);
  const value = Array.isArray(data.products)
    ? data.products
    : Array.isArray(data.Products)
      ? data.Products
      : lowercaseContainer.product
        ?? lowercaseContainer.Product
        ?? uppercaseContainer.product
        ?? uppercaseContainer.Product;
  return strictArray(value);
}

/**
 * GetProducts is queried by the exact SellerSku before GetProductItem is
 * trusted. This detects the dangerous case where the requested SellerSku is
 * absent or resolves to a different/duplicate item under the current seller.
 */
export function assertLazadaExistingListingGetProductsPreflight(input: {
  argumentsValue: UnknownRecord;
  remoteData: UnknownRecord;
}) {
  const itemId = exactText(input.argumentsValue.itemId);
  if (!/^\d+$/u.test(itemId)) throw new Error("LAZADA_UPDATE_ITEM_ID_REQUIRED");
  const requested = requestedSku(input.argumentsValue);
  const products = productsFromGetProducts(input.remoteData);
  const matches = products.flatMap((product) => {
    const remoteItemId = exactText(product.item_id ?? product.ItemId ?? product.itemId);
    return lazadaSkuRows(product)
      .filter((sku) => exactText(sku.SellerSku ?? sku.seller_sku) === requested.sellerSku)
      .map((sku) => ({ remoteItemId, sku }));
  });
  if (products.length !== 1 || matches.length !== 1) {
    throw new Error("LAZADA_UPDATE_GET_PRODUCTS_IDENTITY_AMBIGUOUS");
  }
  if (matches[0]?.remoteItemId !== itemId) {
    throw new Error("LAZADA_UPDATE_GET_PRODUCTS_ITEM_ID_MISMATCH");
  }
  const skuId = remoteSkuId(matches[0].sku);
  if (!/^\d+$/u.test(skuId)) {
    throw new Error("LAZADA_UPDATE_GET_PRODUCTS_SKU_IDENTITY_MISMATCH");
  }
  return {
    itemId,
    sellerSku: requested.sellerSku,
    skuId,
  };
}

/**
 * Validates Lazada's authoritative GetProductItem response before any media or
 * product mutation. The released SellerPilot update deliberately supports one
 * existing SKU only; options are never inferred or expanded.
 */
export function assertLazadaExistingListingUpdatePreflight(input: {
  argumentsValue: UnknownRecord;
  remoteData: UnknownRecord;
  country: string;
  requiredVisibility?: "live" | "non_public";
}): LazadaExistingListingUpdatePreflight {
  const country = input.country.trim().toLowerCase();
  const requestedCountry = exactText(input.argumentsValue.country).toLowerCase();
  if (!/^(?:id|my|ph|sg|th|vn)$/u.test(country)
      || !requestedCountry
      || requestedCountry !== country) {
    throw new Error("LAZADA_UPDATE_COUNTRY_MISMATCH");
  }
  const itemId = exactText(input.argumentsValue.itemId);
  if (!/^\d+$/u.test(itemId)) throw new Error("LAZADA_UPDATE_ITEM_ID_REQUIRED");
  const sourceProduct = requestedProduct(input.argumentsValue);
  const primaryCategory = lazadaPrimaryCategory(sourceProduct);
  if (!/^\d+$/u.test(primaryCategory)) {
    throw new Error("LAZADA_UPDATE_PRIMARY_CATEGORY_REQUIRED");
  }
  const requested = requestedSku(input.argumentsValue);

  const product = lazadaProductFromReadback(input.remoteData);
  const remoteItemId = exactText(product.item_id ?? product.ItemId ?? product.itemId);
  if (remoteItemId !== itemId) throw new Error("LAZADA_UPDATE_ITEM_ID_MISMATCH");
  if (lazadaPrimaryCategory(product) !== primaryCategory) {
    throw new Error("LAZADA_UPDATE_CATEGORY_MISMATCH");
  }
  const remoteSkus = lazadaSkuRows(product);
  if (remoteSkus.length !== 1) throw new Error("LAZADA_UPDATE_REMOTE_SINGLE_SKU_REQUIRED");
  const remoteSku = remoteSkus[0];
  const sellerSku = exactText(remoteSku.SellerSku ?? remoteSku.seller_sku);
  const skuId = remoteSkuId(remoteSku);
  if (sellerSku !== requested.sellerSku || !/^\d+$/u.test(skuId)) {
    throw new Error("LAZADA_UPDATE_SKU_IDENTITY_MISMATCH");
  }
  const status = providerStatus(product, remoteSku);
  const requiredVisibility = input.requiredVisibility ?? "live";
  if (requiredVisibility === "live" && !["ACTIVE", "LIVE", "ONLINE"].includes(status)) {
    throw new Error("LAZADA_UPDATE_REMOTE_SKU_NOT_LIVE");
  }
  if (requiredVisibility === "non_public"
      && !["INACTIVE", "OFFLINE", "SUSPENDED", "UNLIST", "UNLISTED"].includes(status)) {
    throw new Error("LAZADA_UPDATE_REMOTE_SKU_NOT_NON_PUBLIC");
  }
  if (specialPrice(remoteSku) !== 0) {
    throw new Error("LAZADA_UPDATE_ACTIVE_SPECIAL_PRICE_UNSUPPORTED");
  }
  if ((Array.isArray(remoteSku.multiWarehouseInventories)
      && remoteSku.multiWarehouseInventories.length > 0)
      || (Array.isArray(remoteSku.fblWarehouseInventories)
        && remoteSku.fblWarehouseInventories.length > 0)) {
    throw new Error("LAZADA_UPDATE_WAREHOUSE_INVENTORY_UNSUPPORTED");
  }

  return {
    contract: lazadaExistingListingUpdateContract,
    itemId,
    country,
    primaryCategory,
    sellerSku,
    skuId,
    price: normalizedMoney(requested.price),
    quantity: requested.quantity,
    providerStatus: status,
    ...(requiredVisibility === "non_public" ? { updateSkuStatus: "inactive" as const } : {}),
  };
}

export function bindLazadaExistingSkuToUpdateRequest(
  argumentsValue: UnknownRecord,
  preflight: LazadaExistingListingUpdatePreflight,
) {
  const normalized = structuredClone(argumentsValue);
  const request = recordValue(normalized.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  product.PrimaryCategory = preflight.primaryCategory;
  product.Skus = {
    Sku: [{
      SkuId: preflight.skuId,
      SellerSku: preflight.sellerSku,
      price: preflight.price,
      quantity: String(preflight.quantity),
      ...(preflight.updateSkuStatus ? { Status: preflight.updateSkuStatus } : {}),
    }],
  };
  requestRoot.Product = product;
  request.Request = requestRoot;
  normalized.request = request;
  normalized.sellerpilotLazadaUpdatePreflight = preflight;
  return normalized;
}

export function lazadaCategoryTreeLeaf(value: unknown, categoryId: string) {
  let matched: UnknownRecord | null = null;
  const visit = (candidate: unknown, depth = 0) => {
    if (matched || depth > 30 || candidate == null) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    const row = recordValue(candidate);
    if (!Object.keys(row).length) return;
    const id = exactText(row.category_id ?? row.categoryId ?? row.id);
    if (id === categoryId) {
      matched = row;
      return;
    }
    for (const child of Object.values(row)) visit(child, depth + 1);
  };
  visit(value);
  const category = matched as UnknownRecord | null;
  if (!category) return false;
  const leaf = category.leaf ?? category.is_leaf ?? category.isLeaf;
  return leaf === true || leaf === 1 || leaf === "1" || exactText(leaf).toLowerCase() === "true";
}

export function lazadaCategoryAttributeCount(value: unknown) {
  const root = recordValue(value);
  const data = root.data;
  if (Array.isArray(data)) return data.filter((item) => Object.keys(recordValue(item)).length > 0).length;
  const dataRecord = recordValue(data);
  for (const key of ["attributes", "attribute", "items"]) {
    if (Array.isArray(dataRecord[key])) {
      return (dataRecord[key] as unknown[])
        .filter((item) => Object.keys(recordValue(item)).length > 0).length;
    }
  }
  return 0;
}

export function lazadaUpdateCommerceReadbackVerified(
  mutationArguments: UnknownRecord,
  remoteData: UnknownRecord,
) {
  const product = lazadaProductFromReadback(remoteData);
  const expectedProduct = requestedProduct(mutationArguments);
  const expectedCategory = lazadaPrimaryCategory(expectedProduct);
  const expectedSkus = lazadaSkuRows(expectedProduct);
  const remoteSkus = lazadaSkuRows(product);
  if (!expectedCategory || lazadaPrimaryCategory(product) !== expectedCategory
      || expectedSkus.length < 1 || expectedSkus.length !== remoteSkus.length) return false;
  const remoteBySellerSku = new Map(remoteSkus.map((sku) => [
    exactText(sku.SellerSku ?? sku.seller_sku),
    sku,
  ]));
  if (remoteBySellerSku.size !== remoteSkus.length || remoteBySellerSku.has("")) return false;
  return expectedSkus.every((expected) => {
    const sellerSku = exactText(expected.SellerSku ?? expected.seller_sku);
    const remote = remoteBySellerSku.get(sellerSku);
    if (!sellerSku || !remote) return false;
    const expectedSkuId = remoteSkuId(expected);
    const expectedPrice = finiteDecimal(expected.price ?? expected.Price);
    const remotePrice = finiteDecimal(remote.price ?? remote.Price);
    const expectedQuantity = nonNegativeInteger(expected.quantity ?? expected.Quantity);
    const remoteQuantity = nonNegativeInteger(remote.quantity ?? remote.Quantity);
    return Boolean(
      (!expectedSkuId || expectedSkuId === remoteSkuId(remote))
        && remoteSkuId(remote)
        && expectedPrice !== null
        && remotePrice !== null
        && Math.abs(expectedPrice - remotePrice) < 0.000_001
        && expectedQuantity !== null
        && expectedQuantity === remoteQuantity
        && specialPrice(remote) === 0,
    );
  });
}
