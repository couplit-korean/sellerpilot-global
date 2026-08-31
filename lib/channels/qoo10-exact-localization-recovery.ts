import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
} from "./listing-publication-content";
import {
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateContract,
} from "./qoo10-exact-localization-identity";
import { qoo10DetailImageUrls } from "./qoo10-listing-create-preflight";

export {
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateContract,
} from "./qoo10-exact-localization-identity";

export type Qoo10ExactLocalizationUpdateBinding = {
  status: "allowed";
  contract: typeof qoo10ExactLocalizationUpdateContract;
  productId: string;
  listingId: string;
  credentialId: string;
  remoteId: string;
  sellerSku: string;
  releaseSha: string;
};

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(record: UnknownRecord, aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLocaleLowerCase()));
  const value = Object.entries(record)
    .find(([key]) => normalizedAliases.has(key.toLocaleLowerCase()))?.[1];
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function aliasesConsistent(record: UnknownRecord, aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLocaleLowerCase()));
  const values = Object.entries(record)
    .filter(([key]) => normalizedAliases.has(key.toLocaleLowerCase()))
    .map(([, value]) => typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "");
  return values.length <= 1 || new Set(values).size === 1;
}

function matchingItems(
  value: unknown,
  depth = 0,
  found: UnknownRecord[] = [],
): UnknownRecord[] {
  if (depth > 7 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const child of value) matchingItems(child, depth + 1, found);
    return found;
  }
  const candidate = recordValue(value);
  if (!Object.keys(candidate).length) return found;
  const identities = ["ItemNo", "ItemCode", "GdNo"]
    .filter((alias) => Object.hasOwn(candidate, alias))
    .map((alias) => exactText(candidate, [alias]));
  if (identities.length > 0 && identities.every((identity) => (
    identity === qoo10ExactLocalizationRecoveryIdentity.remoteId
  ))) found.push(candidate);
  for (const child of Object.values(candidate)) matchingItems(child, depth + 1, found);
  return found;
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && !url.hash;
  } catch {
    return false;
  }
}

