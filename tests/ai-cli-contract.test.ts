import assert from "node:assert/strict";
import test from "node:test";
import { cliStudioResultSchema, productResearchJobRequestSchema, productResearchResultSchema, studioJobRequestSchema, supportReplyJobRequestSchema, supportReplyResultSchema, workerCompletionSchema } from "../lib/ai-cli-contract";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";

const localized = [
  ["qoo10", "JP", "ja-JP", "白い陶器のエスプレッソカップ"],
  ["shopee", "SG", "en-SG", "White ceramic espresso cup"],
  ["shopee", "MY", "ms-MY", "Cawan espresso seramik putih"],
  ["shopee", "PH", "en-PH", "White ceramic espresso cup"],
  ["shopee", "VN", "vi-VN", "Tách espresso gốm trắng"],
  ["shopee", "TH", "th-TH", "ถ้วยเอสเปรสโซเซรามิกสีขาว"],
  ["shopee", "TW", "zh-TW", "白色陶瓷濃縮咖啡杯"],
  ["shopee", "BR", "pt-BR", "Xícara de café expresso em cerâmica branca"],
  ["shopee", "MX", "es-MX", "Taza de café exprés de cerámica blanca"],
  ["lazada", "MY", "ms-MY", "Cawan espresso seramik putih"],
  ["lazada", "SG", "en-SG", "White ceramic espresso cup"],
  ["lazada", "PH", "en-PH", "White ceramic espresso cup"],
  ["lazada", "TH", "th-TH", "ถ้วยเอสเปรสโซเซรามิกสีขาว"],
  ["lazada", "VN", "vi-VN", "Tách espresso gốm trắng"],
  ["lazada", "ID", "id-ID", "Cangkir espresso keramik putih"],
  ["coupang", "KR", "ko-KR", "화이트 도자기 에스프레소 컵"],
  ["smartstore", "KR", "ko-KR", "화이트 도자기 에스프레소 컵"],
  ["ebay", "US", "en-US", "White Ceramic Espresso Cup"],
  ["ebay", "GB", "en-GB", "White Ceramic Espresso Cup"],
  ["ebay", "DE", "de-DE", "Weiße Keramik-Espressotasse"],
  ["ebay", "AU", "en-AU", "White Ceramic Espresso Cup"],
  ["ebay", "CA", "en-CA", "White Ceramic Espresso Cup"],
  ["ebay", "FR", "fr-FR", "Tasse à expresso en céramique blanche"],
  ["ebay", "IT", "it-IT", "Tazzina da espresso in ceramica bianca"],
  ["ebay", "ES", "es-ES", "Taza de espresso de cerámica blanca"],
  ["temu", "KR", "ko-KR", "화이트 도자기 에스프레소 컵"],
] as const;

function validResult() {
  return {
    mode: "cli" as const,
    product: {
      name: "White ceramic espresso cup",
      category: "Drinkware",
      oneLine: "A compact ceramic cup for espresso.",
      targetCustomer: "Home coffee drinkers",
      features: ["Ceramic body", "Compact size", "Neutral white finish"],
      cautions: ["Cup only; saucer is not included."],
    },
    design: {
      themeName: "Quiet tableware",
      palette: { primary: "#262626", accent: "#b7895b", surface: "#f6f2ed", text: "#171717" },
      heroCopy: "A calm espresso moment",
      heroSubcopy: "A simple white cup for a daily single shot.",
      cta: "View details",
      sections: Array.from({ length: 5 }, (_, index) => ({
        type: "benefit" as const,
        eyebrow: `Feature ${index + 1}`,
        title: "Made for a single espresso",
        body: "A clean ceramic cup with a compact silhouette.",
        points: ["Ceramic", "Cup only"],
      })),
    },
    thumbnail: { headline: "White espresso cup", subline: "Ceramic cup only", badge: "1 piece" },
    localizedListings: localized.map(([channel, market, locale, copy]) => ({
      channel,
      market,
      locale,
      title: copy,
      shortDescription: copy,
      description: `${copy}. ${copy}.`,
      keywords: [copy, `${copy} 1`, `${copy} 2`],
      thumbnailAltText: copy,
      detailSections: [
        { type: "overview" as const, heading: copy, body: copy, imageAsset: "detail-overview" as const, imageAltText: copy },
        { type: "feature" as const, heading: copy, body: copy, imageAsset: "detail-feature" as const, imageAltText: copy },
        { type: "howto" as const, heading: copy, body: copy, imageAsset: "detail-use" as const, imageAltText: copy },
        { type: "spec" as const, heading: copy, body: copy, imageAsset: "detail-package" as const, imageAltText: copy },
      ],
    })),
    warnings: [],
  };
}

