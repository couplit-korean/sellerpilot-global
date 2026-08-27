import { z, type RefinementCtx } from "zod";
import { aiDetailAssetIds, aiGeneratedAssetIds } from "./ai-generated-assets";
import { productEditSchema, productIntakeSchema, sourcePreservingProductImageSpecSchema } from "./product-intake";
import {
  hasDirectIntakeEvidence,
  hasNegatedHealthFunctionalFoodSignal,
  hasPositiveHealthFunctionalFoodEvidence,
  hasPrescriptiveIntakeInstruction,
  hasUnsupportedGeneralFoodEfficacyClaim,
  isGeneralFoodClassification,
} from "./product-classification";
import { maximumStudioJobSourceBytes } from "./studio-source-photo-policy";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const detailImageAssetSchema = z.enum(aiDetailAssetIds);
const masterDetailSectionTypes = ["benefit", "story", "howto", "proof", "spec", "caution", "comparison", "faq", "notice"] as const;
const localizedDetailSectionTypes = ["overview", "feature", "howto", "spec", "routine", "contents", "care", "proof"] as const;
const productClassificationSchema = z.object({
  displayName: z.string().min(1).max(120),
  verificationStatus: z.enum(["verified", "needs-review"]),
  evidence: z.string().min(10).max(500),
  isHealthFunctionalFood: z.boolean().nullable(),
}).superRefine((value, context) => {
  if (value.verificationStatus === "needs-review" && value.isHealthFunctionalFood !== null) {
    context.addIssue({ code: "custom", path: ["isHealthFunctionalFood"], message: "추가 확인 상태에서는 건강기능식품 여부를 null로 유지해야 합니다." });
  }
  if (value.verificationStatus === "verified" && value.isHealthFunctionalFood === null) {
    context.addIssue({ code: "custom", path: ["isHealthFunctionalFood"], message: "확정 상태에서는 건강기능식품 여부가 boolean이어야 합니다." });
  }
});

const localizedDetailSectionSchema = z.object({
  type: z.enum(localizedDetailSectionTypes),
  buyerQuestion: z.string().min(8).max(180),
  evidence: z.string().min(10).max(500),
  heading: z.string().min(4).max(100),
  body: z.string().min(60).max(700),
  imageAsset: detailImageAssetSchema,
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
  classification: productClassificationSchema,
  detailSections: z.array(localizedDetailSectionSchema).length(8),
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
    classification: productClassificationSchema,
    oneLine: z.string().min(1).max(240),
    targetCustomer: z.string().min(1).max(240),
    features: z.array(z.string().min(1).max(240)).min(4).max(8),
    cautions: z.array(z.string().min(1).max(320)).min(2).max(8),
  }),
  design: z.object({
    themeName: z.string().min(1).max(100),
    creativeStrategy: z.object({
      designArchetype: z.enum(["proof-led", "problem-solution", "routine-led", "comparison-led", "material-led", "fit-guide", "gift-story", "spec-first"]),
      purchaseDecision: z.string().min(1).max(300),
      contentDensity: z.enum(["long", "deep-dive"]),
      targetSectionCount: z.number().int().min(16).max(20),
      lengthRationale: z.string().min(1).max(400),
      differentiationKey: z.string().min(1).max(300),
      artDirection: z.string().min(1).max(600),
      motionPolicy: z.literal("static-first"),
    }),
    palette: z.object({ primary: hex, accent: hex, surface: hex, text: hex }),
    heroCopy: z.string().min(1).max(160),
    heroSubcopy: z.string().min(1).max(240),
    cta: z.string().min(1).max(80),
    sections: z.array(z.object({
      type: z.enum(masterDetailSectionTypes),
      buyerQuestion: z.string().min(8).max(160),
      evidence: z.string().min(10).max(500),
      eyebrow: z.string().min(1).max(80),
      title: z.string().min(1).max(160),
      body: z.string().min(160).max(1_100),
      points: z.array(z.string().min(1).max(240)).min(3).max(6),
      layout: z.enum(["split", "full-bleed", "cards", "steps", "spec-grid", "editorial"]),
      imageAsset: z.union([z.literal("none"), detailImageAssetSchema]),
      visualDirection: z.string().min(10).max(500),
      motion: z.enum(["none", "reveal", "stagger"]),
    })).min(16).max(20),
  }),
  thumbnail: z.object({
    headline: z.string().min(1).max(120),
    subline: z.string().min(1).max(120),
    badge: z.string().min(1).max(60),
  }),
  localizedListings: z.array(localizedListingSchema).length(27),
  warnings: z.array(z.string().min(1).max(400)).max(5),
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function generalFoodCopySegments(copy: string) {
  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < copy.length; index += 1) {
    const character = copy[index];
    const decimalPoint = character === "." && /\d/u.test(copy[index - 1] ?? "") && /\d/u.test(copy[index + 1] ?? "");
    if (decimalPoint || !/[.!?。！？;；\n]/u.test(character)) continue;
    segments.push(copy.slice(start, index + 1));
    start = index + 1;
  }
  if (start < copy.length) segments.push(copy.slice(start));
  return segments.length ? segments : [copy];
}