function localizationComparable(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function exactBindingKeys(value: UnknownRecord) {
  const expected = new Set([
    "status",
    "contract",
    "productId",
    "listingId",
    "credentialId",
    "remoteId",
    "sellerSku",
    "releaseSha",
  ]);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

export function qoo10ExactLocalizationUpdateBinding(
  argumentsValue: UnknownRecord,
): Qoo10ExactLocalizationUpdateBinding | null {
  const marker = recordValue(argumentsValue[qoo10ExactLocalizationUpdateArgument]);
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  if (!exactBindingKeys(marker)
      || marker.status !== "allowed"
      || marker.contract !== qoo10ExactLocalizationUpdateContract
      || marker.productId !== identity.productId
      || marker.listingId !== identity.listingId
      || marker.credentialId !== identity.credentialId
      || marker.remoteId !== identity.remoteId
      || marker.sellerSku !== identity.sellerSku
      || typeof marker.releaseSha !== "string"
      || !/^[a-f0-9]{40}$/u.test(marker.releaseSha)) return null;
  return structuredClone(marker) as Qoo10ExactLocalizationUpdateBinding;
}

export function bindQoo10ExactLocalizationUpdateArguments(
  argumentsValue: UnknownRecord,
  releaseSha: string,
) {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  if (!/^[a-f0-9]{40}$/u.test(releaseSha)) {
    throw new Error("QOO10_EXACT_LOCALIZATION_RELEASE_INVALID");
  }
  return {
    ...argumentsValue,
    [qoo10ExactLocalizationUpdateArgument]: {
      status: "allowed",
      contract: qoo10ExactLocalizationUpdateContract,
      productId: identity.productId,
      listingId: identity.listingId,
      credentialId: identity.credentialId,
      remoteId: identity.remoteId,
      sellerSku: identity.sellerSku,
      releaseSha,
    } satisfies Qoo10ExactLocalizationUpdateBinding,
  };
}

export function qoo10ExactReviewedJapaneseDetail(detailImageUrls: readonly string[]) {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  if (detailImageUrls.length !== 8
      || new Set(detailImageUrls).size !== 8
      || !detailImageUrls.every(safeHttpsUrl)) {
    throw new Error("QOO10_EXACT_LOCALIZATION_IMAGES_REQUIRED");
  }
  return [
    '<section lang="ja-JP">',
    `<h1>${identity.title}</h1>`,
    "<p>ケーブルをすっきり整理できる貼り付け式クリップの6個セットです。</p>",
    `<p>販売価格は${identity.priceJpy.toLocaleString("ja-JP")}円です。購入前にサイズ、設置面、内容物をご確認ください。</p>`,
    "</section>",
    '<section data-sellerpilot-detail-images="true">',
    ...detailImageUrls.map((url, index) => (
      `<img src="${url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" alt="商品詳細画像 ${index + 1}">`
    )),
    "</section>",
  ].join("");
}

const qoo10ExactForbiddenRomanizedTokens = Object.freeze([
  "buchakhyeong",
  "keibeul",
  "jeongri",
  "keulrip",
  "6gae",
  "seteu",
  // This colour label remained in the live S1 detail after the product-name
  // repair. Keep the block scoped to the one exact recovery item instead of
  // applying a speculative romanization dictionary to every Qoo10 listing.
  "geomjeongsaek",
]);

export function qoo10ExactLegacyRomanizedCopyPresent(value: string) {
  const comparable = localizationComparable(value);
  return qoo10ExactForbiddenRomanizedTokens
    .map(localizationComparable)
    .some((token) => token.length >= 4 && comparable.includes(token));
}

export function qoo10ExactForeignPriceCopyPresent(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  return /(?:^|[^a-z])krw(?:$|[^a-z])/u.test(normalized)
    || normalized.includes("₩")
    || /\d[\d,.\s]*\s*원/u.test(normalized)
    || normalized.includes("ウォン");
}

export function qoo10ExactTargetCreateForbidden(argumentsValue: UnknownRecord) {
  const params = recordValue(argumentsValue.params);
  const sellerCode = exactText(params, ["SellerCode"]);
  const itemCode = exactText(params, ["ItemCode"]);
  const title = exactText(params, ["ItemTitle"]);
  const category = exactText(params, ["SecondSubCat"]);
  return itemCode === qoo10ExactLocalizationRecoveryIdentity.remoteId
    || sellerCode === qoo10ExactLocalizationRecoveryIdentity.sellerSku
    || sellerCode.startsWith(`${qoo10ExactLocalizationRecoveryIdentity.sellerSku}-R`)
    || (title === qoo10ExactLocalizationRecoveryIdentity.title
      && category === qoo10ExactLocalizationRecoveryIdentity.categoryCode);
}

export type Qoo10ExactLocalizedUpdate = {
  detailHtml: string;
  detailImageUrls: string[];
};

export function qoo10ExactLocalizedUpdate(
  argumentsValue: UnknownRecord,
  remoteId: string,
  requireServerBinding = false,
): Qoo10ExactLocalizedUpdate | null {
  if (remoteId !== qoo10ExactLocalizationRecoveryIdentity.remoteId) return null;
  const params = recordValue(argumentsValue.params);
  const title = exactText(params, ["ItemTitle"]);
  const keyword = exactText(params, ["Keyword"]);
  const detailHtml = typeof params.ItemDescription === "string" ? params.ItemDescription : "";
  const description = normalizedListingPublicationText(detailHtml);
  const detailImageUrls = qoo10DetailImageUrls(detailHtml);
  const legacyCopy = `${title}\n${keyword}\n${description}`;
  const exactV2Commerce = !requireServerBinding || (
    Boolean(qoo10ExactLocalizationUpdateBinding(argumentsValue))
    && exactText(params, ["RetailPrice"]) === String(qoo10ExactLocalizationRecoveryIdentity.priceJpy)
    && exactText(params, ["ItemPrice"]) === String(qoo10ExactLocalizationRecoveryIdentity.priceJpy)
    && exactText(params, ["ItemQty"]) === String(qoo10ExactLocalizationRecoveryIdentity.quantity)
    && exactText(params, ["ShippingNo"]) === qoo10ExactLocalizationRecoveryIdentity.shippingNo
    && exactText(params, ["PromotionName"]) === qoo10ExactLocalizationRecoveryIdentity.promotionName
  );
  if (!exactV2Commerce
      || exactText(params, ["ItemCode"]) !== qoo10ExactLocalizationRecoveryIdentity.remoteId
      || exactText(params, ["SellerCode"]) !== qoo10ExactLocalizationRecoveryIdentity.sellerSku
      || exactText(params, ["SecondSubCat"]) !== qoo10ExactLocalizationRecoveryIdentity.categoryCode
      || title !== qoo10ExactLocalizationRecoveryIdentity.title
      || keyword !== qoo10ExactLocalizationRecoveryIdentity.sourceKeyword
      || !description.includes(qoo10ExactLocalizationRecoveryIdentity.title)
      || qoo10ExactLegacyRomanizedCopyPresent(legacyCopy)
      || qoo10ExactForeignPriceCopyPresent(legacyCopy)
      || !listingPublicationLanguageVerified("ja-JP", title, "title")
      || !listingPublicationLanguageVerified("ja-JP", description, "description")
      || detailImageUrls.length !== 8
      || new Set(detailImageUrls).size !== 8
      || !detailImageUrls.every(safeHttpsUrl)) {
    throw new Error("QOO10_EXACT_LOCALIZED_UPDATE_INVALID");
  }
  return { detailHtml, detailImageUrls };
}

export function verifyQoo10ExactCurrentS1Readback(input: {
  resultObject: unknown;
  expectedDetailImageUrls: readonly string[];
}) {
  const matches = matchingItems(input.resultObject);
  const item = matches.length === 1 ? matches[0] : {};
  const status = exactText(item, ["ItemStatus", "Status"]).toLocaleUpperCase();
  const sellerCode = exactText(item, ["SellerCode"]);
  const categoryCode = exactText(item, ["SecondSubCatCd", "SecondSubCat", "CategoryCode"]);
  const currentDetailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const currentDetailImageUrls = qoo10DetailImageUrls(currentDetailHtml);
  const checks = {
    uniqueRemoteIdentityVerified: matches.length === 1,
    identityAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["ItemNo", "ItemCode", "GdNo"]),
    statusAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["ItemStatus", "Status"]),
    currentStatusS1Verified: status === "S1" || status === "1",
    sellerSkuAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["SellerCode"]),
    sellerSkuVerified: sellerCode === qoo10ExactLocalizationRecoveryIdentity.sellerSku,
    categoryAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["SecondSubCatCd", "SecondSubCat", "CategoryCode"]),
    categoryVerified: categoryCode === qoo10ExactLocalizationRecoveryIdentity.categoryCode,
    approvedEightImagesPreserved: currentDetailImageUrls.length === 8
      && currentDetailImageUrls.every((url, index) => url === input.expectedDetailImageUrls[index]),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    providerStatus: status,
    currentDetailImageUrls,
  };
}