test("AI studio contract accepts all 26 exact channel-market locales", () => {
  const parsed = cliStudioResultSchema.safeParse(validResult());
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio contract rejects a mismatched market locale", () => {
  const result = validResult();
  result.localizedListings[1].locale = "en-PH";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /en-SG/);
});

test("AI studio contract rejects Korean residue in localized listings", () => {
  const result = validResult();
  result.localizedListings[1].description += " 한국어 문장";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /한국어/);
});

test("AI studio contract rejects duplicated localized detail image roles", () => {
  const result = validResult();
  result.localizedListings[1].detailSections[1].imageAsset = "detail-overview";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /중복 없이 4개/);
});

test("AI studio contract rejects disconnected keyword stuffing", () => {
  const result = validResult();
  result.localizedListings[1].keywords = ["unrelated alpha", "unrelated beta", "unrelated gamma"];
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /자연스럽게 포함/);
});

function validRequiredIntake() {
  return {
    researchInput: "https://commons.wikimedia.org/wiki/File:Example.jpg white ceramic mug product reference",
    productName: "White ceramic mug",
    sellerSku: "MUG-OPEN-001",
    categoryHint: "Ceramic mug",
    brandName: "No Brand",
    manufacturer: "Open licensed test supplier",
    countryOfOrigin: "Republic of Korea",
    material: "Ceramic",
    packageContents: "One mug",
    condition: "NEW" as const,
    gtinStatus: "NO_GTIN" as const,
    gtin: "",
    sellingPrice: 12.9,
    currency: "USD" as const,
    stock: 1,
    weightKg: 0.35,
    packageLengthCm: 12,
    packageWidthCm: 12,
    packageHeightCm: 10,
    description: "A white ceramic mug collected from an open licensed reference source.",
    productUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    imageRightsConfirmed: true as const,
    productFactsConfirmed: true as const,
  };
}

function validResearchResult() {
  return {
    mode: "cli-research" as const,
    summary: "공개 상품 페이지와 입력 텍스트에서 화이트 도자기 머그의 확인 가능한 정보를 정리했습니다.",
    suggestedFields: {
      productName: "White ceramic mug",
      categoryHint: "Ceramic mug",
      brandName: null,
      manufacturer: null,
      countryOfOrigin: null,
      material: "Ceramic",
      packageContents: "One mug",
      description: "A white ceramic mug described by the supplied public product reference.",
      gtin: null,
    },
    searchQueries: [
      { locale: "ko-KR" as const, query: "화이트 세라믹 머그" },
      { locale: "en-US" as const, query: "white ceramic mug" },
      { locale: "ja-JP" as const, query: "白い セラミック マグカップ" },
      { locale: "ms-MY" as const, query: "cawan seramik putih" },
      { locale: "id-ID" as const, query: "mug keramik putih" },
      { locale: "vi-VN" as const, query: "cốc gốm trắng" },
    ],
    details: {
      features: ["White ceramic body"],
      specifications: [{ label: "Material", value: "Ceramic", evidence: "Public product description" }],
      usage: ["Drinkware"],
      cautions: ["Unverified dimensions require seller confirmation."],
    },
    sources: [{ url: "https://example.com/product", title: "Example product", status: "read" as const }],
    warnings: ["Brand and origin were not verified."],
  };
}

test("product research contract accepts a link or free-text CLI request", () => {
  assert.equal(productResearchJobRequestSchema.safeParse({
    jobId: "22222222-2222-4222-8222-222222222222",
    researchInput: "Model ABC-100, stainless steel bottle, 500 ml",
  }).success, true);
  assert.equal(productResearchResultSchema.safeParse(validResearchResult()).success, true);
});

