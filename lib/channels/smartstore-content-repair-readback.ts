import { externalDetailCanonical } from "../external-detail-canonical";
import { smartstoreContentRepairBodyHashes } from "./smartstore-content-repair";

const imageRoles = [
  "detail-overview",
  "detail-use",
  "detail-contents",
  "detail-routine",
  "detail-material",
  "detail-feature",
  "detail-storage",
  "detail-package",
] as const;
const reservedImageToken = "__SELLERPILOT_DETAIL_IMAGE_";
const imageSourcePattern = /(<img[^>]*[\s]src=["'])https:\/\/[^"']+(["'])/iu;
const imageUrlPattern = /<img[^>]*[\s]src=["'](https:\/\/[^"']+)["']/giu;
const imageTagPattern = /<img(?:[\s]|>)/giu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactHtmlImageUrls(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const urls = [...value.matchAll(imageUrlPattern)].map((match) => match[1]!);
  const tagCount = [...value.matchAll(imageTagPattern)].length;
  return urls.length === 8 && tagCount === 8 && new Set(urls).size === 8 ? urls : null;
}

function imageProjection(value: unknown) {
  const images = record(value);
  const representative = record(images?.representativeImage)?.url;
  const optional = Array.isArray(images?.optionalImages)
    ? images.optionalImages.map((item) => record(item)?.url)
    : [];
  if (typeof representative !== "string" || !representative
      || optional.length !== 8
      || optional.some((url) => typeof url !== "string" || !url)
      || new Set([representative, ...optional]).size !== 9) return null;
  return { representative, optional: optional as string[] };
}

/** Mirrors the narrow SQL verifier. Source attributes are removed only when
 * they occur immediately after their generated opening tag. Provider comments
 * are removed only when the exact observed comment immediately precedes the
 * matching tag. Every other byte remains part of the comparison. */
export function canonicalSmartstoreNaverDetailHtml(
  value: unknown,
  surface: "approved-source" | "provider-readback",
) {
  if (typeof value !== "string" || !value || value.includes(reservedImageToken)) return null;
  let canonical = value;
  if (surface === "provider-readback") {
    canonical = canonical.replaceAll(
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14") --><div',
      "<div",
    );
    for (const role of imageRoles) {
      canonical = canonical.replaceAll(
        `<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}") --><section`,
        "<section",
      );
    }
    canonical = canonical.replaceAll(
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-block="story") --><section',
      "<section",
    );
    canonical = canonical.replaceAll(
      '<!-- Not Allowed Attribute Filtered ( data-sellerpilot-puck-evidence="true") --><p',
      "<p",
    );
  } else {
    canonical = canonical.replaceAll(
      '<div data-sellerpilot-puck-detail="true" data-sellerpilot-section-count="14"',
      "<div",
    );
    for (const role of imageRoles) {
      canonical = canonical.replaceAll(
        `<section data-sellerpilot-puck-block="image-story" data-sellerpilot-image-role="${role}"`,
        "<section",
      );
    }
    canonical = canonical.replaceAll(
      '<section data-sellerpilot-puck-block="story"',
      "<section",
    );
    canonical = canonical.replaceAll(
      '<p data-sellerpilot-puck-evidence="true"',
      "<p",
    );
  }
  if (canonical.includes("<!-- Not Allowed Attribute Filtered")
      || canonical.toLowerCase().includes("data-sellerpilot-")) return null;
  return canonical.replaceAll(/&times;/giu, "×").replaceAll(/&middot;/giu, "·");
}

export function smartstoreNaverDetailHtmlMatches(sourceValue: unknown, providerValue: unknown) {
  const sourceUrls = exactHtmlImageUrls(sourceValue);
  const providerUrls = exactHtmlImageUrls(providerValue);
  if (!sourceUrls || !providerUrls) return false;
  let source = canonicalSmartstoreNaverDetailHtml(sourceValue, "approved-source");
  let provider = canonicalSmartstoreNaverDetailHtml(providerValue, "provider-readback");
  if (!source || !provider) return false;
  for (let index = 0; index < 8; index += 1) {
    const token = `${reservedImageToken}${index + 1}__`;
    source = source.replace(imageSourcePattern, `$1${token}$2`);
    provider = provider.replace(imageSourcePattern, `$1${token}$2`);
  }
  return source === provider;
}

export function verifySmartstoreContentRepairPostwrite(input: {
  expectedBody: unknown;
  currentOriginProduct: unknown;
  currentChannelProduct: unknown;
  expectedProtectedBodySha256: string;
}) {
  const expectedBody = record(input.expectedBody);
  const expectedOrigin = record(expectedBody?.originProduct);
  const expectedChannel = record(expectedBody?.smartstoreChannelProduct);
  const currentOrigin = record(input.currentOriginProduct);
  const currentChannel = record(input.currentChannelProduct);
  const mismatches: string[] = [];
  if (!expectedOrigin || !expectedChannel || !currentOrigin || !currentChannel) {
    return { ok: false, mismatches: ["body"] };
  }
  if (currentOrigin.name !== expectedOrigin.name) mismatches.push("originProduct.name");
  if (currentChannel.channelProductName !== expectedChannel.channelProductName) {
    mismatches.push("smartstoreChannelProduct.channelProductName");
  }
  if (!smartstoreNaverDetailHtmlMatches(expectedOrigin.detailContent, currentOrigin.detailContent)) {
    mismatches.push("originProduct.detailContent");
  }
  const expectedImages = imageProjection(expectedOrigin.images);
  const currentImages = imageProjection(currentOrigin.images);
  const expectedDetailUrls = exactHtmlImageUrls(expectedOrigin.detailContent);
  const currentDetailUrls = exactHtmlImageUrls(currentOrigin.detailContent);
  if (!expectedImages || !currentImages
      || externalDetailCanonical(expectedImages) !== externalDetailCanonical(currentImages)
      || !expectedDetailUrls || !currentDetailUrls
      || externalDetailCanonical(expectedImages?.optional) !== externalDetailCanonical(expectedDetailUrls)
      || externalDetailCanonical(currentImages?.optional) !== externalDetailCanonical(currentDetailUrls)) {
    mismatches.push("originProduct.images");
  }
  if (currentOrigin.salePrice !== expectedOrigin.salePrice) mismatches.push("originProduct.salePrice");
  if (currentOrigin.stockQuantity !== expectedOrigin.stockQuantity) {
    mismatches.push("originProduct.stockQuantity");
  }
  try {
    const protectedBodySha256 = smartstoreContentRepairBodyHashes({
      originProduct: currentOrigin,
      smartstoreChannelProduct: currentChannel,
    }).protectedBodySha256;
    if (protectedBodySha256 !== input.expectedProtectedBodySha256) {
      mismatches.push("protectedBodySha256");
    }
  } catch {
    mismatches.push("protectedBodySha256");
  }
  return { ok: mismatches.length === 0, mismatches };
}