function removeUnsupportedGeneralFoodSegments(copy: string, evidence?: unknown) {
  const segments = generalFoodCopySegments(copy);
  // Match the validator's whole-field evidence contract before considering
  // individual sentences. A body can contain a package count in one sentence
  // and a label-backed intake direction in another; validating only the
  // direction sentence would preserve it even though the complete field still
  // fails closed because every measured token is not present in the evidence.
  const fieldHasUnsupportedIntake = hasPrescriptiveIntakeInstruction(copy)
    && !hasDirectIntakeEvidence(copy, evidence);
  let changed = false;
  const retained = segments.filter((segment) => {
    const semanticCopy = segment.trim();
    if (!semanticCopy || /^[.!?。！？;；]+$/u.test(semanticCopy)) return true;
    const unsupportedEfficacy = hasUnsupportedGeneralFoodEfficacyClaim(semanticCopy);
    const prescriptiveIntake = hasPrescriptiveIntakeInstruction(semanticCopy);
    const unsupportedIntake = prescriptiveIntake
      && (fieldHasUnsupportedIntake || !hasDirectIntakeEvidence(semanticCopy, evidence));
    if (!unsupportedEfficacy && !unsupportedIntake) return true;
    changed = true;
    return false;
  });
  const normalized = changed ? retained.join("").trim() : copy;
  // Some model output joins the frequency and measured amount across adjacent
  // clauses. If sentence-level removal cannot isolate that instruction, clear
  // the field so the existing localized body fallback can neutralize it; other
  // field types remain structurally invalid instead of bypassing the validator.
  if (hasPrescriptiveIntakeInstruction(normalized)
    && !hasDirectIntakeEvidence(normalized, evidence)) return "";
  return normalized;
}

function normalizeGeneralFoodStringFields(
  source: Record<string, unknown>,
  fields: readonly string[],
  evidence?: unknown,
) {
  let normalized = source;
  for (const field of fields) {
    const copy = source[field];
    if (typeof copy !== "string") continue;
    const safeCopy = removeUnsupportedGeneralFoodSegments(copy, evidence);
    if (safeCopy === copy) continue;
    if (normalized === source) normalized = { ...source };
    normalized[field] = safeCopy;
  }
  return normalized;
}

function normalizeGeneralFoodStringArray(value: unknown, evidence?: unknown) {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const normalized = value.flatMap((entry) => {
    if (typeof entry !== "string") return [entry];
    const safeCopy = removeUnsupportedGeneralFoodSegments(entry, evidence);
    if (safeCopy === entry) return [entry];
    changed = true;
    return safeCopy ? [safeCopy] : [];
  });
  return changed ? normalized : value;
}

function isGeneralFoodStudioValue(source: Record<string, unknown>) {
  const product = source.product;
  if (!isPlainRecord(product)) return false;
  const classification = product.classification;
  if (!isPlainRecord(classification) || classification.isHealthFunctionalFood === true) return false;
  const features = Array.isArray(product.features)
    ? product.features.filter((feature): feature is string => typeof feature === "string")
    : [];
  return isGeneralFoodClassification([
    product.category,
    classification.displayName,
    ...features,
  ].filter((signal): signal is string => typeof signal === "string").join(" "));
}

type GeneralFoodLocaleFallback = Readonly<{
  genericIdentity: string;
  summary: string;
  body: string;
}>;

