import { normalizeListingShippingSource } from "../channels/listing-shipping";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Row)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function normalizedProductRegistrationManualFields(context: unknown): Row {
  const source = row(context);
  const product = row(source.product);
  const value = row(source.manualFields);
  return {
    ...normalizeListingShippingSource(value),
    productName: text(value.productName) || text(product.name),
    description: text(value.description) || text(product.description),
    sellerSku: text(value.sellerSku) || text(product.sku),
    categoryHint: text(value.categoryHint) || text(product.name),
    brandName: text(value.brandName),
    manufacturer: text(value.manufacturer),
    countryOfOrigin: text(value.countryOfOrigin),
    material: text(value.material),
    packageContents: text(value.packageContents),
    condition: text(value.condition) || "NEW",
    gtinStatus: text(value.gtinStatus) || "NO_GTIN",
    gtin: text(value.gtin),
    sellingPrice: positiveOrZero(value.sellingPrice),
    currency: text(value.currency).toUpperCase(),
    stock: Number.isInteger(Number(value.stock)) && Number(value.stock) >= 0
      ? Number(value.stock)
      : 0,
    weightKg: positiveOrZero(value.weightKg),
    packageLengthCm: positiveOrZero(value.packageLengthCm),
    packageWidthCm: positiveOrZero(value.packageWidthCm),
    packageHeightCm: positiveOrZero(value.packageHeightCm),
  };
}

export function productRegistrationSourceFingerprint(context: unknown): string {
  const source = row(context);
  const product = row(source.product);
  const detailPage = row(source.detailPage);
  const assignments = Array.isArray(source.assignments)
    ? source.assignments.map(row).map((assignment) => ({
        channel: assignment.channel,
        market: assignment.market,
        categoryId: assignment.categoryId,
        providedAttributes: assignment.providedAttributes,
      })).sort((left, right) => canonical(left).localeCompare(canonical(right)))
    : [];
  return canonical({
    sku: product.sku,
    manualFields: normalizedProductRegistrationManualFields(source),
    detailVersion: detailPage.version ?? null,
    assignments,
  });
}
