import { z } from "zod";
import { aiGeneratedAssetIds } from "./ai-generated-assets";
import { normalizedProductImageSpecSchema, productIntakeSchema } from "./product-intake";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const localizedDetailSectionSchema = z.object({
  type: z.enum(["overview", "feature", "howto", "spec"]),
  heading: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  imageAsset: z.enum(["detail-overview", "detail-feature", "detail-use", "detail-package"]),
  imageAltText: z.string().min(1).max(180),
});

const localizedListingSchema = z.object({
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]),
  market: z.enum(["JP", "SG", "MY", "PH", "VN", "TH", "TW", "BR", "MX", "ID", "KR", "US", "GB", "DE", "AU", "CA", "FR", "IT", "ES"]),
  locale: z.enum(["ja-JP", "en-SG", "ms-MY", "en-PH", "vi-VN", "th-TH", "zh-TW", "pt-BR", "es-MX", "id-ID", "ko-KR", "en-US", "en-GB", "de-DE", "en-AU", "en-CA", "fr-FR", "it-IT", "es-ES"]),
  title: z.string().min(1).max(120),
  shortDescription: z.string().min(1).max(500),
  description: z.string().min(1).max(2_000),
  keywords: z.array(z.string().min(1).max(80)).min(3).max(10),
  thumbnailAltText: z.string().min(1).max(180),
  detailSections: z.array(localizedDetailSectionSchema).length(4),
});

const nullableResearchText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();

export const productResearchResultSchema = z.object({
  mode: z.literal("cli-research"),
  summary: z.string().trim().min(20).max(2_000),
  suggestedFields: z.object({
    productName: nullableResearchText(160),
    categoryHint: nullableResearchText(120),
    brandName: nullableResearchText(120),
    manufacturer: nullableResearchText(160),
    countryOfOrigin: nullableResearchText(80),
    material: nullableResearchText(500),
    packageContents: nullableResearchText(500),
    description: nullableResearchText(4_000),
    gtin: z.string().regex(/^\d{8,14}$/).nullable(),
  }),
  details: z.object({
    features: z.array(z.string().trim().min(1).max(300)).max(12),
    specifications: z.array(z.object({
      label: z.string().trim().min(1).max(100),
      value: z.string().trim().min(1).max(500),
      evidence: z.string().trim().min(1).max(500),
    })).max(30),
    usage: z.array(z.string().trim().min(1).max(300)).max(10),
    cautions: z.array(z.string().trim().min(1).max(400)).max(10),
  }),
  sources: z.array(z.object({
    url: z.string().url().max(1_000),
    title: z.string().trim().min(1).max(300),
    status: z.enum(["read", "unavailable"]),
  })).max(5),
  warnings: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const productResearchJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  researchInput: z.string().trim().min(2).max(12_000),
});

export const supportReplyLocaleSchema = z.enum([
  "ko-KR", "en-US", "ja-JP", "zh-TW", "th-TH", "vi-VN", "id-ID", "ms-MY", "pt-BR", "es-MX",
]);

export const supportReplyJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  ticketId: z.string().uuid(),
  targetLocale: supportReplyLocaleSchema,
  tone: z.enum(["polite", "concise", "apologetic"]).default("polite"),
});

export const supportReplyResultSchema = z.object({
  mode: z.literal("support-reply"),
  targetLocale: supportReplyLocaleSchema,
  draft: z.string().trim().min(10).max(4_000),
  sourceSummary: z.string().trim().min(1).max(1_000),
  cautions: z.array(z.string().trim().min(1).max(300)).max(5),
});

export const studioCoreSchema = z.object({
  product: z.object({
    name: z.string().min(1).max(160),
    category: z.string().min(1).max(120),
    oneLine: z.string().min(1).max(240),
    targetCustomer: z.string().min(1).max(240),
    features: z.array(z.string().min(1).max(240)).min(3).max(5),
    cautions: z.array(z.string().min(1).max(320)).min(1).max(4),
  }),
  design: z.object({
    themeName: z.string().min(1).max(100),
    palette: z.object({ primary: hex, accent: hex, surface: hex, text: hex }),
    heroCopy: z.string().min(1).max(160),
    heroSubcopy: z.string().min(1).max(240),
    cta: z.string().min(1).max(80),
    sections: z.array(z.object({
      type: z.enum(["benefit", "story", "howto", "proof", "spec", "caution"]),
      eyebrow: z.string().min(1).max(80),
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(800),
      points: z.array(z.string().min(1).max(240)).min(2).max(4),
    })).min(5).max(7),
  }),
  thumbnail: z.object({
    headline: z.string().min(1).max(120),
    subline: z.string().min(1).max(120),
    badge: z.string().min(1).max(60),
  }),
  localizedListings: z.array(localizedListingSchema).length(26),
  warnings: z.array(z.string().min(1).max(400)).max(5),
});

const requiredLocalizedMarkets = {
  "qoo10:JP": "ja-JP",
  "shopee:SG": "en-SG",
  "shopee:MY": "ms-MY",
  "shopee:PH": "en-PH",
  "shopee:VN": "vi-VN",
  "shopee:TH": "th-TH",
  "shopee:TW": "zh-TW",
  "shopee:BR": "pt-BR",
  "shopee:MX": "es-MX",
  "lazada:MY": "ms-MY",
  "lazada:SG": "en-SG",
  "lazada:PH": "en-PH",
  "lazada:TH": "th-TH",
  "lazada:VN": "vi-VN",
  "lazada:ID": "id-ID",
  "coupang:KR": "ko-KR",
  "smartstore:KR": "ko-KR",
  "ebay:US": "en-US",
  "ebay:GB": "en-GB",
  "ebay:DE": "de-DE",
  "ebay:AU": "en-AU",
  "ebay:CA": "en-CA",
  "ebay:FR": "fr-FR",
  "ebay:IT": "it-IT",
  "ebay:ES": "es-ES",
  "temu:KR": "ko-KR",
} as const;

