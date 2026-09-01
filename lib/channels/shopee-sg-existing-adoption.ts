import { createHash } from "node:crypto";

import { listingPublicationLanguageVerified } from "./listing-publication-content";

type UnknownRecord = Record<string, unknown>;

export const shopeeSgExistingAdoptionArgument =
  "sellerpilotShopeeSgExistingAdoption" as const;
export const shopeeSgExistingAdoptionContract =
  "sellerpilot_shopee_sg_existing_adoption_v1" as const;

export const shopeeSgExistingAdoptionIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  itemId: "53717126190",
  sku: "QA-20260823-CC-001",
  merchantId: "5511564",
  shopId: "1719148844",
  market: "SG",
  locale: "en-SG",
  currency: "SGD",
  priceSgd: 16.77,
  providerStatus: "UNLIST",
  detailImageCount: 8,
});

export type ShopeeSgExistingAdoptionBinding = {
  contract: typeof shopeeSgExistingAdoptionContract;
  productId: string;
  itemId: string;
  sku: string;
  merchantId: string;
  shopId: string;
  market: string;
  locale: string;
  currency: string;
  providerStatus: string;
  detailImageCount: number;
};

export type ShopeeSgExistingAdoptionEvidence = {
  contract: "sellerpilot_shopee_sg_existing_adoption_readback_v1";
  itemId: string;
  sku: string;
  merchantId: string;
  shopId: string;
  market: "SG";
  locale: "en-SG";
  currency: "SGD";
  price: number;
  providerStatus: "UNLIST";
  galleryImageCount: number;
  detailImageCount: 8;
  representativeImageVerified: true;
  titleLanguageVerified: true;
  descriptionLanguageVerified: true;
  titleDigest: string;
  descriptionDigest: string;
};

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
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function uniqueTexts(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(exactText).filter(Boolean))]
    : [];
}

function normalizedDigest(value: string) {
  return createHash("sha256")
    .update(value.normalize("NFKC").replace(/\s+/gu, " ").trim(), "utf8")
    .digest("hex");
}

export function shopeeSgExistingAdoptionBinding(
  argumentsValue: unknown,
): ShopeeSgExistingAdoptionBinding | null {
  const argumentsRecord = recordValue(argumentsValue);
  const value = recordValue(argumentsRecord[shopeeSgExistingAdoptionArgument]);
  const expectedKeys = [
    "contract", "productId", "itemId", "sku", "merchantId", "shopId",
    "market", "locale", "currency", "providerStatus", "detailImageCount",
  ] as const;
  const identity = shopeeSgExistingAdoptionIdentity;
  if (!exactKeys(value, expectedKeys)
      || value.contract !== shopeeSgExistingAdoptionContract
      || value.productId !== identity.productId
      || value.itemId !== identity.itemId
      || value.sku !== identity.sku
      || value.merchantId !== identity.merchantId
      || value.shopId !== identity.shopId
      || value.market !== identity.market
      || value.locale !== identity.locale
      || value.currency !== identity.currency
      || value.providerStatus !== identity.providerStatus
      || value.detailImageCount !== identity.detailImageCount) {
    return null;
  }
  return value as ShopeeSgExistingAdoptionBinding;
}

function merchantCredentialMatches(payload: UnknownRecord, merchantId: string) {
  if (exactText(payload.merchant_id) === merchantId) return true;
  if (Array.isArray(payload.merchant_ids)
      && payload.merchant_ids.map(exactText).filter(Boolean).includes(merchantId)) {
    return true;
  }
  const targets = Array.isArray(payload.shopee_targets)
    ? payload.shopee_targets.map(recordValue)
    : [];
  return targets.some((target) => target.type === "merchant" && exactText(target.id) === merchantId);
}

function exactItem(itemRemoteData: UnknownRecord, itemId: string) {
  const response = recordValue(itemRemoteData.response);
  const items = Array.isArray(response.item_list)
    ? response.item_list.map(recordValue)
    : [];
  const identities = new Set(items.map((item) => exactText(item.item_id)).filter(Boolean));
  const matches = items.filter((item) => exactText(item.item_id) === itemId);
  return matches.length === 1 && identities.size === 1 ? matches[0] : null;
}

function itemCurrency(item: UnknownRecord) {
  const values = new Set<string>();
  const direct = exactText(item.currency).toUpperCase();
  if (direct) values.add(direct);
  const priceInfo = Array.isArray(item.price_info) ? item.price_info.map(recordValue) : [];
  for (const price of priceInfo) {
    const currency = exactText(price.currency).toUpperCase();
    if (currency) values.add(currency);
  }
  return values.size === 1 ? [...values][0] : "";
}

