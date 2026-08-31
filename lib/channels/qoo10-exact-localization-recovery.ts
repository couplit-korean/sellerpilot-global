import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
} from "./listing-publication-content";
import { qoo10ExactLocalizationRecoveryIdentity } from "./qoo10-exact-localization-identity";
import { qoo10DetailImageUrls } from "./qoo10-listing-create-preflight";

export { qoo10ExactLocalizationRecoveryIdentity } from "./qoo10-exact-localization-identity";

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

export function qoo10ExactLegacyRomanizedCopyPresent(value: string) {
  const comparable = localizationComparable(value);
  return qoo10ExactLocalizationRecoveryIdentity.legacyRomanizedName
    .split(/\s+/u)
    .map(localizationComparable)
    .some((token) => token.length >= 4 && comparable.includes(token));
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
): Qoo10ExactLocalizedUpdate | null {
  if (remoteId !== qoo10ExactLocalizationRecoveryIdentity.remoteId) return null;
  const params = recordValue(argumentsValue.params);
  const title = exactText(params, ["ItemTitle"]);
  const keyword = exactText(params, ["Keyword"]);
  const detailHtml = typeof params.ItemDescription === "string" ? params.ItemDescription : "";
  const description = normalizedListingPublicationText(detailHtml);
  const detailImageUrls = qoo10DetailImageUrls(detailHtml);
  const legacyCopy = `${title}\n${keyword}\n${description}`;
  if (exactText(params, ["ItemCode"]) !== qoo10ExactLocalizationRecoveryIdentity.remoteId
      || exactText(params, ["SellerCode"]) !== qoo10ExactLocalizationRecoveryIdentity.sellerSku
      || exactText(params, ["SecondSubCat"]) !== qoo10ExactLocalizationRecoveryIdentity.categoryCode
      || title !== qoo10ExactLocalizationRecoveryIdentity.title
      || keyword !== qoo10ExactLocalizationRecoveryIdentity.sourceKeyword
      || !description.includes(qoo10ExactLocalizationRecoveryIdentity.title)
      || qoo10ExactLegacyRomanizedCopyPresent(legacyCopy)
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
