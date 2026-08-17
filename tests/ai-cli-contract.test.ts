import assert from "node:assert/strict";
import test from "node:test";
import { cliStudioResultSchema, studioJobRequestSchema } from "../lib/ai-cli-contract";

const localized = [
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
    })),
    warnings: [],
  };
}

test("AI studio contract accepts all 14 exact channel-market locales", () => {
  const parsed = cliStudioResultSchema.safeParse(validResult());
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio contract rejects a mismatched market locale", () => {
  const result = validResult();
  result.localizedListings[0].locale = "en-PH";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /en-SG/);
});

test("AI studio contract rejects Korean residue in localized listings", () => {
  const result = validResult();
  result.localizedListings[0].description += " 한국어 문장";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /한국어/);
});

function validRequiredIntake() {
  return {
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

test("AI studio request requires seller facts and normalized listing images", () => {
  const parsed = studioJobRequestSchema.safeParse({
    jobId: "11111111-1111-4111-8111-111111111111",
    manualFields: validRequiredIntake(),
    imagePaths: ["user/job/input/001.jpg"],
    imageSpecs: [{ name: "001.jpg", role: "main", originalWidth: 1600, originalHeight: 900, width: 1200, height: 1200, bytes: 450_000, mediaType: "image/jpeg", fit: "contain" }],
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
