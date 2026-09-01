import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog";
import { marketplaceChannelDetailImageCount } from "./marketplace-image-contract";
import { listingPublicationAssetBindingContract } from "./marketplace-images";

type PublicationChannel = ActiveChannelKey;
type UnknownRecord = Record<string, unknown>;

type AssetIdentity = {
  role: string;
  approvedObjectPath?: string;
  approvedSourceSha256?: string;
  publicUrl: string;
  objectPath: string;
  contentSha256: string;
};

export type ListingPublicationAssetBinding = {
  contract: typeof listingPublicationAssetBindingContract;
  approvedDetailPageVersion: number;
  approvedManifestDigest: string;
  approvedDetailImages: AssetIdentity[];
  providerImageSurface: "detail_content" | "gallery" | "buyer_visible";
  providerTransportImages: AssetIdentity[];
};

export type ListingPublicationContentVerification = {
  verified: boolean;
  titleVerified: boolean;
  descriptionVerified: boolean;
  titleLanguageVerified: boolean;
  descriptionLanguageVerified: boolean;
  languageContentVerified: boolean;
  representativeImageVerified: boolean;
  detailImageCountVerified: boolean;
  approvedManifestDigestVerified: boolean;
  sourceIdentityVerified: boolean;
  contentDigestVerified: boolean;
  sourceDetailImageCount: number;
  sourceReadbackDetailImageCount: number;
  remoteDetailImageCount: number;
  sourceContentDigest: string;
  remoteContentDigest: string;
  sourceImageDigest: string;
  remoteImageDigest: string;
  remoteProjectionDigest: string;
  providerImageSurface: "detail_content" | "gallery" | "unknown";
  providerImageContract:
    | "approved_detail_content_exact_8"
    | "representative_plus_approved_detail_8_exact_detail_content"
    | "representative_plus_approved_detail_8_exact_gallery_9"
    | "representative_plus_approved_detail_7_exact_gallery_8"
    | "unknown";
  mismatchFields: string[];
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function firstText(record: UnknownRecord, names: readonly string[]) {
  for (const name of names) {
    const direct = exactText(record[name]);
    if (direct) return direct;
    const entry = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
    const value = entry ? exactText(entry[1]) : "";
    if (value) return value;
  }
  return "";
}

function decodeHtml(value: string) {
  const numericEntity = (match: string, decimal: string | undefined, hexadecimal: string | undefined) => {
    const parsed = Number.parseInt(decimal ?? hexadecimal ?? "", hexadecimal ? 16 : 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 0x10ffff) return match;
    try {
      return String.fromCodePoint(parsed);
    } catch {
      return match;
    }
  };
  return value
    .replace(/&#(?:(\d+)|x([a-f0-9]+));/giu, numericEntity)
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function canonicalBuyerVisibleUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "[unsafe-link]";
    if (url.username || url.password) return "[unsafe-link]";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-link]";
  }
}

export function normalizedListingPublicationText(value: unknown) {
  return decodeHtml(exactText(value))
    .replace(/\{\{SELLERPILOT_IMAGE:detail-[a-z0-9-]+\}\}/giu, " ")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    // Provider image HTML is bound independently by the exact eight-image
    // manifest. Buyer-visible links are content and must remain in the digest.
    .replace(/<img\b[^>]*>/giu, " ")
    .replace(
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/giu,
      (_match, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => (
        ` buyer-link:${canonicalBuyerVisibleUrl(doubleQuoted ?? singleQuoted ?? bare ?? "")} `
      ),
    )
    .replace(/<[^>]+>/gu, " ")
    .replace(
      /https?:\/\/[^\s<>"']+/giu,
      (url) => canonicalBuyerVisibleUrl(url),
    )
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function htmlImageUrls(value: unknown) {
  const html = decodeHtml(exactText(value));
  const urls: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/giu)) {
    const url = (match[1] ?? match[2] ?? "").trim();
    if (url) urls.push(url);
  }
  return urls;
}

function deepMatchingRecord(value: unknown, remoteId: string, depth = 0): UnknownRecord {
  if (depth > 8 || value === null || value === undefined) return {};
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = deepMatchingRecord(child, remoteId, depth + 1);
      if (Object.keys(match).length) return match;
    }
    return {};
  }
  const candidate = recordValue(value);
  if (!Object.keys(candidate).length) return {};
  if (["ItemNo", "ItemCode", "GdNo", "item_id", "itemId", "prdNo", "sellerProductId", "originProductNo"]
    .some((key) => firstText(candidate, [key]) === remoteId)) return candidate;
  for (const child of Object.values(candidate)) {
    const match = deepMatchingRecord(child, remoteId, depth + 1);
    if (Object.keys(match).length) return match;
  }
  return {};
}

function exactImageIdentities(value: unknown) {
  const row = recordValue(value);
  const list = Array.isArray(value)
    ? value
    : Array.isArray(row.Image)
      ? row.Image
      : Array.isArray(row.image_id_list)
        ? row.image_id_list
        : [];
  return list.map(exactText).filter(Boolean);
}

function scriptCount(text: string, expression: RegExp) {
  return (text.match(expression) ?? []).length;
}

