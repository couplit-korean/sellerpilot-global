import {
  lazadaPrimaryCategory,
  lazadaSkuRows,
} from "../../channels/lazada-listing-update";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreateMetadataContract =
  "lazada_my_create_metadata_v1" as const;

export type LazadaMyCreateMode = "standard" | "marketplace_ease";

type CategoryRule = {
  name: string;
  attributeType: "normal" | "sku";
  inputType: number;
  mandatory: boolean;
  options: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function metadataRows(value: unknown) {
  if (Array.isArray(value)) return value.map(record);
  const root = record(value);
  const data = root.data ?? value;
  if (Array.isArray(data)) return data.map(record);
  const container = record(data);
  for (const key of ["attributes", "attribute", "items"]) {
    if (Array.isArray(container[key])) {
      return (container[key] as unknown[]).map(record);
    }
  }
  return [];
}

function inputType(value: unknown) {
  const normalized = text(value).toLowerCase();
  const names: Record<string, number> = {
    singleselect: 1,
    multiselect: 2,
    enuminput: 3,
    multienuminput: 4,
    text: 5,
    numeric: 6,
    date: 7,
    richtext: 8,
    img: 9,
  };
  const parsed = names[normalized] ?? Number(normalized);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 9 ? parsed : 0;
}

function flag(value: unknown) {
  return value === true || value === 1 || text(value) === "1"
    || text(value).toLowerCase() === "true";
}

function options(value: unknown) {
  const root = record(value);
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(root.option)
      ? root.option
      : Array.isArray(root.Option)
        ? root.Option
        : [];
  return rows.map((value) => {
    const row = record(value);
    const name = text(row.en_name ?? row.enName);
    if (!Object.keys(row).length || !name) {
      throw new Error("LAZADA_CATEGORY_ATTRIBUTE_SCHEMA_INVALID");
    }
    return name;
  });
}

function categoryRules(value: unknown) {
  const rows = metadataRows(value);
  if (!rows.length) throw new Error("LAZADA_CATEGORY_ATTRIBUTES_REQUIRED");
  const identities = new Set<string>();
  return rows.map((row): CategoryRule => {
    const name = text(row.name);
    const attributeType = text(row.attribute_type ?? row.attributeType).toLowerCase();
    const normalizedInputType = inputType(row.input_type ?? row.inputType);
    const identity = `${attributeType}:${name}`;
    if (!name
        || (attributeType !== "normal" && attributeType !== "sku")
        || !normalizedInputType) {
      throw new Error("LAZADA_CATEGORY_ATTRIBUTE_SCHEMA_INVALID");
    }
    if (identities.has(identity)) {
      throw new Error(`LAZADA_CATEGORY_ATTRIBUTE_DUPLICATE:${name}`);
    }
    identities.add(identity);
    return {
      name,
      attributeType,
      inputType: normalizedInputType,
      mandatory: flag(row.is_mandatory ?? row.isMandatory),
      options: options(row.options),
    };
  });
}

function values(value: unknown, commaSeparated: boolean) {
  if (Array.isArray(value)) {
    const normalized = value.map(text);
    return normalized.length && normalized.every(Boolean) ? normalized : null;
  }
  const normalized = text(value);
  if (!normalized) return null;
  const rows = (commaSeparated ? normalized.split(",") : [normalized])
    .map((item) => item.trim());
  return rows.every(Boolean) ? rows : null;
}

function present(value: unknown) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string" || typeof value === "number") return text(value) !== "";
  return true;
}