function localizedText(listing: z.infer<typeof localizedListingSchema>) {
  return [
    listing.title,
    listing.shortDescription,
    listing.description,
    ...listing.keywords,
    listing.thumbnailAltText,
    ...listing.detailSections.flatMap((section) => [section.heading, section.body, section.imageAltText]),
  ].join(" ");
}

function hasExpectedScript(locale: string, value: string) {
  if (locale === "ko-KR") return /\p{Script=Hangul}/u.test(value);
  if (locale === "ja-JP") return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
  if (locale === "th-TH") return /\p{Script=Thai}/u.test(value);
  if (locale === "zh-TW") return /\p{Script=Han}/u.test(value);
  if (locale === "vi-VN") return /[\u0102\u0103\u00C2\u00E2\u0110\u0111\u00CA\u00EA\u00D4\u00F4\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EFF]/u.test(value);
  if (locale === "pt-BR") return /[\u00C0-\u00FF]/u.test(value);
  if (locale === "es-MX") return /[\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1\u00FC\u00BF\u00A1]/iu.test(value);
  return /[A-Za-z]/u.test(value);
}

export const cliStudioResultSchema = studioCoreSchema.extend({ mode: z.literal("cli") }).superRefine((value, context) => {
  const received = new Set(value.localizedListings.map((listing) => `${listing.channel}:${listing.market}`));
  for (const required of Object.keys(requiredLocalizedMarkets)) {
    if (!received.has(required)) context.addIssue({ code: "custom", path: ["localizedListings"], message: `${required} 번역이 필요합니다.` });
  }
  if (received.size !== Object.keys(requiredLocalizedMarkets).length) context.addIssue({ code: "custom", path: ["localizedListings"], message: "채널·국가 번역은 중복될 수 없습니다." });
  value.localizedListings.forEach((listing, index) => {
    const key = `${listing.channel}:${listing.market}` as keyof typeof requiredLocalizedMarkets;
    const expectedLocale = requiredLocalizedMarkets[key];
    if (expectedLocale && listing.locale !== expectedLocale) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "locale"], message: `${key}의 locale은 ${expectedLocale}여야 합니다.` });
    }
    const combined = localizedText(listing);
    if (expectedLocale !== "ko-KR" && /\p{Script=Hangul}/u.test(combined)) {
      context.addIssue({ code: "custom", path: ["localizedListings", index], message: `${key} 현지화 문안에 한국어가 남아 있습니다.` });
    }
    if (!hasExpectedScript(expectedLocale ?? listing.locale, combined)) {
      context.addIssue({ code: "custom", path: ["localizedListings", index], message: `${key} 문안에 ${expectedLocale ?? listing.locale} 언어 문자가 확인되지 않습니다.` });
    }
    const sectionTypes = new Set(listing.detailSections.map((section) => section.type));
    const imageAssets = new Set(listing.detailSections.map((section) => section.imageAsset));
    if (sectionTypes.size !== 4 || imageAssets.size !== 4) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "detailSections"], message: `${key} 상세 섹션 유형과 이미지 역할은 중복 없이 4개여야 합니다.` });
    }
    const searchableCopy = [
      listing.title,
      listing.shortDescription,
      listing.description,
      ...listing.detailSections.flatMap((section) => [section.heading, section.body]),
    ].join(" ").toLocaleLowerCase();
    if (!listing.keywords.some((keyword) => searchableCopy.includes(keyword.toLocaleLowerCase()))) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "keywords"], message: `${key} SEO 키워드는 제목·설명·상세본문에 자연스럽게 포함되어야 합니다.` });
    }
  });
});

export const studioJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  manualFields: productIntakeSchema,
  imagePaths: z.array(z.string().min(1).max(400)).min(1).max(100),
  imageSpecs: z.array(normalizedProductImageSpecSchema).min(1).max(100),
}).superRefine((value, context) => {
  if (value.imagePaths.length !== value.imageSpecs.length) {
    context.addIssue({ code: "custom", path: ["imageSpecs"], message: "이미지 경로와 규격 정보 수가 일치해야 합니다." });
  }
  if (value.imageSpecs[0]?.role !== "main") {
    context.addIssue({ code: "custom", path: ["imageSpecs", 0, "role"], message: "첫 번째 이미지는 대표사진이어야 합니다." });
  }
});

export const workerCompletionSchema = z.union([
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: cliStudioResultSchema,
    assetStoragePaths: z.record(
      z.enum(aiGeneratedAssetIds),
      z.string().min(1).max(400),
    ),
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: productResearchResultSchema,
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: supportReplyResultSchema,
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: z.object({
      mode: z.literal("asset-regeneration"),
      assetId: z.enum(aiGeneratedAssetIds),
      sourceJobId: z.string().uuid(),
      sourceProductId: z.string().uuid().nullable(),
    }),
    assetStoragePaths: z.partialRecord(
      z.enum(aiGeneratedAssetIds),
      z.string().min(1).max(400),
    ),
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
  }),
]);

export type CliStudioResult = z.infer<typeof cliStudioResultSchema>;
export type ProductResearchResult = z.infer<typeof productResearchResultSchema>;
export type SupportReplyResult = z.infer<typeof supportReplyResultSchema>;
