import { everySku, skuPositive, skuQuantity, skuRecord, skuRows, skuText, uniqueSkuIds } from "../product-registration/sku-contract";
import type { RemoteResponse } from "./protocols";

export const lazadaCreateSellerSkuAbsenceContract =
  "lazada_create_seller_sku_absence_v1" as const;

export type LazadaCreatePriceMode = "standard" | "marketplace_ease";

function requestedSkuRows(argumentsValue: unknown) {
  const request = skuRecord(skuRecord(argumentsValue).request);
  const product = skuRecord(skuRecord(request.Request).Product);
  return skuRows(skuRecord(product.Skus).Sku);
}

export function lazadaCreateSellerSkus(argumentsValue: unknown) {
  const rows = requestedSkuRows(argumentsValue);
  const sellerSkus = rows.map((row) =>
    typeof row.SellerSku === "string" ? row.SellerSku.trim() : "");
  if (!rows.length
      || rows.some((row) => !skuText(row.SellerSku))
      || sellerSkus.some((sellerSku) => /["*^~<>/|]/u.test(sellerSku))
      || new Set(sellerSkus).size !== sellerSkus.length
      || sellerSkus.length > 100) {
    throw new Error("LAZADA_CREATE_SELLER_SKU_INVALID");
  }
  return sellerSkus;
}

/**
 * GetProducts is filtered by the complete SellerSku list. Only an explicit,
 * internally consistent zero-result page proves absence. Transport/provider
 * errors and malformed pagination never become permission to create.
 */
export function assertLazadaCreateSellerSkuAbsence(
  remote: RemoteResponse,
  sellerSkus: readonly string[],
) {
  if (!sellerSkus.length
      || sellerSkus.length > 100
      || sellerSkus.some((sellerSku) =>
        !skuText(sellerSku) || /["*^~<>/|]/u.test(sellerSku))
      || new Set(sellerSkus.map((sellerSku) => sellerSku.trim())).size
        !== sellerSkus.length) {
    throw new Error("LAZADA_CREATE_SELLER_SKU_INVALID");
  }
  const data = skuRecord(remote.data.data);
  const totalProductsText = typeof data.total_products === "number"
    || typeof data.total_products === "string"
    ? String(data.total_products).trim()
    : "";
  const totalProducts = Number(totalProductsText);
  if (!remote.response.ok
      || String(remote.data.code ?? "").trim() !== "0"
      || !/^\d+$/u.test(totalProductsText)
      || !Number.isSafeInteger(totalProducts)
      || totalProducts < 0
      || !Array.isArray(data.products)
      || totalProducts !== data.products.length) {
    throw new Error("LAZADA_CREATE_SELLER_SKU_PREFLIGHT_FAILED");
  }
  if (totalProducts !== 0) {
    throw new Error("LAZADA_CREATE_SELLER_SKU_ALREADY_EXISTS");
  }
  return {
    contract: lazadaCreateSellerSkuAbsenceContract,
    requestedSellerSkuCount: sellerSkus.length,
    matchedProductCount: 0,
  };
}

// CreateProduct requires complete data for every SKU, including later variants.
// Marketplace Ease has a different, mutually exclusive price field. Keeping
// the mode explicit prevents a valid supply_price request from being rejected
// by a standard-seller check (or the two seller contracts from being mixed).
export function lazadaCreateSkuChecks(
  argumentsValue: unknown,
  mode: LazadaCreatePriceMode = "standard",
) {
  const rows = requestedSkuRows(argumentsValue);
  return {
    sku: uniqueSkuIds(rows, "SellerSku"),
    price: mode === "standard"
      ? everySku(rows, row => skuPositive(row.price)
        && row.supply_price === undefined
        && row.SupplyPrice === undefined)
      : everySku(rows, row => skuPositive(row.supply_price)
        && row.price === undefined
        && row.Price === undefined
        && row.special_price === undefined
        && row.SpecialPrice === undefined),
    stock: everySku(rows, row => skuQuantity(row.quantity)),
    package: everySku(rows, row => skuText(row.package_content)
      && ["package_weight", "package_length", "package_width", "package_height"].every(key => skuPositive(row[key]))),
  };
}