function lazadaImage(value: unknown) {
  try {
    const url = new URL(text(value));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && ["slatic.net", "lazcdn.com", "alicdn.com"].some((domain) =>
        hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function httpsUrl(value: unknown) {
  try {
    return new URL(text(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function imageRows(value: unknown) {
  if (value === undefined || value === null) return [];
  const root = record(value);
  const rows = Array.isArray(value) ? value : root.Image ?? root.image;
  if (!Array.isArray(rows)) return null;
  const normalized = rows.map(text);
  return normalized.every(Boolean) ? normalized : null;
}

function assertImages(value: unknown, stage: "source" | "provider", required: boolean) {
  const images = imageRows(value);
  if (!images) throw new Error("LAZADA_MY_CREATE_IMAGE_URL_INVALID");
  if (required && !images.length) throw new Error("LAZADA_MY_CREATE_IMAGES_REQUIRED");
  if (images.length > 8 || images.length !== new Set(images).size) {
    throw new Error("LAZADA_MY_CREATE_IMAGES_CARDINALITY_INVALID");
  }
  const valid = stage === "provider" ? lazadaImage : httpsUrl;
  if (images.some((url) => !valid(url))) {
    throw new Error("LAZADA_MY_CREATE_IMAGE_URL_INVALID");
  }
  return images;
}

function descriptionImages(value: string) {
  return [...value.matchAll(/<img\b[^>]*>/giu)].map((match) => {
    const source = match[0].match(
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu,
    );
    const url = text(source?.[1] ?? source?.[2] ?? source?.[3]);
    if (!url) throw new Error("LAZADA_MY_CREATE_DESCRIPTION_IMAGE_SRC_INVALID");
    return url;
  });
}

function decimal(value: unknown, precision: number) {
  const normalized = text(value);
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`, "u");
  const parsed = Number(normalized);
  return pattern.test(normalized) && Number.isFinite(parsed) && parsed > 0;
}

function quantity(value: unknown) {
  const normalized = text(value);
  const parsed = Number(normalized);
  return /^\d+$/u.test(normalized) && Number.isSafeInteger(parsed) && parsed >= 0;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function assertAttribute(
  rule: CategoryRule,
  value: unknown,
  stage: "source" | "provider",
) {
  const normalized = values(value, rule.inputType === 2 || rule.inputType === 4);
  if (!normalized) throw new Error(`LAZADA_ATTRIBUTE_VALUE_INVALID:${rule.name}`);
  if (rule.inputType === 1 && normalized.length !== 1) {
    throw new Error(`LAZADA_ATTRIBUTE_SINGLE_VALUE_REQUIRED:${rule.name}`);
  }
  if ((rule.inputType === 1 || rule.inputType === 2)
      && (!rule.options.length || normalized.some((item) => !rule.options.includes(item)))) {
    throw new Error(`LAZADA_ATTRIBUTE_ENUM_VALUE_INVALID:${rule.name}`);
  }
  if (rule.inputType === 6 && normalized.some((item) => !Number.isFinite(Number(item)))) {
    throw new Error(`LAZADA_ATTRIBUTE_NUMERIC_VALUE_INVALID:${rule.name}`);
  }
  if (rule.inputType === 7 && normalized.some((item) => !validDate(item))) {
    throw new Error(`LAZADA_ATTRIBUTE_DATE_VALUE_INVALID:${rule.name}`);
  }
  const validImage = stage === "provider" ? lazadaImage : httpsUrl;
  if (rule.inputType === 9 && normalized.some((item) => !validImage(item))) {
    throw new Error(`LAZADA_ATTRIBUTE_IMAGE_VALUE_INVALID:${rule.name}`);
  }
  return normalized;
}

export function assertLazadaMyCreateMetadata(input: {
  argumentsValue: UnknownRecord;
  categoryAttributes: unknown;
  mode: LazadaMyCreateMode;
  imageStage?: "source" | "provider";
}) {
  const request = record(input.argumentsValue.request);
  const product = record(record(request.Request).Product);
  const primaryCategory = lazadaPrimaryCategory(product);
  if (!/^\d+$/u.test(primaryCategory)) {
    throw new Error("LAZADA_MY_CREATE_PRIMARY_CATEGORY_REQUIRED");
  }
  const rules = categoryRules(input.categoryAttributes);
  const attributes = record(product.Attributes ?? product.attributes);
  const skus = lazadaSkuRows(product);
  const stage = input.imageStage ?? "provider";
  const productImages = assertImages(product.Images ?? product.images, stage, true);
  const attributeImageUrls: string[] = [];

  const name = text(attributes.name);
  const description = text(attributes.description);
  if (!name || name.length > 255) throw new Error("LAZADA_MY_CREATE_NAME_INVALID");
  if (!text(attributes.brand) && !text(attributes.brand_id)) {
    throw new Error("LAZADA_MY_CREATE_BRAND_REQUIRED");
  }
  if (description.length > 25_000) throw new Error("LAZADA_MY_CREATE_DESCRIPTION_INVALID");
  const validImage = stage === "provider" ? lazadaImage : httpsUrl;
  if (descriptionImages(description).some((url) => !validImage(url))) {
    throw new Error("LAZADA_MY_CREATE_DESCRIPTION_IMAGE_URL_INVALID");
  }

  for (const rule of rules.filter((candidate) => candidate.attributeType === "normal")) {
    const value = attributes[rule.name];
    if (!present(value)) {
      if (rule.name === "brand" && text(attributes.brand_id)) continue;
      if (rule.mandatory) throw new Error(`LAZADA_REQUIRED_ATTRIBUTE_MISSING:${rule.name}`);
      continue;
    }
    const normalized = assertAttribute(rule, value, stage);
    if (rule.inputType === 9) attributeImageUrls.push(...normalized);
  }

  const precision = input.mode === "marketplace_ease" ? 3 : 2;
  skus.forEach((sku, index) => {
    const sellerSku = text(sku.SellerSku ?? sku.seller_sku);
    if (!sellerSku || /["*^~<>/|]/u.test(sellerSku)) {
      throw new Error(`LAZADA_MY_CREATE_SELLER_SKU_INVALID:${index}`);
    }
    if (!quantity(sku.quantity ?? sku.Quantity)) {
      throw new Error(`LAZADA_MY_CREATE_QUANTITY_INVALID:${index}`);
    }
    if (input.mode === "standard") {
      if (!decimal(sku.price ?? sku.Price, precision)) {
        throw new Error(`LAZADA_MY_CREATE_PRICE_INVALID:${index}`);
      }
      if (sku.supply_price !== undefined || sku.SupplyPrice !== undefined) {
        throw new Error(`LAZADA_MY_CREATE_SUPPLY_PRICE_FORBIDDEN:${index}`);
      }
    } else {
      if (sku.price !== undefined || sku.Price !== undefined
          || sku.special_price !== undefined || sku.SpecialPrice !== undefined) {
        throw new Error(`LAZADA_MY_CREATE_MARKETPLACE_EASE_PRICE_FORBIDDEN:${index}`);
      }
      if (!decimal(sku.supply_price ?? sku.SupplyPrice, precision)) {
        throw new Error(`LAZADA_MY_CREATE_SUPPLY_PRICE_INVALID:${index}`);
      }
    }
    for (const key of [
      "package_height",
      "package_length",
      "package_width",
      "package_weight",
    ] as const) {
      if (!decimal(sku[key], precision)) {
        throw new Error(`LAZADA_MY_CREATE_${key.toUpperCase()}_INVALID:${index}`);
      }
    }
    if (!text(sku.package_content)) {
      throw new Error(`LAZADA_MY_CREATE_PACKAGE_CONTENT_REQUIRED:${index}`);
    }
    if (sku.Images !== undefined || sku.images !== undefined) {
      assertImages(sku.Images ?? sku.images, stage, false);
    }
    const saleProp = record(sku.saleProp ?? sku.SaleProp);
    for (const rule of rules.filter((candidate) => candidate.attributeType === "sku")) {
      if (input.mode === "marketplace_ease"
          && ["price", "special_price", "special_from_date", "special_to_date"]
            .includes(rule.name)) {
        continue;
      }
      const value = sku[rule.name] ?? saleProp[rule.name];
      if (!present(value)) {
        if (rule.mandatory) {
          throw new Error(`LAZADA_REQUIRED_SKU_ATTRIBUTE_MISSING:${rule.name}:${index}`);
        }
        continue;
      }
      const normalized = assertAttribute(rule, value, stage);
      if (rule.inputType === 9) attributeImageUrls.push(...normalized);
    }
  });

  if (!skus.length) throw new Error("LAZADA_MY_CREATE_SKUS_REQUIRED");
  return {
    contract: lazadaMyCreateMetadataContract,
    mode: input.mode,
    primaryCategory,
    skuCount: skus.length,
    productImageCount: productImages.length,
    attributeImageUrls: [...new Set(attributeImageUrls)],
    packageDecimalPlaces: precision,
    mandatoryNormalAttributes: rules
      .filter((rule) => rule.mandatory && rule.attributeType === "normal")
      .map((rule) => rule.name),
    mandatorySkuAttributes: rules
      .filter((rule) => rule.mandatory && rule.attributeType === "sku")
      .map((rule) => rule.name),
  };
}