const generalFoodLocaleFallbacks: Readonly<Record<string, GeneralFoodLocaleFallback>> = {
  ko: {
    genericIdentity: "이 상품",
    summary: "{identity}의 제공된 상품 자료를 참고하고 구매 전 실제 포장의 상품명과 대조하세요.",
    body: "{identity}의 상품 자료는 상품을 구분하기 위한 참고 정보입니다. 구매 전 실제 포장에 보이는 상품명과 표시 문구를 대조하고, 제공 자료에서 확인되지 않은 내용은 판매자에게 확인하세요.",
  },
  en: {
    genericIdentity: "this product",
    summary: "Review the supplied product material for {identity} and compare it with the product name visible on the actual package before purchase.",
    body: "Use the supplied product material for {identity} only as an identification reference. Before purchase, compare the product name and wording visible on the actual package, and ask the seller about any detail that is not confirmed in the supplied material.",
  },
  ja: {
    genericIdentity: "この商品",
    summary: "{identity}の提供された商品資料を参照し、購入前に実際のパッケージに見える商品名と照合してください。",
    body: "{identity}の提供された商品資料は、商品を区別するための参考情報です。購入前に実際のパッケージに見える商品名と表示文言を照合し、提供資料で確認できない内容は販売者に確認してください。",
  },
  zh: {
    genericIdentity: "此商品",
    summary: "請參考{identity}的所提供商品資料，並在購買前與實際包裝上可見的商品名稱核對。",
    body: "{identity}的所提供商品資料僅作為辨識商品的參考。購買前請核對實際包裝上可見的商品名稱與標示文字，所提供資料中未確認的內容則應向賣家查詢。",
  },
  vi: {
    genericIdentity: "sản phẩm này",
    summary: "Tham khảo tài liệu sản phẩm được cung cấp cho {identity} và đối chiếu với tên nhìn thấy trên bao bì thực tế trước khi mua.",
    body: "Chỉ dùng tài liệu sản phẩm được cung cấp cho {identity} làm thông tin tham khảo để nhận diện. Trước khi mua, hãy đối chiếu tên sản phẩm và nội dung nhìn thấy trên bao bì thực tế, đồng thời hỏi người bán về mọi chi tiết chưa được xác nhận trong tài liệu được cung cấp.",
  },
  id: {
    genericIdentity: "produk ini",
    summary: "Gunakan materi produk yang disediakan untuk {identity} sebagai referensi dan cocokkan dengan nama pada kemasan sebenarnya sebelum membeli.",
    body: "Gunakan materi produk yang disediakan untuk {identity} hanya sebagai referensi identifikasi. Sebelum membeli, cocokkan nama produk dan tulisan yang terlihat pada kemasan sebenarnya, lalu tanyakan kepada penjual tentang rincian yang belum terkonfirmasi dalam materi yang disediakan.",
  },
  ms: {
    genericIdentity: "produk ini",
    summary: "Rujuk bahan produk yang diberikan untuk {identity} dan padankan dengan nama pada pembungkusan sebenar sebelum membeli.",
    body: "Gunakan bahan produk yang diberikan untuk {identity} hanya sebagai rujukan pengenalan. Sebelum membeli, padankan nama produk dan tulisan yang kelihatan pada pembungkusan sebenar, kemudian tanya penjual tentang butiran yang belum disahkan dalam bahan yang diberikan.",
  },
  th: {
    genericIdentity: "สินค้านี้",
    summary: "ใช้ข้อมูลสินค้าที่ให้มาของ{identity}เป็นข้อมูลอ้างอิง และเทียบกับชื่อที่เห็นบนบรรจุภัณฑ์จริงก่อนซื้อ",
    body: "ใช้ข้อมูลสินค้าที่ให้มาของ{identity}เป็นข้อมูลอ้างอิงเพื่อแยกแยะสินค้าเท่านั้น ก่อนซื้อให้เทียบชื่อสินค้าและข้อความที่เห็นบนบรรจุภัณฑ์จริง และสอบถามผู้ขายเกี่ยวกับรายละเอียดที่ยังไม่ได้รับการยืนยันในข้อมูลที่ให้มา",
  },
  es: {
    genericIdentity: "este producto",
    summary: "Consulte el material proporcionado de {identity} y compárelo con el nombre visible en el envase real antes de comprar.",
    body: "Use el material proporcionado de {identity} solo como referencia de identificación. Antes de comprar, compare el nombre del producto y el texto visible en el envase real, y consulte al vendedor cualquier dato que no esté confirmado en el material proporcionado.",
  },
  pt: {
    genericIdentity: "este produto",
    summary: "Consulte o material fornecido de {identity} e compare-o com o nome visível na embalagem real antes da compra.",
    body: "Use o material fornecido de {identity} apenas como referência de identificação. Antes da compra, compare o nome do produto e o texto visível na embalagem real e consulte o vendedor sobre qualquer detalhe não confirmado no material fornecido.",
  },
  fr: {
    genericIdentity: "ce produit",
    summary: "Consultez les éléments fournis pour {identity} et comparez-les au nom visible sur l’emballage réel avant l’achat.",
    body: "Utilisez les éléments fournis pour {identity} uniquement comme référence d’identification. Avant l’achat, comparez le nom du produit et le texte visible sur l’emballage réel, puis demandez au vendeur tout détail qui n’est pas confirmé dans les éléments fournis.",
  },
  de: {
    genericIdentity: "dieses Produkt",
    summary: "Nutzen Sie das bereitgestellte Produktmaterial zu {identity} als Referenz und vergleichen Sie es vor dem Kauf mit dem Namen auf der tatsächlichen Verpackung.",
    body: "Nutzen Sie das bereitgestellte Produktmaterial zu {identity} nur als Referenz zur Identifizierung. Vergleichen Sie vor dem Kauf den Produktnamen und den sichtbaren Text auf der tatsächlichen Verpackung und fragen Sie beim Verkäufer nach Angaben, die im bereitgestellten Material nicht bestätigt sind.",
  },
  it: {
    genericIdentity: "questo prodotto",
    summary: "Consultare il materiale fornito per {identity} e confrontarlo con il nome visibile sulla confezione reale prima dell’acquisto.",
    body: "Usare il materiale fornito per {identity} solo come riferimento per l’identificazione. Prima dell’acquisto, confrontare il nome del prodotto e il testo visibile sulla confezione reale e chiedere al venditore ogni dettaglio non confermato nel materiale fornito.",
  },
};

function generalFoodLocaleFallback(locale: unknown) {
  if (typeof locale !== "string") return undefined;
  return generalFoodLocaleFallbacks[locale.split("-")[0]?.toLocaleLowerCase() ?? ""];
}

function validLocalizedGeneralFoodIdentity(
  source: Record<string, unknown>,
  normalized: Record<string, unknown>,
) {
  if (source.title !== normalized.title || typeof normalized.title !== "string") return undefined;
  const identity = normalized.title.trim();
  const locale = typeof normalized.locale === "string" ? normalized.locale : "";
  if (identity.length < 1 || identity.length > 120
    || removeUnsupportedGeneralFoodSegments(identity) !== identity
    || hasPrescriptiveIntakeInstruction(identity)
    || (locale !== "ko-KR" && /\p{Script=Hangul}/u.test(identity))
    || !hasExpectedScript(locale, identity)) return undefined;
  return identity;
}

function validLocalizedGeneralFoodFallback(
  locale: string,
  copy: string,
  minimum: number,
  maximum: number,
) {
  return copy.length >= minimum
    && copy.length <= maximum
    && !hasUnsupportedGeneralFoodEfficacyClaim(copy)
    && !hasPrescriptiveIntakeInstruction(copy)
    && (locale === "ko-KR" || !/\p{Script=Hangul}/u.test(copy))
    && hasExpectedScript(locale, copy);
}