test("AI studio request requires seller facts and normalized listing images", () => {
  const parsed = studioJobRequestSchema.safeParse({
    jobId: "11111111-1111-4111-8111-111111111111",
    manualFields: validRequiredIntake(),
    imagePaths: ["user/job/input/001.jpg"],
    imageSpecs: [{ name: "001.jpg", role: "main", originalWidth: 1600, originalHeight: 900, width: 1200, height: 1200, bytes: 450_000, mediaType: "image/jpeg", fit: "contain" }],
  });
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio request accepts free-text research without a source URL", () => {
  const parsed = studioJobRequestSchema.safeParse({
    jobId: "33333333-3333-4333-8333-333333333333",
    manualFields: {
      ...validRequiredIntake(),
      researchInput: "Model ABC-100 stainless steel bottle, 500 ml, one bottle included",
      productUrl: "",
    },
    imagePaths: ["user/job/input/001.jpg"],
    imageSpecs: [{ name: "001.jpg", role: "main", originalWidth: 1200, originalHeight: 1200, width: 1200, height: 1200, bytes: 350_000, mediaType: "image/jpeg", fit: "contain" }],
  });
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio request rejects missing rights confirmation and non-square output", () => {
  const manualFields = { ...validRequiredIntake(), imageRightsConfirmed: false };
  const parsed = studioJobRequestSchema.safeParse({
    jobId: "11111111-1111-4111-8111-111111111111",
    manualFields,
    imagePaths: ["user/job/input/001.jpg"],
    imageSpecs: [{ name: "001.jpg", role: "main", originalWidth: 1600, originalHeight: 900, width: 1080, height: 1080, bytes: 450_000, mediaType: "image/jpeg", fit: "contain" }],
  });
  assert.equal(parsed.success, false);
});

test("AI worker completion requires the full thumbnail and detail-image set", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const assetStoragePaths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [asset.id, aiGeneratedAssetPath(jobId, asset)]));
  const complete = workerCompletionSchema.safeParse({ jobId, status: "succeeded", result: validResult(), assetStoragePaths });
  if (!complete.success) assert.fail(JSON.stringify(complete.error.issues, null, 2));

  const incompletePaths = { ...assetStoragePaths };
  delete incompletePaths["detail-package"];
  assert.equal(workerCompletionSchema.safeParse({ jobId, status: "succeeded", result: validResult(), assetStoragePaths: incompletePaths }).success, false);
  assert.equal(aiGeneratedAssetSpecs.filter((asset) => asset.role === "detail").length, 4);
});

test("AI worker completion accepts a product research result without generated images", () => {
  const complete = workerCompletionSchema.safeParse({
    jobId: "22222222-2222-4222-8222-222222222222",
    status: "succeeded",
    result: validResearchResult(),
  });
  if (!complete.success) assert.fail(JSON.stringify(complete.error.issues, null, 2));
});

test("AI worker completion accepts exactly the regenerated image path", () => {
  const jobId = "33333333-3333-4333-8333-333333333333";
  const completion = workerCompletionSchema.safeParse({
    jobId,
    status: "succeeded",
    result: {
      mode: "asset-regeneration",
      assetId: "detail-use",
      sourceJobId: "11111111-1111-4111-8111-111111111111",
      sourceProductId: "22222222-2222-4222-8222-222222222222",
    },
    assetStoragePaths: {
      "detail-use": aiGeneratedAssetPath(jobId, aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-use")!),
    },
  });
  if (!completion.success) assert.fail(JSON.stringify(completion.error.issues, null, 2));
});

test("support reply CLI contract requires a supported locale and reviewable draft", () => {
  const request = supportReplyJobRequestSchema.safeParse({
    jobId: "44444444-4444-4444-8444-444444444444",
    ticketId: "55555555-5555-4555-8555-555555555555",
    targetLocale: "ja-JP",
    tone: "polite",
  });
  assert.equal(request.success, true);
  assert.equal(supportReplyJobRequestSchema.safeParse({
    jobId: "44444444-4444-4444-8444-444444444444",
    ticketId: "55555555-5555-4555-8555-555555555555",
    targetLocale: "unsupported",
    tone: "polite",
  }).success, false);

  const result = {
    mode: "support-reply" as const,
    targetLocale: "ja-JP" as const,
    draft: "お問い合わせありがとうございます。注文状況を確認してご案内いたします。",
    sourceSummary: "문의 원문과 주문 상태만 사용",
    cautions: ["확정되지 않은 배송일은 단정하지 않음"],
  };
  assert.equal(supportReplyResultSchema.safeParse(result).success, true);
  assert.equal(workerCompletionSchema.safeParse({
    jobId: "44444444-4444-4444-8444-444444444444",
    status: "succeeded",
    result,
  }).success, true);
});