function itemPrice(item: UnknownRecord) {
  const normalized = (value: unknown) => {
    const parsed = Number(exactText(value));
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 999_999_999
      ? Math.round(parsed * 100) / 100
      : null;
  };
  const priceInfo = Array.isArray(item.price_info) ? item.price_info.map(recordValue) : [];
  for (const keys of [["current_price"], ["original_price"]] as const) {
    const values = new Set([
      normalized(item[keys[0]]),
      ...priceInfo.map((price) => normalized(price[keys[0]])),
    ].filter((value): value is number => value !== null));
    if (values.size === 1) return [...values][0];
    if (values.size > 1) return null;
  }
  return null;
}

function extendedDescription(input: UnknownRecord) {
  const descriptionInfo = recordValue(input.description_info);
  const extended = recordValue(descriptionInfo.extended_description);
  const fields = Array.isArray(extended.field_list)
    ? extended.field_list.map(recordValue)
    : [];
  const text = fields
    .filter((field) => exactText(field.field_type).toLowerCase() === "text")
    .map((field) => exactText(recordValue(field.text_info).text))
    .filter(Boolean)
    .join(" ");
  const imageIds = uniqueTexts(fields
    .filter((field) => exactText(field.field_type).toLowerCase() === "image")
    .map((field) => exactText(recordValue(field.image_info).image_id)));
  return { text, imageIds };
}

function itemImages(item: UnknownRecord) {
  const image = recordValue(item.image);
  const imageInfo = recordValue(item.image_info);
  const gallery = uniqueTexts(
    image.image_id_list
      ?? image.image_url_list
      ?? imageInfo.image_id_list
      ?? imageInfo.image_url_list
      ?? item.image_id_list,
  );
  const extended = extendedDescription(item);
  const details = extended.imageIds.length
    ? extended.imageIds
    : gallery.length === shopeeSgExistingAdoptionIdentity.detailImageCount + 1
      ? gallery.slice(1)
      : [];
  return { gallery, details, extendedText: extended.text };
}

export function verifyShopeeSgExistingAdoptionReadback(input: {
  argumentsValue: UnknownRecord;
  credentialPayload: UnknownRecord;
  shopRemoteData: UnknownRecord;
  itemRemoteData: UnknownRecord;
}): ShopeeSgExistingAdoptionEvidence | null {
  const binding = shopeeSgExistingAdoptionBinding(input.argumentsValue);
  if (!binding || !merchantCredentialMatches(input.credentialPayload, binding.merchantId)) {
    return null;
  }
  const shop = recordValue(input.shopRemoteData.response);
  if (exactText(shop.shop_id) !== binding.shopId) return null;

  const item = exactItem(input.itemRemoteData, binding.itemId);
  const price = item ? itemPrice(item) : null;
  if (!item
      || exactText(item.item_sku) !== binding.sku
      || exactText(item.item_status).toUpperCase() !== binding.providerStatus
      || itemCurrency(item) !== binding.currency
      || price !== shopeeSgExistingAdoptionIdentity.priceSgd) {
    return null;
  }

  const title = exactText(item.item_name);
  const images = itemImages(item);
  const description = exactText(item.description) || images.extendedText;
  const titleLanguageVerified = listingPublicationLanguageVerified(binding.locale, title, "title");
  const descriptionLanguageVerified = listingPublicationLanguageVerified(binding.locale, description);
  const representativeImageVerified = images.gallery.length >= 1;
  if (!titleLanguageVerified
      || !descriptionLanguageVerified
      || !representativeImageVerified
      || images.details.length !== binding.detailImageCount
      || new Set(images.details).size !== binding.detailImageCount) {
    return null;
  }

  return {
    contract: "sellerpilot_shopee_sg_existing_adoption_readback_v1",
    itemId: binding.itemId,
    sku: binding.sku,
    merchantId: binding.merchantId,
    shopId: binding.shopId,
    market: "SG",
    locale: "en-SG",
    currency: "SGD",
    price,
    providerStatus: "UNLIST",
    galleryImageCount: images.gallery.length,
    detailImageCount: 8,
    representativeImageVerified: true,
    titleLanguageVerified: true,
    descriptionLanguageVerified: true,
    titleDigest: normalizedDigest(title),
    descriptionDigest: normalizedDigest(description),
  };
}