function restoreLocalizedGeneralFoodMinimums(
  source: Record<string, unknown>,
  normalized: Record<string, unknown>,
) {
  const fallback = generalFoodLocaleFallback(normalized.locale);
  const identity = validLocalizedGeneralFoodIdentity(source, normalized);
  const locale = typeof normalized.locale === "string" ? normalized.locale : "";
  if (!fallback || !identity) return normalized;
  let restored = normalized;

  if (typeof source.shortDescription === "string"
    && source.shortDescription.length >= 1
    && source.shortDescription.length <= 500
    && typeof normalized.shortDescription === "string"
    && source.shortDescription !== normalized.shortDescription
    && normalized.shortDescription.length < 1) {
    const summary = fallback.summary.replaceAll("{identity}", identity);
    if (validLocalizedGeneralFoodFallback(locale, summary, 1, 500)) {
      restored = { ...restored, shortDescription: summary };
    }
  }

  const sourceDetails = source.detailSections;
  const normalizedDetails = normalized.detailSections;
  if (Array.isArray(sourceDetails) && Array.isArray(normalizedDetails)) {
    let detailSectionsChanged = false;
    const detailSections = normalizedDetails.map((entry, index) => {
      const original = sourceDetails[index];
      if (!isPlainRecord(original) || !isPlainRecord(entry)
        || typeof original.body !== "string"
        || original.body.length < 60
        || original.body.length > 700
        || typeof entry.body !== "string"
        || original.body === entry.body
        || entry.body.length >= 60) return entry;
      const retained = entry.body.trim();
      const heading = original.heading === entry.heading
        && typeof entry.heading === "string"
        && entry.heading.length >= 4
        && entry.heading.length <= 100
        && removeUnsupportedGeneralFoodSegments(entry.heading, entry.evidence) === entry.heading
        && !hasPrescriptiveIntakeInstruction(entry.heading)
        ? entry.heading
        : "";
      const retainedHasIntake = retained ? hasPrescriptiveIntakeInstruction(retained) : false;
      const prefix = retained || heading;
      const bodyIdentity = retainedHasIntake ? fallback.genericIdentity : identity;
      const neutralBody = fallback.body.replaceAll("{identity}", bodyIdentity);
      if ((retained && (hasUnsupportedGeneralFoodEfficacyClaim(retained)
        || (hasPrescriptiveIntakeInstruction(retained)
          && !hasDirectIntakeEvidence(retained, entry.evidence))))
        || !validLocalizedGeneralFoodFallback(locale, neutralBody, 1, 700)) return entry;
      const body = prefix ? `${prefix} ${neutralBody}` : neutralBody;
      if (body.length < 60
        || body.length > 700
        || hasUnsupportedGeneralFoodEfficacyClaim(body)
        || (hasPrescriptiveIntakeInstruction(body)
          && !hasDirectIntakeEvidence(body, entry.evidence))
        || (locale !== "ko-KR" && /\p{Script=Hangul}/u.test(body))
        || !hasExpectedScript(locale, body)) return entry;
      detailSectionsChanged = true;
      return { ...entry, body };
    });
    if (detailSectionsChanged) {
      if (restored === normalized) restored = { ...normalized };
      restored.detailSections = detailSections;
    }
  }
  return restored;
}

/**
 * Removes only unsupported general-food claim sentences from model output.
 * It preserves explicit negation and label-backed intake directions. If that
 * removal alone empties a localized summary or shortens a localized detail
 * body, a deterministic product-identity review instruction restores only the
 * existing structural minimum; unrelated malformed output remains fail-closed.
 */
