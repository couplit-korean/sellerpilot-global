import { everySku, skuQuantity, skuRecord, skuRows } from "../product-registration/sku-contract";

export function shopeeCreateConditionValid(value: unknown) {
  return typeof value === "string" && ["NEW", "USED"].includes(value.toUpperCase());
}

// add_global_item update log: normal_stock sunset 2024-10-23;
// condition mandatory 2026-09-01. Keep legacy drafts readable, but send the
// documented seller_stock field without silently choosing conflicting values.
export function shopeeGlobalCreateBody(source: Record<string, unknown>, strict: boolean) {
  const body = structuredClone(source);
  if (strict && !shopeeCreateConditionValid(body.condition)) {
    throw new Error("SHOPEE_CREATE_CONDITION_REQUIRED");
  }
  const rows = skuRows(body.seller_stock);
  if (Object.hasOwn(body, "seller_stock")) {
    if (!everySku(rows, row => skuQuantity(row.stock))) throw new Error("SHOPEE_CREATE_STOCK_INVALID");
    if (Object.hasOwn(body, "normal_stock") && (!skuQuantity(body.normal_stock)
        || rows.reduce((sum, row) => sum + Number(row.stock), 0) !== Number(body.normal_stock))) {
      throw new Error("SHOPEE_CREATE_STOCK_CONFLICT");
    }
  } else if (Object.hasOwn(body, "normal_stock")) {
    if (!skuQuantity(body.normal_stock)) throw new Error("SHOPEE_CREATE_STOCK_INVALID");
    body.seller_stock = [{ stock: Number(body.normal_stock) }];
  }
  delete body.normal_stock;
  return body;
}

export function shopeeCreateStockValid(bodyValue: unknown) {
  const body = skuRecord(bodyValue);
  try {
    const normalized = shopeeGlobalCreateBody(body, false);
    return everySku(skuRows(normalized.seller_stock), row => skuQuantity(row.stock));
  } catch { return false; }
}
