import { z } from "zod";
import { aiGeneratedAssetIds } from "./ai-generated-assets";
import { normalizedProductImageSpecSchema, productEditSchema, productIntakeSchema } from "./product-intake";

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
const researchSearchLocaleSchema = z.enum(["ko-KR", "en-US", "ja-JP", "ms-MY", "id-ID", "vi-VN", "th-TH"]);

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
  searchQueries: z.array(z.object({
    locale: researchSearchLocaleSchema,
    query: z.string().trim().min(2).max(160),
  })).min(6).max(12).superRefine((queries, context) => {
    if (new Set(queries.map((item) => item.locale)).size < 6) {
      context.addIssue({ code: "custom", message: "동일 상품 검색어는 최소 6개 언어로 작성해야 합니다." });
    }
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

export const supportReplyWorkerRequestSchema = z.object({
  ticket_id: z.string().uuid(),
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]),
  target_locale: supportReplyLocaleSchema,
  tone: z.enum(["polite", "concise", "apologetic"]),
  subject: z.string().trim().max(500),
  message: z.string().trim().min(1).max(12_000),
  order: z.object({
    external_order_id: z.string().trim().max(240),
    product_name: z.string().trim().max(500),
    quantity: z.number().int().min(0).max(1_000_000),
    status: z.string().trim().max(80),
    ordered_at: z.string().datetime({ offset: true }).nullable(),
    shipped_at: z.string().datetime({ offset: true }).nullable(),
  }).strict().nullable(),
}).strict();

const competitorProviderSchema = z.enum(["naver_shopping", "elevenst_product_search", "ebay_browse"]);
const competitorMarketplaceSchema = z.enum([
  "smartstore", "coupang", "elevenst", "qoo10", "shopee", "lazada", "ebay", "temu", "other",
]);
const competitorEvidenceText = (maximum: number) => z.string()
  .trim()
  .min(1)
  .max(maximum)
  .refine((value) => !/[<>]/u.test(value), "경쟁가 근거에는 HTML을 포함할 수 없습니다.");

export const studioCompetitorContextSchema = z.object({
  query: competitorEvidenceText(160),
  providerStatuses: z.array(z.object({
    provider: competitorProviderSchema,
    status: z.enum(["searched", "unavailable", "failed", "pending"]),
    count: z.number().int().min(0).max(100_000),
    marketplaces: z.array(competitorMarketplaceSchema).max(9),
  }).strict()).max(3),
  candidates: z.array(z.object({
    provider: competitorProviderSchema,
    marketplace: competitorMarketplaceSchema,
    externalId: competitorEvidenceText(500),
    title: competitorEvidenceText(1_000),
    url: z.string().url().max(1_000).refine((value) => value.startsWith("https://"), "경쟁 상품 링크는 HTTPS여야 합니다."),
    mallName: competitorEvidenceText(240),
    price: z.number().finite().positive().max(1_000_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    verifiedSameProduct: z.literal(true),
  }).strict()).max(24),
}).strict();

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
  localizedListings: z.array(localizedListingSchema).length(27),
  warnings: z.array(z.string().min(1).max(400)).max(5),
});

export function normalizeStudioWarningLimits(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.warnings)) return value;
  const warnings = source.warnings
    .map((warning) => {
      if (typeof warning !== "string") return warning;
      let normalized = warning.trim().slice(0, 400);
      if (/[\uD800-\uDBFF]$/.test(normalized)) normalized = normalized.slice(0, -1);
      return normalized;
    })
    .filter((warning) => typeof warning !== "string" || warning.length > 0)
    .slice(0, 5);
  return {
    ...source,
    warnings,
  };
}

function boundedTitleKeyword(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";
  let keyword = trimmed.slice(0, 80);
  if (/[\uD800-\uDBFF]$/u.test(keyword)) keyword = keyword.slice(0, -1);
  if (keyword.length < trimmed.length) {
    const wordBoundary = keyword.search(/\s+\S*$/u);
    if (wordBoundary >= 8) keyword = keyword.slice(0, wordBoundary);
  }
  return keyword.trim();
}

export function normalizeStudioLocalizedKeywordCoverage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.localizedListings)) return value;
  let changed = false;
  const localizedListings = source.localizedListings.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const listing = entry as Record<string, unknown>;
    if (typeof listing.title !== "string" || !Array.isArray(listing.keywords)
        || !listing.keywords.every((keyword) => typeof keyword === "string")) return entry;
    const detailSections = Array.isArray(listing.detailSections) ? listing.detailSections : [];
    const searchableCopy = [
      listing.title,
      listing.shortDescription,
      listing.description,
      ...detailSections.flatMap((section) => {
        if (!section || typeof section !== "object" || Array.isArray(section)) return [];
        const detail = section as Record<string, unknown>;
        return [detail.heading, detail.body];
      }),
    ].filter((text): text is string => typeof text === "string").join(" ").toLocaleLowerCase();
    if (listing.keywords.some((keyword) => searchableCopy.includes(keyword.toLocaleLowerCase()))) return entry;

    const connectedKeyword = boundedTitleKeyword(listing.title);
    if (!connectedKeyword) return entry;
    const keywords = listing.keywords.length < 10
      ? [...listing.keywords, connectedKeyword]
      : [...listing.keywords.slice(0, -1), connectedKeyword];
    changed = true;
    return { ...listing, keywords };
  });
  return changed ? { ...source, localizedListings } : value;
}

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
  "elevenst:KR": "ko-KR",
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
  competitorContext: studioCompetitorContextSchema.optional(),
}).superRefine((value, context) => {
  if (value.imagePaths.length !== value.imageSpecs.length) {
    context.addIssue({ code: "custom", path: ["imageSpecs"], message: "이미지 경로와 규격 정보 수가 일치해야 합니다." });
  }
  if (value.imageSpecs[0]?.role !== "main") {
    context.addIssue({ code: "custom", path: ["imageSpecs", 0, "role"], message: "첫 번째 이미지는 대표사진이어야 합니다." });
  }
});

export const productRevisionJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  manualFields: productEditSchema,
  imagePaths: z.array(z.string().min(1).max(400)).min(1).max(100),
  imageSpecs: z.array(normalizedProductImageSpecSchema).min(1).max(100),
  competitorContext: studioCompetitorContextSchema.optional(),
}).strict().superRefine((value, context) => {
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
    claimToken: z.string().uuid(),
    status: z.literal("succeeded"),
    result: cliStudioResultSchema,
    assetStoragePaths: z.record(
      z.enum(aiGeneratedAssetIds),
      z.string().min(1).max(400),
    ),
  }),
  z.object({
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
    status: z.literal("succeeded"),
    result: productResearchResultSchema,
  }),
  z.object({
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
    status: z.literal("succeeded"),
    result: supportReplyResultSchema,
  }),
  z.object({
    jobId: z.string().uuid(),
    claimToken: z.string().uuid(),
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
    claimToken: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
  }),
]);

export type CliStudioResult = z.infer<typeof cliStudioResultSchema>;
export type ProductResearchResult = z.infer<typeof productResearchResultSchema>;
export type SupportReplyResult = z.infer<typeof supportReplyResultSchema>;
