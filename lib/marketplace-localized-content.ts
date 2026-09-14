import type { ActiveChannelKey } from "./channels/catalog";

export type LocalizedDetailImageRole = "detail-overview" | "detail-feature" | "detail-use" | "detail-package";

export type LocalizedDetailSection = {
  type: "overview" | "feature" | "howto" | "spec";
  heading: string;
  body: string;
  imageAsset: LocalizedDetailImageRole;
  imageAltText: string;
};

export type LocalizedCreativeListing = {
  title: string;
  shortDescription: string;
  description: string;
  keywords: string[];
  thumbnailAltText?: string;
  detailSections?: LocalizedDetailSection[];
};

const detailOrders: Record<ActiveChannelKey, LocalizedDetailImageRole[]> = {
  qoo10: ["detail-overview", "detail-feature", "detail-package", "detail-use"],
  shopee: ["detail-overview", "detail-use", "detail-feature", "detail-package"],
  lazada: ["detail-overview", "detail-feature", "detail-use", "detail-package"],
  coupang: ["detail-overview", "detail-feature", "detail-package", "detail-use"],
  elevenst: ["detail-overview", "detail-feature", "detail-use", "detail-package"],
  smartstore: ["detail-overview", "detail-feature", "detail-use", "detail-package"],
  ebay: ["detail-overview", "detail-package", "detail-feature", "detail-use"],
  temu: ["detail-package", "detail-feature", "detail-use", "detail-overview"],
};

const galleryOrders: Record<ActiveChannelKey, string[]> = {
  qoo10: ["square", "hero", "portrait", "wide"],
  shopee: ["square", "hero", "portrait", "wide"],
  lazada: ["square", "hero", "wide", "portrait"],
  coupang: ["square", "hero", "portrait", "wide"],
  elevenst: ["square", "hero", "portrait", "wide"],
  smartstore: ["square", "hero", "portrait", "wide"],
  ebay: ["square", "hero", "wide", "portrait"],
  temu: ["square", "hero", "wide", "portrait"],
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function cleanList(values: unknown, maximum = 10) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}

export function galleryAssetOrderForChannel(channel: ActiveChannelKey) {
  return galleryOrders[channel];
}

export function detailAssetOrderForChannel(channel: ActiveChannelKey) {
  return detailOrders[channel];
}

export function normalizedLocalizedDetailSections(listing: LocalizedCreativeListing | undefined) {
  if (!listing || !Array.isArray(listing.detailSections)) return [];
  const byAsset = new Map<LocalizedDetailImageRole, LocalizedDetailSection>();
  for (const section of listing.detailSections) {
    if (!detailOrders.qoo10.includes(section.imageAsset) || byAsset.has(section.imageAsset)) continue;
    if (!section.heading?.trim() || !section.body?.trim() || !section.imageAltText?.trim()) continue;
    byAsset.set(section.imageAsset, {
      ...section,
      heading: section.heading.trim(),
      body: section.body.trim(),
      imageAltText: section.imageAltText.trim(),
    });
  }
  return [...byAsset.values()];
}

export function localizedImageSeo(listing: LocalizedCreativeListing | undefined, channel: ActiveChannelKey, fallbackTitle: string) {
  const sections = normalizedLocalizedDetailSections(listing);
  const byAsset = new Map(sections.map((section) => [section.imageAsset, section]));
  const detailImageRoles = detailAssetOrderForChannel(channel);
  return {
    thumbnailAltText: listing?.thumbnailAltText?.trim() || listing?.title?.trim() || fallbackTitle,
    detailImageRoles,
    detailImageAltTexts: detailImageRoles.map((role) => byAsset.get(role)?.imageAltText || `${listing?.title?.trim() || fallbackTitle} ${role.replace("detail-", "")}`),
  };
}

export function buildLocalizedRichDetail(listing: LocalizedCreativeListing | undefined, fallbackTitle: string, fallbackDescription: string) {
  const title = listing?.title?.trim() || fallbackTitle;
  const shortDescription = listing?.shortDescription?.trim() || listing?.description?.trim() || fallbackDescription;
  const description = listing?.description?.trim() || fallbackDescription;
  const sections = normalizedLocalizedDetailSections(listing);
  const sectionHtml = sections.map((section) => [
    `<div data-sellerpilot-section="${section.type}" style="max-width:860px;margin:28px auto">`,
    `<h2 style="margin:0 0 10px;font-size:24px;line-height:1.35">${escapeHtml(section.heading)}</h2>`,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.75">${escapeHtml(section.body)}</p>`,
    `{{SELLERPILOT_IMAGE:${section.imageAsset}}}`,
    "</div>",
  ].join("")).join("");
  return [
    `<div data-sellerpilot-localized-detail="true" style="max-width:860px;margin:0 auto">`,
    `<h1 style="margin:0 0 12px;font-size:30px;line-height:1.3">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 14px;font-size:18px;line-height:1.65">${escapeHtml(shortDescription)}</p>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.75">${escapeHtml(description)}</p>`,
    sectionHtml,
    "</div>",
  ].join("");
}

export function buildLocalizedPlainDetail(listing: LocalizedCreativeListing | undefined, fallbackTitle: string, fallbackDescription: string) {
  const title = listing?.title?.trim() || fallbackTitle;
  const summary = listing?.shortDescription?.trim() || listing?.description?.trim() || fallbackDescription;
  const description = listing?.description?.trim() || fallbackDescription;
  const sections = normalizedLocalizedDetailSections(listing);
  return [
    title,
    summary,
    description,
    ...sections.flatMap((section) => [section.heading, section.body]),
  ].filter(Boolean).join("\n\n");
}

export function localizedSeoKeywords(listing: LocalizedCreativeListing | undefined, maximum = 10) {
  return cleanList(listing?.keywords, maximum);
}