export function normalizeStudioGeneralFoodSafety(value: unknown): unknown {
  if (!isPlainRecord(value) || !isGeneralFoodStudioValue(value)) return value;

  const source = value;
  const product = source.product as Record<string, unknown>;
  let normalizedProduct = normalizeGeneralFoodStringFields(product, ["oneLine", "targetCustomer"]);
  const normalizedFeatures = normalizeGeneralFoodStringArray(product.features);
  if (normalizedFeatures !== product.features) {
    if (normalizedProduct === product) normalizedProduct = { ...product };
    normalizedProduct.features = normalizedFeatures;
  }
  const normalizedCautions = normalizeGeneralFoodStringArray(product.cautions);
  if (normalizedCautions !== product.cautions) {
    if (normalizedProduct === product) normalizedProduct = { ...product };
    normalizedProduct.cautions = normalizedCautions;
  }

  const design = source.design;
  let normalizedDesign: unknown = design;
  if (isPlainRecord(design)) {
    let normalizedDesignRecord = normalizeGeneralFoodStringFields(design, ["heroCopy", "heroSubcopy", "cta"]);
    if (Array.isArray(design.sections)) {
      let sectionsChanged = false;
      const normalizedSections = design.sections.map((entry) => {
        if (!isPlainRecord(entry)) return entry;
        let normalizedSection = normalizeGeneralFoodStringFields(
          entry,
          ["buyerQuestion", "eyebrow", "title", "body", "visualDirection"],
          entry.evidence,
        );
        const normalizedPoints = normalizeGeneralFoodStringArray(entry.points, entry.evidence);
        if (normalizedPoints !== entry.points) {
          if (normalizedSection === entry) normalizedSection = { ...entry };
          normalizedSection.points = normalizedPoints;
        }
        if (normalizedSection !== entry) sectionsChanged = true;
        return normalizedSection;
      });
      if (sectionsChanged) {
        if (normalizedDesignRecord === design) normalizedDesignRecord = { ...design };
        normalizedDesignRecord.sections = normalizedSections;
      }
    }
    normalizedDesign = normalizedDesignRecord;
  }

  const thumbnail = source.thumbnail;
  const normalizedThumbnail = isPlainRecord(thumbnail)
    ? normalizeGeneralFoodStringFields(thumbnail, ["headline", "subline", "badge"])
    : thumbnail;

  const localizedListings = source.localizedListings;
  let normalizedLocalizedListings = localizedListings;
  if (Array.isArray(localizedListings)) {
    let listingsChanged = false;
    normalizedLocalizedListings = localizedListings.map((entry) => {
      if (!isPlainRecord(entry)) return entry;
      let normalizedListing = normalizeGeneralFoodStringFields(
        entry,
        ["title", "shortDescription", "description", "thumbnailAltText"],
      );
      const normalizedKeywords = normalizeGeneralFoodStringArray(entry.keywords);
      if (normalizedKeywords !== entry.keywords) {
        if (normalizedListing === entry) normalizedListing = { ...entry };
        normalizedListing.keywords = normalizedKeywords;
      }
      if (Array.isArray(entry.detailSections)) {
        let detailSectionsChanged = false;
        const normalizedDetailSections = entry.detailSections.map((detail) => {
          if (!isPlainRecord(detail)) return detail;
          const normalizedDetail = normalizeGeneralFoodStringFields(
            detail,
            ["buyerQuestion", "heading", "body", "imageAltText"],
            detail.evidence,
          );
          if (normalizedDetail !== detail) detailSectionsChanged = true;
          return normalizedDetail;
        });
        if (detailSectionsChanged) {
          if (normalizedListing === entry) normalizedListing = { ...entry };
          normalizedListing.detailSections = normalizedDetailSections;
        }
      }
      if (normalizedListing !== entry) {
        normalizedListing = restoreLocalizedGeneralFoodMinimums(entry, normalizedListing);
      }
      if (normalizedListing !== entry) listingsChanged = true;
      return normalizedListing;
    });
    if (!listingsChanged) normalizedLocalizedListings = localizedListings;
  }

  if (normalizedProduct === product
    && normalizedDesign === design
    && normalizedThumbnail === thumbnail
    && normalizedLocalizedListings === localizedListings) return value;
  return {
    ...source,
    product: normalizedProduct,
    design: normalizedDesign,
    thumbnail: normalizedThumbnail,
    localizedListings: normalizedLocalizedListings,
  };
}