export function listingPublicationLanguageVerified(
  locale: string,
  value: string,
  field: "title" | "description" = "description",
) {
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const language = locale.trim().toLowerCase().split("-")[0];
  const letterCount = scriptCount(text, /\p{L}/gu);
  const title = field === "title";
  const scriptLanguage = ["ko", "ja", "th", "zh"].includes(language);
  if (letterCount < (title ? 3 : scriptLanguage ? 8 : 20)) return false;
  const hangul = scriptCount(text, /\p{Script=Hangul}/gu);
  const kana = scriptCount(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = scriptCount(text, /\p{Script=Han}/gu);
  const thai = scriptCount(text, /\p{Script=Thai}/gu);
  const latin = scriptCount(text, /\p{Script=Latin}/gu);
  if (language === "ko") {
    return hangul >= Math.max(title ? 2 : 8, Math.ceil(letterCount * (title ? 0.25 : 0.55)))
      && (title || hangul > latin)
      && hangul > han
      && kana === 0
      && thai === 0;
  }
  if (language === "ja") {
    const japaneseScript = kana + han;
    const kanaMinimum = title ? 1 : Math.max(3, Math.ceil(letterCount * 0.04));
    return japaneseScript >= Math.max(title ? 2 : 8, Math.ceil(letterCount * (title ? 0.25 : 0.55)))
      && (title || japaneseScript > latin)
      && hangul === 0
      && thai === 0
      && kana >= kanaMinimum;
  }
  if (language === "th") {
    return thai >= Math.max(title ? 2 : 8, Math.ceil(letterCount * (title ? 0.25 : 0.55)))
      && (title || thai > latin)
      && hangul === 0
      && kana === 0
      && han === 0;
  }
  if (language === "zh") {
    return han >= Math.max(title ? 2 : 10, Math.ceil(letterCount * (title ? 0.3 : 0.6)))
      && (title || han > latin)
      && kana === 0
      && hangul === 0
      && thai === 0;
  }
  if (latin !== letterCount || hangul || kana || thai || han) return false;
  const normalized = ` ${text.toLocaleLowerCase()} `;
  const markerPatterns: Record<string, RegExp> = {
    en: /\b(?:the|and|with|for|this|that|from|your|product|item|description|details|detailed|information|quality|use|made|verified|ceramic|espresso|premium|durable|finish|design|size|color|material|suitable|easy|care|package|includes|cup|cable|clip|organizer|adhesive)\b/gu,
    ms: /\b(?:yang|dan|untuk|dengan|ini|produk|cawan|disahkan|barangan|penerangan|maklumat|kualiti|penggunaan|kabel|klip|kemas|tahan|pelekat|mudah|bahan|saiz|warna|reka|bentuk|pakej)\b/gu,
    id: /\b(?:yang|dan|untuk|dengan|ini|produk|barang|deskripsi|informasi|kualitas|penggunaan)\b/gu,
    vi: /\b(?:sản|phẩm|và|cho|này|mô|tả|thông|tin|chất|lượng)\b/gu,
    pt: /\b(?:produto|para|com|este|descrição|informação|item|detalhes|qualidade)\b/gu,
    es: /\b(?:producto|para|con|este|descripción|información|artículo|detalles|calidad)\b/gu,
    de: /\b(?:produkt|und|mit|für|dieses|beschreibung|artikel|details|qualität)\b/gu,
    fr: /\b(?:produit|et|avec|pour|cette|description|article|détails|qualité)\b/gu,
    it: /\b(?:prodotto|con|per|questo|descrizione|articolo|dettagli|qualità)\b/gu,
    nl: /\b(?:product|met|voor|dit|beschrijving|artikel|details|kwaliteit)\b/gu,
    pl: /\b(?:produkt|oraz|dla|ten|opis|artykuł|szczegóły|jakość)\b/gu,
  };
  const markerScore = (pattern: RegExp) => new Set(
    (normalized.match(pattern) ?? []).map((marker) => marker.toLocaleLowerCase()),
  ).size;
  const targetPattern = markerPatterns[language];
  if (!targetPattern) return false;
  const targetScore = markerScore(targetPattern);
  if (title) {
    // Titles are already exact-bound to the approved source and often consist
    // primarily of an arbitrary brand/model or a novel product noun. Require
    // the correct script and reject only a meaningful competing-language lead;
    // dictionary coverage belongs to the longer description.
    for (const [candidateLanguage, pattern] of Object.entries(markerPatterns)) {
      const candidateScore = markerScore(pattern);
      if (candidateLanguage !== language
          && candidateScore >= 2
          && candidateScore > targetScore) return false;
    }
    if (language === "ms") {
      const malayDistinctiveScore = markerScore(
        /\b(?:cawan|barangan|penerangan|maklumat|kualiti|kabel|klip|kemas|tahan|pelekat|mudah|bahan|saiz|warna|reka|bentuk|pakej)\b/gu,
      );
      const indonesianDistinctiveScore = markerScore(
        /\b(?:barang|deskripsi|informasi|kualitas)\b/gu,
      );
      if (indonesianDistinctiveScore >= 2
          && indonesianDistinctiveScore > malayDistinctiveScore) return false;
    }
    return true;
  }
  const latinTokens = text.match(/[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]*/gu) ?? [];
  if (language === "en") {
    for (const [candidateLanguage, pattern] of Object.entries(markerPatterns)) {
      const candidateScore = markerScore(pattern);
      if (candidateLanguage !== language
          && candidateScore >= 2
          && candidateScore >= targetScore) return false;
    }
    const grammarScore = markerScore(/\b(?:a|an|the|and|or|with|for|to|of|in|on|this|that|from|your|is|are|can|use|made|designed|suitable|includes)\b/gu);
    const sentenceEndCount = (text.match(/[.!?](?:\s|$)/gu) ?? []).length;
    const targetMarkerOccurrences = normalized.match(targetPattern)?.length ?? 0;
    const lexicalCoverage = latinTokens.length
      ? targetMarkerOccurrences / latinTokens.length
      : 0;
    // Do not require arbitrary product nouns to appear in a fixed commerce
    // dictionary. A sufficiently long English description instead has to
    // demonstrate sentence structure, while a competing language must not
    // tie or lead the English evidence.
    const lexicalSentenceEvidence = sentenceEndCount >= 2
      && targetScore >= 4
      && lexicalCoverage >= 0.35;
    if (latinTokens.length < 6
        || (grammarScore < 2 && !lexicalSentenceEvidence)) return false;
    return true;
  }
  if (language === "ms") {
    const malayGrammarScore = markerScore(
      /\b(?:yang|dan|atau|untuk|dengan|ini|itu|pada|dalam|boleh|sesuai|serta|daripada)\b/gu,
    );
    const malayDistinctiveScore = markerScore(
      /\b(?:cawan|barangan|penerangan|maklumat|kualiti|kabel|klip|kemas|tahan|pelekat|mudah|bahan|saiz|warna|reka|bentuk|pakej)\b/gu,
    );
    const indonesianDistinctiveScore = markerScore(
      /\b(?:barang|deskripsi|informasi|kualitas)\b/gu,
    );
    if (malayDistinctiveScore < 2
        && malayGrammarScore < 2) return false;
    if (indonesianDistinctiveScore >= 2
        && indonesianDistinctiveScore > malayDistinctiveScore) return false;
    for (const [candidateLanguage, pattern] of Object.entries(markerPatterns)) {
      if (candidateLanguage !== language
          && candidateLanguage !== "id"
          && markerScore(pattern) >= Math.max(2, targetScore)) return false;
    }
    return latinTokens.length >= 6;
  }
  if (targetScore < 4) return false;
  for (const [candidateLanguage, pattern] of Object.entries(markerPatterns)) {
    if (candidateLanguage !== language && markerScore(pattern) >= targetScore) return false;
  }
  const targetMarkerOccurrences = normalized.match(targetPattern)?.length ?? 0;
  if (!latinTokens.length || targetMarkerOccurrences / latinTokens.length < 0.18) return false;
  return true;
}

export type ListingPublicationContentProjection = {
  title: string;
  titleParts: string[];
  description: string;
  detailImageCount: number;
  detailImageIdentities: string[];
  representativeImageIdentity?: string;
};

function coupangContentProjection(value: UnknownRecord): ListingPublicationContentProjection {
  const root = Object.keys(recordValue(value.data)).length ? recordValue(value.data) : value;
  const items = records(root.items);
  const titleParts = [
    firstText(root, ["displayProductName", "sellerProductName"]),
    ...items.map((item) => firstText(item, ["itemName"])),
  ].map(normalizedListingPublicationText).filter(Boolean);
  const perItemDescriptions: string[] = [];
  const perItemImageIdentities: string[][] = [];
  for (const item of items) {
    const itemImageIdentities: string[] = [];
    const itemDescriptions: string[] = [];
    for (const content of records(item.contents)) {
      for (const detail of records(content.contentDetails)) {
        const detailType = firstText(detail, ["detailType"]).toUpperCase();
        if (detailType === "IMAGE" && exactText(detail.content)) itemImageIdentities.push(exactText(detail.content));
        if (detailType === "TEXT" && normalizedListingPublicationText(detail.content)) {
          itemDescriptions.push(normalizedListingPublicationText(detail.content));
        }
      }
    }
    perItemDescriptions.push([...new Set(itemDescriptions)].join(" "));
    perItemImageIdentities.push(itemImageIdentities);
  }
  const firstImages = perItemImageIdentities[0] ?? [];
  const everyVariantHasTheApprovedSurface = perItemImageIdentities.length > 0
    && firstImages.length === marketplaceChannelDetailImageCount
    && perItemImageIdentities.every((images) => images.length === marketplaceChannelDetailImageCount
      && sameOrderedValues(images, firstImages));
  const detailImageIdentities = everyVariantHasTheApprovedSurface
    ? firstImages
    : [];
  return {
    title: titleParts[0] ?? "",
    titleParts,
    description: perItemDescriptions.map((description) => description || "[missing variant detail text]").join(" || "),
    detailImageCount: detailImageIdentities.length,
    detailImageIdentities,
  };
}

function shopeeExtendedDescriptionImageIds(item: UnknownRecord) {
  const descriptionInfo = recordValue(item.description_info);
  const extendedDescription = recordValue(descriptionInfo.extended_description);
  return exactImageIdentities(records(extendedDescription.field_list)
    .filter((field) => firstText(field, ["field_type"]).toLowerCase() === "image")
    .map((field) => firstText(recordValue(field.image_info), ["image_id"])));
}

function shopeeGalleryImageIds(item: UnknownRecord) {
  const image = recordValue(item.image);
  return exactImageIdentities(
    image.image_id_list ?? recordValue(item.image_info).image_id_list ?? item.image_id_list,
  );
}

function shopeeApprovedDetailImageIds(input: {
  side: "source" | "remote";
  root: UnknownRecord;
  item: UnknownRecord;
}) {
  if (input.side === "source") {
    const preparedDetails = exactImageIdentities(input.root.sellerpilotProviderDetailImageIds);
    if (preparedDetails.length) return preparedDetails;
  }
  const extendedDetails = shopeeExtendedDescriptionImageIds(input.item);
  if (extendedDetails.length) return extendedDetails;
  const gallery = shopeeGalleryImageIds(input.item);
  if (gallery.length === marketplaceChannelDetailImageCount + 1) return gallery.slice(1);
  if (gallery.length) return gallery;
  if (input.side === "source") {
    const sourceImages = exactImageIdentities(input.root.imageUrls);
    return sourceImages.length === marketplaceChannelDetailImageCount + 1
      ? sourceImages.slice(1)
      : sourceImages;
  }
  return [];
}

function shopeeRepresentativeImageIdentity(input: {
  side: "source" | "remote";
  root: UnknownRecord;
  item: UnknownRecord;
}) {
  const gallery = shopeeGalleryImageIds(input.item);
  if (input.side === "remote" && gallery.length) return gallery[0];
  if (input.side === "source"
      && exactImageIdentities(input.root.sellerpilotProviderDetailImageIds).length === 8
      && gallery.length) return gallery[0];
  const sourceImages = exactImageIdentities(input.root.imageUrls);
  return input.side === "source" && sourceImages.length === marketplaceChannelDetailImageCount + 1
    ? sourceImages[0]
    : "";
}

function temuContentProjection(
  side: "source" | "remote",
  value: UnknownRecord,
): ListingPublicationContentProjection {
  const sourceRoot = recordValue(value.body);
  const resultRoot = recordValue(value.result);
  const dataRoot = recordValue(value.data);
  const root = side === "source"
    ? sourceRoot
    : Object.keys(resultRoot).length
      ? resultRoot
      : Object.keys(dataRoot).length
        ? dataRoot
        : value;
  const goodsBasic = Object.keys(recordValue(root.goodsBasic)).length
    ? recordValue(root.goodsBasic)
    : root;
  const gallery = recordValue(root.goodsGallery);
  const rawDescription = firstText(goodsBasic, ["goodsDesc", "description"]);
  const bulletPoints = Array.isArray(goodsBasic.bulletPoints)
    ? goodsBasic.bulletPoints.map(normalizedListingPublicationText).filter(Boolean)
    : [];
  const descriptionParts = [normalizedListingPublicationText(rawDescription), ...bulletPoints].filter(Boolean);
  const description = [...new Set(descriptionParts)].join(" ");
  const detailImageIdentities = exactImageIdentities(
    gallery.detailImage
      ?? gallery.detailImages
      ?? goodsBasic.detailImage
      ?? goodsBasic.detailImages,
  );
  const carouselImages = exactImageIdentities(
    gallery.goodsCarouselImage
      ?? gallery.carouselImages
      ?? goodsBasic.goodsCarouselImage
      ?? goodsBasic.carouselImages,
  );
  const title = normalizedListingPublicationText(firstText(goodsBasic, ["goodsName", "title"]));
  return {
    title,
    titleParts: title ? [title] : [],
    description,
    detailImageCount: detailImageIdentities.length,
    detailImageIdentities,
    representativeImageIdentity: carouselImages[0] ?? "",
  };
}

export function listingPublicationContentProjection(
  channel: PublicationChannel,
  side: "source" | "remote",
  value: UnknownRecord,
  remoteId: string,
): ListingPublicationContentProjection {
  if (channel === "qoo10") {
    const item = side === "source" ? recordValue(value.params) : deepMatchingRecord(value.ResultObject ?? value, remoteId);
    const description = firstText(item, ["ItemDescription", "ItemDetail", "Description"]);
    const title = normalizedListingPublicationText(firstText(item, ["ItemTitle", "GdNm", "item_name"]));
    const detailImageIdentities = htmlImageUrls(description);
    return { title, titleParts: title ? [title] : [], description: normalizedListingPublicationText(description), detailImageCount: detailImageIdentities.length, detailImageIdentities };
  }
  if (channel === "elevenst") {
    const item = recordValue(value.product);
    const description = firstText(item, ["htmlDetail"]);
    const title = normalizedListingPublicationText(firstText(item, ["prdNm"]));
    const detailImageIdentities = htmlImageUrls(description);
    return { title, titleParts: title ? [title] : [], description: normalizedListingPublicationText(description), detailImageCount: detailImageIdentities.length, detailImageIdentities };
  }
  if (channel === "shopee") {
    const publish = recordValue(value.publish);
    const sourceItem = Object.keys(recordValue(publish.item)).length ? recordValue(publish.item) : recordValue(value.body);
    const remoteItem = records(recordValue(value.response).item_list).find((item) => firstText(item, ["item_id"]) === remoteId) ?? {};
    const item = side === "source" ? sourceItem : remoteItem;
    const detailImageIdentities = shopeeApprovedDetailImageIds({ side, root: value, item });
    const representativeImageIdentity = shopeeRepresentativeImageIdentity({ side, root: value, item });
    const title = normalizedListingPublicationText(firstText(item, ["item_name", "global_item_name"]));
    return {
      title,
      titleParts: title ? [title] : [],
      description: normalizedListingPublicationText(firstText(item, ["description"])),
      detailImageCount: detailImageIdentities.length,
      detailImageIdentities,
      representativeImageIdentity,
    };
  }
  if (channel === "lazada") {
    const sourceProduct = recordValue(recordValue(recordValue(value.request).Request).Product);
    const remoteRoot = recordValue(value.data);
    const remoteProduct = Object.keys(recordValue(remoteRoot.item)).length ? recordValue(remoteRoot.item) : remoteRoot;
    const item = side === "source" ? sourceProduct : remoteProduct;
    const attributes = recordValue(item.Attributes ?? item.attributes);
    const description = firstText(attributes, ["description", "short_description"]);
    const title = normalizedListingPublicationText(firstText(attributes, ["name"]));
    const detailImageIdentities = htmlImageUrls(description);
    const gallery = exactImageIdentities(item.Images ?? item.images);
    return {
      title,
      titleParts: title ? [title] : [],
      description: normalizedListingPublicationText(description),
      detailImageCount: detailImageIdentities.length,
      detailImageIdentities,
      representativeImageIdentity: gallery[0] ?? "",
    };
  }
  if (channel === "coupang") return coupangContentProjection(side === "source" ? recordValue(value.body) : value);
  if (channel === "smartstore") {
    const body = recordValue(value.body);
    const origin = side === "source" ? recordValue(body.originProduct) : recordValue(value.originProduct);
    const channelProduct = side === "source" ? recordValue(body.smartstoreChannelProduct) : recordValue(value.smartstoreChannelProduct);
    const description = firstText(origin, ["detailContent"]);
    const detailImageIdentities = htmlImageUrls(description);
    const title = normalizedListingPublicationText(firstText(channelProduct, ["channelProductName"]));
    return { title, titleParts: title ? [title] : [], description: normalizedListingPublicationText(description), detailImageCount: detailImageIdentities.length, detailImageIdentities };
  }
  if (channel === "temu") return temuContentProjection(side, value);
  const inventoryItem = recordValue(value.inventoryItem);
  const product = recordValue(inventoryItem.product);
  const offer = recordValue(value.offer);
  const description = firstText(offer, ["listingDescription"]) || firstText(product, ["description"]);
  const detailImageIdentities = htmlImageUrls(description);
  const title = normalizedListingPublicationText(firstText(product, ["title"]));
  return { title, titleParts: title ? [title] : [], description: normalizedListingPublicationText(description), detailImageCount: detailImageIdentities.length, detailImageIdentities };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseAssetIdentities(
  value: unknown,
  allowGalleryRole = false,
  requireApprovedObjectPath = false,
  expectedCounts: readonly number[] = [8],
): AssetIdentity[] | null {
  if (!Array.isArray(value) || !expectedCounts.includes(value.length)) return null;
  const identities = value.map((item) => {
    const row = recordValue(item);
    return {
      role: exactText(row.role),
      ...(exactText(row.approvedObjectPath) ? { approvedObjectPath: exactText(row.approvedObjectPath) } : {}),
      ...(exactText(row.approvedSourceSha256) ? { approvedSourceSha256: exactText(row.approvedSourceSha256) } : {}),
      publicUrl: exactText(row.publicUrl),
      objectPath: exactText(row.objectPath),
      contentSha256: exactText(row.contentSha256),
    };
  });
  const canonicalStorageUrl = (item: AssetIdentity) => {
    try {
      const parsed = new URL(item.publicUrl);
      return parsed.protocol === "https:"
        && /^[a-z0-9-]+\.supabase\.(?:co|in)$/u.test(parsed.hostname)
        && parsed.port === ""
        && parsed.username === ""
        && parsed.password === ""
        && parsed.search === ""
        && parsed.hash === ""
        && decodeURIComponent(parsed.pathname) === `/storage/v1/object/public/sellerpilot-marketplace/${item.objectPath}`;
    } catch {
      return false;
    }
  };
  if (identities.some((item) =>
    ((!allowGalleryRole || item.role !== "gallery-representative") && !/^detail-[a-z0-9-]+$/u.test(item.role))
    || (requireApprovedObjectPath && !/^results\/[0-9a-f-]+\/claims\/[0-9a-f-]+\/[^/]+\.png$/iu.test(item.approvedObjectPath ?? ""))
    || (requireApprovedObjectPath && !/^[a-f0-9]{64}$/u.test(item.approvedSourceSha256 ?? ""))
    || !canonicalStorageUrl(item)
    || !/^normalized\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/u.test(item.objectPath)
    || !/^[0-9a-f]{64}$/u.test(item.contentSha256)
    || item.objectPath !== `normalized/${item.contentSha256.slice(0, 2)}/${item.contentSha256}.jpg`)) return null;
  if (new Set(identities.map((item) => item.role)).size !== identities.length
      || new Set(identities.map((item) => item.publicUrl)).size !== identities.length
      || new Set(identities.map((item) => item.objectPath)).size !== identities.length
      || new Set(identities.map((item) => item.contentSha256)).size !== identities.length
      || (requireApprovedObjectPath
        && new Set(identities.map((item) => item.approvedSourceSha256)).size !== identities.length)) return null;
  return identities;
}

export function parseListingPublicationAssetBinding(value: unknown): ListingPublicationAssetBinding | null {
  const row = recordValue(value);
  const approvedDetailImages = parseAssetIdentities(row.approvedDetailImages, false, true);
  const providerTransportImages = parseAssetIdentities(
    row.providerTransportImages,
    true,
    false,
    row.providerImageSurface === "gallery" ? [8, 9] : [8],
  );
  const version = Number(row.approvedDetailPageVersion);
  const surface = row.providerImageSurface;
  if (row.contract !== listingPublicationAssetBindingContract
      || !Number.isSafeInteger(version) || version < 1
      || !/^[a-f0-9]{64}$/u.test(exactText(row.approvedManifestDigest))
      || !approvedDetailImages || !providerTransportImages
      || (surface !== "detail_content" && surface !== "gallery" && surface !== "buyer_visible")) return null;
  if ((surface === "detail_content" || surface === "buyer_visible")
      && !sameOrderedValues(approvedDetailImages.map((item) => item.publicUrl), providerTransportImages.map((item) => item.publicUrl))) return null;
  if (surface === "gallery" && (providerTransportImages[0]?.role !== "gallery-representative"
      || !sameOrderedValues(
        approvedDetailImages
          .slice(0, providerTransportImages.length - 1)
          .map((item) => item.publicUrl),
        providerTransportImages.slice(1).map((item) => item.publicUrl),
      ))) return null;
  return {
    contract: listingPublicationAssetBindingContract,
    approvedDetailPageVersion: version,
    approvedManifestDigest: exactText(row.approvedManifestDigest),
    approvedDetailImages,
    providerImageSurface: surface,
    providerTransportImages,
  };
}

type ProviderAssetEvidence = {
  sourceAssetBindingDigest: string;
  approvedManifestDigest: string;
  approvedDetailPageVersion: number;
  approvedDetailRoles: string[];
  providerImageSurface: "detail_content" | "gallery";
  providerTransportRoles: string[];
  providerDetailImageIdentities: string[];
  providerImageDigest: string;
  sourceRepresentativeImageDigest?: string;
  providerRepresentativeImageIdentity?: string;
  providerRepresentativeImageDigest?: string;
};

function parseProviderAssetEvidence(value: unknown): ProviderAssetEvidence | null {
  const row = recordValue(value);
  const identities = Array.isArray(row.providerDetailImageIdentities) ? row.providerDetailImageIdentities.map(exactText).filter(Boolean) : [];
  const approvedRoles = Array.isArray(row.approvedDetailRoles) ? row.approvedDetailRoles.map(exactText).filter(Boolean) : [];
  const transportRoles = Array.isArray(row.providerTransportRoles) ? row.providerTransportRoles.map(exactText).filter(Boolean) : [];
  const surface = row.providerImageSurface;
  const sourceRepresentativeImageDigest = exactText(row.sourceRepresentativeImageDigest);
  const providerRepresentativeImageIdentity = exactText(row.providerRepresentativeImageIdentity);
  const providerRepresentativeImageDigest = exactText(row.providerRepresentativeImageDigest);
  const transportRoleCountValid = surface === "gallery"
    ? transportRoles.length === 8 || transportRoles.length === 9
    : transportRoles.length === 8;
  const representativeEvidenceValid = !sourceRepresentativeImageDigest
    && !providerRepresentativeImageIdentity
    && !providerRepresentativeImageDigest
    || /^[a-f0-9]{64}$/u.test(sourceRepresentativeImageDigest)
      && Boolean(providerRepresentativeImageIdentity)
      && providerRepresentativeImageDigest === digest(providerRepresentativeImageIdentity);
  if (row.contract !== "sellerpilot_provider_asset_binding_v1"
      || !/^[a-f0-9]{64}$/u.test(exactText(row.sourceAssetBindingDigest))
      || !/^[a-f0-9]{64}$/u.test(exactText(row.approvedManifestDigest))
      || !Number.isSafeInteger(Number(row.approvedDetailPageVersion)) || Number(row.approvedDetailPageVersion) < 1
      || approvedRoles.length !== 8 || new Set(approvedRoles).size !== 8
      || !transportRoleCountValid || new Set(transportRoles).size !== transportRoles.length
      || identities.length !== 8 || new Set(identities).size !== 8
      || (surface !== "detail_content" && surface !== "gallery")
      || !representativeEvidenceValid
      || exactText(row.providerImageDigest) !== digest(identities)) return null;
  return {
    sourceAssetBindingDigest: exactText(row.sourceAssetBindingDigest),
    approvedManifestDigest: exactText(row.approvedManifestDigest),
    approvedDetailPageVersion: Number(row.approvedDetailPageVersion),
    approvedDetailRoles: approvedRoles,
    providerImageSurface: surface,
    providerTransportRoles: transportRoles,
    providerDetailImageIdentities: identities,
    providerImageDigest: exactText(row.providerImageDigest),
    ...(sourceRepresentativeImageDigest ? {
      sourceRepresentativeImageDigest,
      providerRepresentativeImageIdentity,
      providerRepresentativeImageDigest,
    } : {}),
  };
}

export function listingPublicationProviderAssetEvidence(input: {
  channel: PublicationChannel;
  remoteId: string;
  sourceArguments: UnknownRecord;
  providerArguments: UnknownRecord;
}) {
  const binding = parseListingPublicationAssetBinding(input.sourceArguments.sellerpilotPublicationAssetBinding);
  if (!binding) return null;
  const projection = listingPublicationContentProjection(input.channel, "source", input.providerArguments, input.remoteId);
  const sourceProjection = listingPublicationContentProjection(input.channel, "source", input.sourceArguments, input.remoteId);
  const identities = projection.detailImageIdentities;
  if (identities.length !== 8 || new Set(identities).size !== 8) return null;
  const preparedSurface = exactText(input.providerArguments.sellerpilotProviderImageSurface);
  const providerImageSurface = binding.providerImageSurface === "buyer_visible"
    ? preparedSurface === "gallery" || preparedSurface === "detail_content"
      ? preparedSurface
      : ""
    : binding.providerImageSurface;
  if (providerImageSurface !== "gallery" && providerImageSurface !== "detail_content") return null;
  const buyerVisibleShopee = input.channel === "shopee" && binding.providerImageSurface === "buyer_visible";
  const representativeBound = buyerVisibleShopee
    || input.channel === "lazada"
    || (input.channel !== "coupang"
      && binding.providerTransportImages.length === 9
      && binding.providerTransportImages[0]?.role === "gallery-representative");
  const sourceRepresentativeImage = sourceProjection.representativeImageIdentity ?? "";
  const providerRepresentativeImage = projection.representativeImageIdentity ?? "";
  if (representativeBound && (!sourceRepresentativeImage || !providerRepresentativeImage)) return null;
  return {
    contract: "sellerpilot_provider_asset_binding_v1",
    sourceAssetBindingDigest: digest(binding),
    approvedManifestDigest: binding.approvedManifestDigest,
    approvedDetailPageVersion: binding.approvedDetailPageVersion,
    approvedDetailRoles: binding.approvedDetailImages.map((item) => item.role),
    providerImageSurface,
    providerTransportRoles: binding.providerTransportImages.map((item) => item.role),
    providerDetailImageIdentities: identities,
    providerImageDigest: digest(identities),
    ...(representativeBound ? {
      sourceRepresentativeImageDigest: digest(sourceRepresentativeImage),
      providerRepresentativeImageIdentity: providerRepresentativeImage,
      providerRepresentativeImageDigest: digest(providerRepresentativeImage),
    } : {}),
  };
}

function canonicalRemoteResources(channel: PublicationChannel, value: unknown) {
  const resources = recordValue(value);
  const names: Record<PublicationChannel, readonly string[]> = {
    qoo10: ["itemCode", "sellerCode"],
    elevenst: ["productNo", "sellerProductCode"],
    shopee: ["localItemId", "shopId", "globalItemId"],
    lazada: ["itemId", "country", "categoryId", "skuIds", "sellerSkus"],
    coupang: ["sellerProductId", "vendorItemIds"],
    smartstore: ["originProductNo", "smartstoreChannelProductNo"],
    temu: ["goodsId", "externalGoodsId"],
    ebay: ["offerId", "listingId", "sku", "marketplaceId"],
  };
  const result: Record<string, string | string[]> = {};
  for (const key of names[channel]) {
    const raw = resources[key];
    if (Array.isArray(raw)) {
      result[key] = raw.map(exactText).filter(Boolean);
      continue;
    }
    const text = exactText(raw);
    if (text) result[key] = text;
  }
  return result;
}

function sourceDeclaredRemoteResources(
  channel: PublicationChannel,
  sourceArguments: UnknownRecord,
  remoteId: string,
) {
  const params = recordValue(sourceArguments.params);
  const product = recordValue(sourceArguments.product);
  const publish = recordValue(sourceArguments.publish);
  const requestProduct = recordValue(recordValue(recordValue(sourceArguments.request).Request).Product);
  const sourceSkus = records(recordValue(requestProduct.Skus).Sku)
    .map((sku) => firstText(sku, ["SellerSku", "sellerSku"]))
    .filter(Boolean);
  const body = recordValue(sourceArguments.body);
  const offer = recordValue(sourceArguments.offer);
  const coupangItems = records(body.items);
  if (channel === "qoo10") return { itemCode: remoteId, ...(firstText(params, ["SellerCode"]) ? { sellerCode: firstText(params, ["SellerCode"]) } : {}) };
  if (channel === "elevenst") return { productNo: remoteId, ...(firstText(product, ["sellerPrdCd"]) ? { sellerProductCode: firstText(product, ["sellerPrdCd"]) } : {}) };
  if (channel === "shopee") return {
    localItemId: remoteId,
    ...(firstText(publish, ["shop_id"]) || firstText(sourceArguments, ["shopId", "shop_id"])
      ? { shopId: firstText(publish, ["shop_id"]) || firstText(sourceArguments, ["shopId", "shop_id"]) }
      : {}),
    ...(firstText(sourceArguments, ["globalItemId"]) ? { globalItemId: firstText(sourceArguments, ["globalItemId"]) } : {}),
  };
  if (channel === "lazada") return {
    itemId: remoteId,
    ...(firstText(sourceArguments, ["country"]) ? { country: firstText(sourceArguments, ["country"]).toLowerCase() } : {}),
    ...(firstText(requestProduct, ["PrimaryCategory", "primary_category"])
      ? { categoryId: firstText(requestProduct, ["PrimaryCategory", "primary_category"]) }
      : {}),
    ...(sourceSkus.length ? { sellerSkus: sourceSkus } : {}),
  };
  if (channel === "coupang") return {
    sellerProductId: remoteId,
    ...(coupangItems.length > 0 && coupangItems.every((item) => firstText(item, ["vendorItemId"]))
      ? { vendorItemIds: coupangItems.map((item) => firstText(item, ["vendorItemId"])) }
      : {}),
  };
  if (channel === "smartstore") return {
    originProductNo: remoteId,
    ...(firstText(sourceArguments, ["smartstoreChannelProductNo"])
      ? { smartstoreChannelProductNo: firstText(sourceArguments, ["smartstoreChannelProductNo"]) }
      : {}),
  };
  if (channel === "temu") {
    const goodsBasic = recordValue(body.goodsBasic);
    return {
      goodsId: remoteId,
      ...(firstText(goodsBasic, ["externalGoodsId", "outGoodsSn"])
        ? { externalGoodsId: firstText(goodsBasic, ["externalGoodsId", "outGoodsSn"]) }
        : {}),
    };
  }
  const inventorySku = firstText(sourceArguments, ["sku"])
    || firstText(recordValue(sourceArguments.inventoryItem), ["sku"]);
  return {
    ...(firstText(sourceArguments, ["offerId"]) ? { offerId: firstText(sourceArguments, ["offerId"]) } : {}),
    ...(remoteId ? { remoteId } : {}),
    ...(inventorySku ? { sku: inventorySku } : {}),
    ...(firstText(offer, ["marketplaceId"]) ? { marketplaceId: firstText(offer, ["marketplaceId"]).toUpperCase() } : {}),
  };
}

function declaredResourcesMatch(
  channel: PublicationChannel,
  declared: Record<string, unknown>,
  sourceResources: Record<string, string | string[]>,
) {
  for (const [key, value] of Object.entries(declared)) {
    if (key === "remoteId" && channel === "ebay") {
      if (sourceResources.offerId !== value && sourceResources.listingId !== value) return false;
      continue;
    }
    if (digest(sourceResources[key]) !== digest(value)) return false;
  }
  return true;
}

export function assertListingPublicationSourceLocalized(input: {
  channel: PublicationChannel;
  expectedLocale: string;
  remoteId?: string;
  sourceArguments: UnknownRecord;
}) {
  const projection = listingPublicationContentProjection(input.channel, "source", input.sourceArguments, input.remoteId ?? "");
  if (!projection.title || !projection.description
      || !listingPublicationLanguageVerified(input.expectedLocale, projection.titleParts.join(" "), "title")
      || !listingPublicationLanguageVerified(input.expectedLocale, projection.description, "description")) {
    throw new Error("LISTING_PUBLICATION_LOCALIZED_CONTENT_REQUIRED");
  }
  return projection;
}

export function verifyListingPublicationContent(input: {
  channel: PublicationChannel;
  expectedLocale: string;
  expectedImageCount: number;
  remoteId: string;
  sourceArguments: UnknownRecord;
  sourceResponsePayload?: UnknownRecord;
  sourceRemotePayload: UnknownRecord;
  remotePayload: UnknownRecord;
  remoteResources?: UnknownRecord;
}): ListingPublicationContentVerification {
  const source = listingPublicationContentProjection(input.channel, "source", input.sourceArguments, input.remoteId);
  const sourceReadback = listingPublicationContentProjection(input.channel, "remote", input.sourceRemotePayload, input.remoteId);
  const remote = listingPublicationContentProjection(input.channel, "remote", input.remotePayload, input.remoteId);
  const titleVerified = Boolean(source.titleParts.length && sourceReadback.titleParts.length && remote.titleParts.length
    && sameOrderedValues(source.titleParts, sourceReadback.titleParts)
    && sameOrderedValues(source.titleParts, remote.titleParts));
  const descriptionVerified = Boolean(source.description && sourceReadback.description && remote.description
    && source.description === sourceReadback.description && source.description === remote.description);
  const titleLanguageVerified = listingPublicationLanguageVerified(
    input.expectedLocale,
    remote.titleParts.join(" "),
    "title",
  );
  const descriptionLanguageVerified = listingPublicationLanguageVerified(
    input.expectedLocale,
    remote.description,
    "description",
  );
  const languageContentVerified = titleLanguageVerified && descriptionLanguageVerified;

  const binding = parseListingPublicationAssetBinding(input.sourceArguments.sellerpilotPublicationAssetBinding);
  const responseState = recordValue((input.sourceResponsePayload ?? {}).remoteState);
  const providerEvidence = parseProviderAssetEvidence(recordValue(responseState.evidence).publicationAssetBinding);
  const sourceAssetProjectionVerified = Boolean(binding
    && source.detailImageIdentities.length === 8
    && sameOrderedValues(
      source.detailImageIdentities,
      binding.providerImageSurface === "gallery"
        && binding.providerTransportImages.length === 9
        ? binding.providerTransportImages.slice(1).map((item) => item.publicUrl)
        : binding.providerTransportImages.map((item) => item.publicUrl),
    ));
  const approvedManifestDigestVerified = Boolean(binding && providerEvidence
    && providerEvidence.sourceAssetBindingDigest === digest(binding)
    && providerEvidence.approvedManifestDigest === binding.approvedManifestDigest
    && providerEvidence.approvedDetailPageVersion === binding.approvedDetailPageVersion
    && sameOrderedValues(providerEvidence.approvedDetailRoles, binding.approvedDetailImages.map((item) => item.role))
    && (binding.providerImageSurface === "buyer_visible"
      ? providerEvidence.providerImageSurface === "gallery" || providerEvidence.providerImageSurface === "detail_content"
      : providerEvidence.providerImageSurface === binding.providerImageSurface)
    && sameOrderedValues(providerEvidence.providerTransportRoles, binding.providerTransportImages.map((item) => item.role))
    && sourceAssetProjectionVerified);
  const providerIdentities = providerEvidence?.providerDetailImageIdentities ?? [];
  const verifiedProviderImageSurface = providerEvidence?.providerImageSurface
    ?? (binding?.providerImageSurface === "buyer_visible" ? "unknown" : binding?.providerImageSurface)
    ?? "unknown";
  const providerImageContract = verifiedProviderImageSurface === "detail_content"
    ? input.channel === "lazada"
      ? "representative_plus_approved_detail_8_exact_detail_content"
      : "approved_detail_content_exact_8"
    : verifiedProviderImageSurface === "gallery"
      ? binding?.providerImageSurface === "buyer_visible"
        ? "representative_plus_approved_detail_8_exact_gallery_9"
        : binding?.providerTransportImages.length === marketplaceChannelDetailImageCount + 1
          ? "representative_plus_approved_detail_8_exact_gallery_9"
          : "representative_plus_approved_detail_7_exact_gallery_8"
      : "unknown";
  const representativeRequired = binding?.providerImageSurface === "buyer_visible"
    || input.channel === "lazada"
    || (input.channel !== "coupang"
      && binding?.providerTransportImages.length === 9
      && binding.providerTransportImages[0]?.role === "gallery-representative");
  const representativeImageVerified = !representativeRequired
    || Boolean(providerEvidence
      && source.representativeImageIdentity
      && providerEvidence.sourceRepresentativeImageDigest === digest(source.representativeImageIdentity)
      && providerEvidence.providerRepresentativeImageIdentity
      && providerEvidence.providerRepresentativeImageIdentity === sourceReadback.representativeImageIdentity
      && providerEvidence.providerRepresentativeImageIdentity === remote.representativeImageIdentity);
  const detailImageCountVerified = input.expectedImageCount === 8
    && sourceReadback.detailImageCount === 8 && remote.detailImageCount === 8
    && new Set(sourceReadback.detailImageIdentities).size === 8
    && new Set(remote.detailImageIdentities).size === 8
    && sameOrderedValues(providerIdentities, sourceReadback.detailImageIdentities)
    && sameOrderedValues(providerIdentities, remote.detailImageIdentities);

  const sourceResources = canonicalRemoteResources(input.channel, responseState.resources);
  const remoteResources = canonicalRemoteResources(input.channel, input.remoteResources);
  const declaredResources = sourceDeclaredRemoteResources(input.channel, input.sourceArguments, input.remoteId);
  const sourceIdentityVerified = Object.keys(sourceResources).length > 0 && digest(sourceResources) === digest(remoteResources);
  const sourceDeclaredIdentityVerified = declaredResourcesMatch(
    input.channel,
    declaredResources,
    sourceResources,
  );
  const sourceProjection = {
    titleParts: source.titleParts,
    description: source.description,
    resources: sourceResources,
    approvedManifestDigest: binding?.approvedManifestDigest ?? "",
    providerImageSurface: verifiedProviderImageSurface,
    ...(representativeRequired
      ? { representativeImage: providerEvidence?.providerRepresentativeImageIdentity ?? "" }
      : {}),
    detailImages: providerIdentities,
  };
  const remoteProjection = {
    titleParts: remote.titleParts,
    description: remote.description,
    resources: remoteResources,
    approvedManifestDigest: binding?.approvedManifestDigest ?? "",
    providerImageSurface: verifiedProviderImageSurface,
    ...(representativeRequired
      ? { representativeImage: remote.representativeImageIdentity ?? "" }
      : {}),
    detailImages: remote.detailImageIdentities,
  };
  const sourceContentDigest = digest(sourceProjection);
  const remoteContentDigest = digest(remoteProjection);
  const sourceImageDigest = digest(providerIdentities);
  const remoteImageDigest = digest(remote.detailImageIdentities);
  const contentDigestVerified = sourceContentDigest === remoteContentDigest;
  const mismatchFields = [
    ...(titleVerified ? [] : ["title"]),
    ...(descriptionVerified ? [] : ["description"]),
    ...(titleLanguageVerified ? [] : ["titleLanguage"]),
    ...(descriptionLanguageVerified ? [] : ["descriptionLanguage"]),
    ...(approvedManifestDigestVerified ? [] : ["approvedManifest"]),
    ...(representativeImageVerified ? [] : ["representativeImage"]),
    ...(detailImageCountVerified ? [] : ["detailImages"]),
    ...(sourceIdentityVerified && sourceDeclaredIdentityVerified ? [] : ["remoteIdentity"]),
    ...(contentDigestVerified ? [] : ["contentDigest"]),
  ];
  return {
    verified: mismatchFields.length === 0,
    titleVerified,
    descriptionVerified,
    titleLanguageVerified,
    descriptionLanguageVerified,
    languageContentVerified,
    representativeImageVerified,
    detailImageCountVerified,
    approvedManifestDigestVerified,
    sourceIdentityVerified: sourceIdentityVerified && sourceDeclaredIdentityVerified,
    contentDigestVerified,
    sourceDetailImageCount: source.detailImageCount,
    sourceReadbackDetailImageCount: sourceReadback.detailImageCount,
    remoteDetailImageCount: remote.detailImageCount,
    sourceContentDigest,
    remoteContentDigest,
    sourceImageDigest,
    remoteImageDigest,
    remoteProjectionDigest: remoteContentDigest,
    providerImageSurface: verifiedProviderImageSurface,
    providerImageContract,
    mismatchFields,
  };
}
