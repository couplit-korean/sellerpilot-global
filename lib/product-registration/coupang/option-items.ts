import {
  assertCoupangGeneralCreateRequiredFields,
  coupangCreateItems,
  type CoupangCreateRecord,
} from "./create-required-fields";

type UnknownRecord = Record<string, unknown>;

export type CoupangOptionRow = {
  skuSuffix: string;
  itemName: string;
  barcode: string;
  modelNo: string;
  emptyBarcodeReason: string;
  salePrice: number;
  stock: number;
  unitCount: number;
  purchaseOptions: Array<{ name: string; value: string }>;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveInteger(value: unknown, maximum: number): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9][0-9]*$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : null;
}

function optionRows(value: unknown): CoupangOptionRow[] {
  if (!Array.isArray(value)) throw new Error("COUPANG_OPTION_ROWS_INVALID");
  if (value.length > 200) throw new Error("COUPANG_ITEM_LIMIT_EXCEEDED");
  return value.map((candidate) => {
    const row = record(candidate);
    if (!row) throw new Error("COUPANG_OPTION_ROW_INVALID");
    const skuSuffix = text(row.skuSuffix);
    const itemName = text(row.itemName);
    const barcode = text(row.barcode);
    const modelNo = text(row.modelNo);
    const emptyBarcodeReason = text(row.emptyBarcodeReason);
    const salePrice = positiveInteger(row.salePrice, Number.MAX_SAFE_INTEGER);
    const stock = positiveInteger(row.stock, 99_999);
    const unitCount = positiveInteger(row.unitCount, 99_999);
    const rawOptions = Array.isArray(row.purchaseOptions) ? row.purchaseOptions : [];
    const purchaseOptions = rawOptions.map((candidateOption) => {
      const option = record(candidateOption);
      const name = text(option?.name);
      const optionValue = text(option?.value);
      if (!name || !optionValue) throw new Error("COUPANG_OPTION_VALUE_REQUIRED");
      return { name, value: optionValue };
    });
    if (!skuSuffix || !/^[A-Za-z0-9._-]+$/u.test(skuSuffix)) {
      throw new Error("COUPANG_OPTION_SKU_SUFFIX_INVALID");
    }
    if (!itemName) throw new Error("COUPANG_OPTION_ITEM_NAME_REQUIRED");
    if (!salePrice || !stock || !unitCount) {
      throw new Error("COUPANG_OPTION_PRICE_STOCK_UNIT_INVALID");
    }
    if (!purchaseOptions.length
      || new Set(purchaseOptions.map((option) => option.name)).size !== purchaseOptions.length) {
      throw new Error("COUPANG_OPTION_VALUE_REQUIRED");
    }
    if (barcode ? emptyBarcodeReason !== "" : !modelNo || !emptyBarcodeReason) {
      throw new Error("COUPANG_OPTION_IDENTIFIER_REQUIRED");
    }
    return {
      skuSuffix,
      itemName,
      barcode,
      modelNo,
      emptyBarcodeReason,
      salePrice,
      stock,
      unitCount,
      purchaseOptions,
    };
  });
}

function withoutPurchaseOptions(sourceValue: CoupangCreateRecord, row: CoupangOptionRow) {
  const optionNames = new Set(row.purchaseOptions.map((option) => option.name));
  const source = structuredClone(sourceValue);
  source.attributes = Array.isArray(source.attributes)
    ? source.attributes.filter((candidate) => {
      const attribute = record(candidate);
      return attribute && !optionNames.has(text(attribute.attributeTypeName));
    })
    : [];
  return source;
}

/**
 * Compile seller-entered option rows into provider items without allowing a
 * saved draft to write raw identity fields. The function is deterministic and
 * idempotent so provider preparation and the channel executor can both call it.
 */
export function compileCoupangOptionItems(
  bodyValue: UnknownRecord,
  optionRowsValue: unknown,
  baseSellerSkuValue?: unknown,
): UnknownRecord {
  const body = structuredClone(bodyValue);
  const items = coupangCreateItems(body.items);
  if (!items) throw new Error("COUPANG_CREATE_ITEMS_REQUIRED_OR_INVALID");
  const rows = optionRows(optionRowsValue);

  if (!rows.length) {
    body.items = items.map((item) => {
      const next = structuredClone(item);
      if (text(next.modelNo) === text(next.externalVendorSku)) {
        next.modelNo = "";
      }
      return next;
    });
    return body;
  }

  const baseSellerSku = text(baseSellerSkuValue);
  if (!baseSellerSku) throw new Error("COUPANG_OPTION_BASE_SKU_REQUIRED");
  const expectedSkus = rows.map((row) => `${baseSellerSku}-${row.skuSuffix}`);
  if (expectedSkus.some((sellerSku) => sellerSku.length > 100)) {
    throw new Error("COUPANG_OPTION_SELLER_SKU_TOO_LONG");
  }
  if (new Set(expectedSkus).size !== expectedSkus.length) {
    throw new Error("COUPANG_OPTION_SELLER_SKU_DUPLICATE");
  }
  const initialTemplate = items.length === 1
    && text(items[0].externalVendorSku) === baseSellerSku;
  const existingBySku = new Map(items.map((item) => [text(item.externalVendorSku), item]));
  const compiledTemplateSet = items.length === rows.length
    && expectedSkus.every((sellerSku) => existingBySku.has(sellerSku));
  if (!initialTemplate && !compiledTemplateSet) {
    throw new Error("COUPANG_OPTION_TEMPLATE_INVALID");
  }
  const compiled = rows.map((row, index) => {
    const externalVendorSku = expectedSkus[index];
    const template = withoutPurchaseOptions(
      initialTemplate ? items[0] : existingBySku.get(externalVendorSku)!,
      row,
    );
    if (externalVendorSku.length > 100) throw new Error("COUPANG_OPTION_SELLER_SKU_TOO_LONG");
    return {
      ...structuredClone(template),
      itemName: row.itemName,
      externalVendorSku,
      barcode: row.barcode,
      emptyBarcode: !row.barcode,
      emptyBarcodeReason: row.barcode ? "" : row.emptyBarcodeReason,
      modelNo: row.modelNo,
      originalPrice: row.salePrice,
      salePrice: row.salePrice,
      maximumBuyCount: row.stock,
      maximumBuyForPerson: row.stock,
      unitCount: row.unitCount,
      attributes: [
        ...(template.attributes as unknown[]),
        ...row.purchaseOptions.map((option) => ({
          attributeTypeName: option.name,
          attributeValueName: option.value,
          exposed: "EXPOSED",
        })),
      ],
    };
  });
  body.items = compiled;
  assertCoupangGeneralCreateRequiredFields(body);
  return body;
}