export function normalizeStudioWarningLimits(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.warnings)) return value;
  const warnings = source.warnings
    .map((warning) => {
      if (typeof warning !== "string") return warning;
      let normalized = sanitizeStudioWarning(warning);
      normalized = normalized.slice(0, 400);
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

const sellerSafeInternalWarning = "내부 제작 메모와 작업 경로는 상품 사실 근거가 아니므로 판매자용 경고에서 제외했습니다.";
const internalWarningProvenancePattern = /(?:\b(?:AGENTS|MEMORY|SKILL)\.md\b|\brollout_summaries[\\/]|\brollout\s+id\b|(?:file:\/\/|\/(?:Users|home|tmp|private|var\/folders|workspace|mnt)\/|[A-Za-z]:\\(?:Users|Temp|workspace)\\|(?:~\/)?\.codex\/)|(?:내부|시스템|작업)\s*(?:프롬프트|지시문)|\b(?:internal|system)\s+(?:prompt|instruction)\b|\bprompt\s+provenance\b|API가\s*최신인지\s*확인하세요)/iu;

function warningSentenceSegments(value: string) {
  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const decimalPoint = character === "." && /\d/u.test(value[index - 1] ?? "") && /\d/u.test(value[index + 1] ?? "");
    if (decimalPoint || !/[.!?。！？]/u.test(character)) continue;
    segments.push(value.slice(start, index + 1).trim());
    start = index + 1;
  }
  if (start < value.length) segments.push(value.slice(start).trim());
  return segments.filter(Boolean);
}

function collapseAdjacentRepeatedWarningSentences(value: string) {
  const segments = warningSentenceSegments(value);
  if (segments.length < 2) return value;
  const retained: string[] = [];
  let previousKey = "";
  let changed = false;
  for (const segment of segments) {
    const key = segment.replace(/\s+/gu, " ").toLocaleLowerCase();
    if (key === previousKey) {
      changed = true;
      continue;
    }
    retained.push(segment);
    previousKey = key;
  }
  return changed ? retained.join(" ") : value;
}

function sanitizeStudioWarning(warning: string) {
  let normalized = warning.trim();
  const provenance = internalWarningProvenancePattern.exec(normalized);
  if (provenance?.index !== undefined) {
    let safeEnd = provenance.index;
    const prefix = normalized.slice(0, provenance.index);
    if (!/^API가\s*최신인지\s*확인하세요/iu.test(provenance[0])) {
      const sentenceBoundaries = [...prefix.matchAll(/[.!?。！？]\s+/gu)];
      const lastBoundary = sentenceBoundaries.at(-1);
      if (lastBoundary?.index !== undefined) safeEnd = lastBoundary.index + lastBoundary[0].length;
      else safeEnd = 0;
    }
    normalized = normalized.slice(0, safeEnd).trim() || sellerSafeInternalWarning;
  }
  return collapseAdjacentRepeatedWarningSentences(normalized);
}

/**
 * Reconciles the declared master section count with a structurally valid
 * 16-to-20-section result. It never makes an undersized or oversized draft
 * look valid and it does not mutate the model output.
 */
export function normalizeStudioSectionCount(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const design = source.design;
  if (!design || typeof design !== "object" || Array.isArray(design)) return value;
  const designRecord = design as Record<string, unknown>;
  const sections = designRecord.sections;
  if (!Array.isArray(sections) || sections.length < 16 || sections.length > 20) return value;
  const creativeStrategy = designRecord.creativeStrategy;
  if (!creativeStrategy || typeof creativeStrategy !== "object" || Array.isArray(creativeStrategy)) return value;
  const creativeStrategyRecord = creativeStrategy as Record<string, unknown>;
  if (creativeStrategyRecord.targetSectionCount === sections.length) return value;
  return {
    ...source,
    design: {
      ...designRecord,
      creativeStrategy: {
        ...creativeStrategyRecord,
        targetSectionCount: sections.length,
      },
    },
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
      typeof listing.classification === "object" && listing.classification
        ? (listing.classification as Record<string, unknown>).displayName
        : undefined,
      ...detailSections.flatMap((section) => {
        if (!section || typeof section !== "object" || Array.isArray(section)) return [];
        const detail = section as Record<string, unknown>;
        return [detail.buyerQuestion, detail.heading, detail.body, detail.evidence];
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

export function normalizeStudioResultForTerminalValidation(value: unknown): unknown {
  return normalizeStudioLocalizedKeywordCoverage(normalizeStudioWarningLimits(
    normalizeStudioSectionCount(normalizeStudioGeneralFoodSafety(value)),
  ));
}

export const requiredLocalizedMarkets = {
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

function hasExpectedScript(locale: string, value: string) {
  if (locale === "ko-KR") return /\p{Script=Hangul}/u.test(value);
  if (locale === "ja-JP") return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
  if (locale === "th-TH") return /\p{Script=Thai}/u.test(value);
  if (locale === "zh-TW") return /\p{Script=Han}/u.test(value);
  return /[A-Za-z]/u.test(value);
}

function hasExpectedAggregateLocaleSignal(locale: string, value: string) {
  if (locale === "vi-VN") return /[\u0102\u0103\u00C2\u00E2\u0110\u0111\u00CA\u00EA\u00D4\u00F4\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EFF]/u.test(value);
  if (locale === "pt-BR") return /[\u00C0-\u00FF]/u.test(value);
  if (locale === "es-MX") return /[\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1\u00FC\u00BF\u00A1]/iu.test(value);
  return true;
}

function meaningfulTokens(value: string) {
  return new Set(value.toLocaleLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/gu) ?? []);
}

function tokenOverlapRatio(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return { shared: 0, ratio: 0 };
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return { shared, ratio: shared / Math.min(left.size, right.size) };
}

function validateGeneralFoodClaim(
  context: RefinementCtx,
  path: Array<string | number>,
  copy: string,
  evidence?: string,
) {
  if (hasUnsupportedGeneralFoodEfficacyClaim(copy)) {
    context.addIssue({ code: "custom", path, message: "일반식품에는 건강기능식품 효능·질병 예방 표현을 사용할 수 없습니다." });
  }
  if (hasPrescriptiveIntakeInstruction(copy) && !hasDirectIntakeEvidence(copy, evidence)) {
    context.addIssue({ code: "custom", path, message: "일반식품 섭취량은 동일 수치가 있는 라벨·제조사 근거와 함께 제시해야 합니다." });
  }
}

export const cliStudioResultSchema = studioCoreSchema.extend({ mode: z.literal("cli") }).superRefine((value, context) => {
  const classificationSignals = [
    value.product.category,
    value.product.classification.displayName,
    ...value.product.features,
  ].join(" ");
  if (value.product.classification.isHealthFunctionalFood === true) {
    if (/당류가공품/.test(classificationSignals)
      || hasNegatedHealthFunctionalFoodSignal(classificationSignals)
      || hasNegatedHealthFunctionalFoodSignal(value.product.classification.evidence)) {
      context.addIssue({ code: "custom", path: ["product", "classification"], message: "일반식품 표시와 건강기능식품 분류를 동시에 사용할 수 없습니다." });
    }
    if (!hasPositiveHealthFunctionalFoodEvidence(value.product.classification.evidence)) {
      context.addIssue({ code: "custom", path: ["product", "classification", "evidence"], message: "건강기능식품 분류에는 실물 마크·기능정보·인정번호 중 확인 근거가 필요합니다." });
    }
  } else if (/(?:건강\s*기능\s*식품|health\s+functional\s+food)/iu.test(value.product.classification.displayName)
    && !hasNegatedHealthFunctionalFoodSignal(value.product.classification.displayName)) {
    context.addIssue({ code: "custom", path: ["product", "classification", "displayName"], message: "건강기능식품이 아닌 상품에 건강기능식품 분류명을 사용할 수 없습니다." });
  }
  const generalFood = value.product.classification.isHealthFunctionalFood !== true
    && isGeneralFoodClassification(classificationSignals);
  if (generalFood) {
    const unsupportedProductClaims: Array<[Array<string | number>, string]> = [
      [["product", "oneLine"], value.product.oneLine],
      [["product", "targetCustomer"], value.product.targetCustomer],
      ...value.product.features.map((feature, index): [Array<string | number>, string] => [["product", "features", index], feature]),
      ...value.product.cautions.map((caution, index): [Array<string | number>, string] => [["product", "cautions", index], caution]),
      [["design", "heroCopy"], value.design.heroCopy],
      [["design", "heroSubcopy"], value.design.heroSubcopy],
      [["design", "cta"], value.design.cta],
      [["thumbnail", "headline"], value.thumbnail.headline],
      [["thumbnail", "subline"], value.thumbnail.subline],
      [["thumbnail", "badge"], value.thumbnail.badge],
    ];
    for (const [path, copy] of unsupportedProductClaims) {
      validateGeneralFoodClaim(context, path, copy);
    }
  }

  if (value.design.sections.length !== value.design.creativeStrategy.targetSectionCount) {
    context.addIssue({ code: "custom", path: ["design", "creativeStrategy", "targetSectionCount"], message: "상세페이지 목표 섹션 수와 실제 섹션 수가 일치해야 합니다." });
  }
  const assignedAssets = value.design.sections.map((section) => section.imageAsset).filter((asset) => asset !== "none");
  const requiredAssets = [...aiDetailAssetIds];
  if (requiredAssets.length !== 12
    || assignedAssets.length !== requiredAssets.length
    || new Set(assignedAssets).size !== requiredAssets.length
    || requiredAssets.some((asset) => !assignedAssets.includes(asset as typeof assignedAssets[number]))) {
    context.addIssue({ code: "custom", path: ["design", "sections"], message: "상세 이미지 12종은 서로 다른 구매 질문에 정확히 한 번씩 배정해야 합니다." });
  }
  if (new Set(value.design.sections.map((section) => section.layout)).size < 5) {
    context.addIssue({ code: "custom", path: ["design", "sections"], message: "긴 상세페이지는 최소 5가지 서로 다른 레이아웃을 사용해야 합니다." });
  }
  value.design.sections.forEach((section, index) => {
    if (index > 0 && section.layout === value.design.sections[index - 1].layout) {
      context.addIssue({ code: "custom", path: ["design", "sections", index, "layout"], message: "같은 상세 레이아웃을 연속으로 반복할 수 없습니다." });
    }
    if (generalFood) {
      for (const [field, copy] of [
        ["buyerQuestion", section.buyerQuestion],
        ["eyebrow", section.eyebrow],
        ["title", section.title],
        ["body", section.body],
        ["visualDirection", section.visualDirection],
      ] as const) {
        validateGeneralFoodClaim(context, ["design", "sections", index, field], copy, section.evidence);
      }
      section.points.forEach((point, pointIndex) => {
        validateGeneralFoodClaim(context, ["design", "sections", index, "points", pointIndex], point, section.evidence);
      });
    }
  });
  for (const requiredType of masterDetailSectionTypes) {
    if (!value.design.sections.some((section) => section.type === requiredType)) {
      context.addIssue({ code: "custom", path: ["design", "sections"], message: `${requiredType} 구매정보 섹션이 필요합니다.` });
    }
  }

  const seenDetailCopy = new Map<string, string>();
  value.design.sections.forEach((section, index) => {
    const fields = [
      ["buyerQuestion", section.buyerQuestion],
      ["evidence", section.evidence],
      ["title", section.title],
      ["body", section.body],
      ...section.points.map((point, pointIndex) => [`points.${pointIndex}`, point]),
    ] as const;
    for (const [field, copy] of fields) {
      const normalized = copy.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
      const previous = seenDetailCopy.get(normalized);
      if (normalized.length >= 8 && previous) {
        context.addIssue({ code: "custom", path: ["design", "sections", index, field], message: `상세페이지 내용이 ${previous}와 중복됩니다.` });
      } else if (normalized.length >= 8) {
        seenDetailCopy.set(normalized, `sections.${index}.${field}`);
      }
    }
  });
  const claimTokenSets = value.design.sections.map((section) => meaningfulTokens([section.title, section.body, ...section.points].join(" ")));
  const questionTokenSets = value.design.sections.map((section) => meaningfulTokens(section.buyerQuestion));
  for (let current = 1; current < value.design.sections.length; current += 1) {
    for (let previous = 0; previous < current; previous += 1) {
      const claims = tokenOverlapRatio(claimTokenSets[current], claimTokenSets[previous]);
      if (claims.shared >= 6 && claims.ratio >= 0.68) {
        context.addIssue({ code: "custom", path: ["design", "sections", current], message: `sections.${previous}와 핵심 주장·본문의 의미 중복이 너무 큽니다.` });
      }
      const questions = tokenOverlapRatio(questionTokenSets[current], questionTokenSets[previous]);
      if (questions.shared >= 3 && questions.ratio >= 0.75) {
        context.addIssue({ code: "custom", path: ["design", "sections", current, "buyerQuestion"], message: `sections.${previous}와 같은 구매 질문을 반복합니다.` });
      }
    }
  }

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
    if (listing.classification.isHealthFunctionalFood !== value.product.classification.isHealthFunctionalFood
      || listing.classification.verificationStatus !== value.product.classification.verificationStatus) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "classification"], message: `${key} 분류 상태는 마스터 상품 분류와 일치해야 합니다.` });
    }
    const locale = expectedLocale ?? listing.locale;
    const localizedFields: Array<[Array<string | number>, string]> = [
      [["title"], listing.title],
      [["shortDescription"], listing.shortDescription],
      [["description"], listing.description],
      [["keywords"], listing.keywords.join(" ")],
      [["thumbnailAltText"], listing.thumbnailAltText],
      [["classification", "displayName"], listing.classification.displayName],
      [["classification", "evidence"], listing.classification.evidence],
      ...listing.detailSections.flatMap((section, sectionIndex): Array<[Array<string | number>, string]> => [
        [["detailSections", sectionIndex, "buyerQuestion"], section.buyerQuestion],
        [["detailSections", sectionIndex, "evidence"], section.evidence],
        [["detailSections", sectionIndex, "heading"], section.heading],
        [["detailSections", sectionIndex, "body"], section.body],
        [["detailSections", sectionIndex, "imageAltText"], section.imageAltText],
      ]),
    ];
    for (const [fieldPath, fieldValue] of localizedFields) {
      if (locale !== "ko-KR" && /\p{Script=Hangul}/u.test(fieldValue)) {
        context.addIssue({ code: "custom", path: ["localizedListings", index, ...fieldPath], message: `${key} 현지화 필드에 한국어가 남아 있습니다.` });
      }
      if (!hasExpectedScript(locale, fieldValue)) {
        context.addIssue({ code: "custom", path: ["localizedListings", index, ...fieldPath], message: `${key} 현지화 필드에 ${locale} 언어 문자가 확인되지 않습니다.` });
      }
    }
    const aggregateLocalizedText = localizedFields.map(([, fieldValue]) => fieldValue).join(" ");
    if (!hasExpectedAggregateLocaleSignal(locale, aggregateLocalizedText)) {
      context.addIssue({ code: "custom", path: ["localizedListings", index], message: `${key} 현지화 전체에 ${locale} 언어 고유 문자 신호가 없습니다.` });
    }
    const sectionTypes = new Set(listing.detailSections.map((section) => section.type));
    const imageAssets = new Set(listing.detailSections.map((section) => section.imageAsset));
    if (sectionTypes.size !== localizedDetailSectionTypes.length || imageAssets.size !== localizedDetailSectionTypes.length) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "detailSections"], message: `${key} 상세 섹션 유형과 이미지 역할은 중복 없이 8개여야 합니다.` });
    }
    const localizedRequiredAssets = ["detail-overview", "detail-feature", "detail-use", "detail-package", "detail-routine", "detail-contents"] as const;
    if (localizedRequiredAssets.some((asset) => !imageAssets.has(asset))) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "detailSections"], message: `${key}에는 전체·특징·사용·패키지·루틴·구성 이미지가 반드시 포함되어야 합니다.` });
    }
    if (generalFood) {
      for (const [field, copy] of [
        ["title", listing.title],
        ["shortDescription", listing.shortDescription],
        ["description", listing.description],
        ["thumbnailAltText", listing.thumbnailAltText],
      ] as const) {
        validateGeneralFoodClaim(context, ["localizedListings", index, field], copy);
      }
      listing.keywords.forEach((keyword, keywordIndex) => {
        validateGeneralFoodClaim(context, ["localizedListings", index, "keywords", keywordIndex], keyword);
      });
      listing.detailSections.forEach((section, sectionIndex) => {
        for (const [field, copy] of [
          ["buyerQuestion", section.buyerQuestion],
          ["heading", section.heading],
          ["body", section.body],
          ["imageAltText", section.imageAltText],
        ] as const) {
          validateGeneralFoodClaim(
            context,
            ["localizedListings", index, "detailSections", sectionIndex, field],
            copy,
            section.evidence,
          );
        }
      });
    }
    const searchableCopy = [
      listing.title,
      listing.shortDescription,
      listing.description,
      listing.classification.displayName,
      ...listing.detailSections.flatMap((section) => [section.buyerQuestion, section.heading, section.body, section.evidence]),
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
  imageSpecs: z.array(sourcePreservingProductImageSpecSchema).min(1).max(100),
  competitorContext: studioCompetitorContextSchema.optional(),
}).superRefine((value, context) => {
  if (value.imagePaths.length !== value.imageSpecs.length) {
    context.addIssue({ code: "custom", path: ["imageSpecs"], message: "이미지 경로와 규격 정보 수가 일치해야 합니다." });
  }
  if (value.imageSpecs[0]?.role !== "main") {
    context.addIssue({ code: "custom", path: ["imageSpecs", 0, "role"], message: "첫 번째 이미지는 대표사진이어야 합니다." });
  }
  if (value.imageSpecs.reduce((total, spec) => total + spec.originalBytes, 0) > maximumStudioJobSourceBytes) {
    context.addIssue({ code: "custom", path: ["imageSpecs"], message: "한 상품의 원본 사진 합계는 200MB 이하여야 합니다." });
  }
});

export const productRevisionJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  manualFields: productEditSchema,
  imagePaths: z.array(z.string().min(1).max(400)).min(1).max(100),
  imageSpecs: z.array(sourcePreservingProductImageSpecSchema).min(1).max(100),
  competitorContext: studioCompetitorContextSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.imagePaths.length !== value.imageSpecs.length) {
    context.addIssue({ code: "custom", path: ["imageSpecs"], message: "이미지 경로와 규격 정보 수가 일치해야 합니다." });
  }
  if (value.imageSpecs[0]?.role !== "main") {
    context.addIssue({ code: "custom", path: ["imageSpecs", 0, "role"], message: "첫 번째 이미지는 대표사진이어야 합니다." });
  }
  if (value.imageSpecs.reduce((total, spec) => total + spec.originalBytes, 0) > maximumStudioJobSourceBytes) {
    context.addIssue({ code: "custom", path: ["imageSpecs"], message: "한 상품의 원본 사진 합계는 200MB 이하여야 합니다." });
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
