import assert from "node:assert/strict";
import test from "node:test";
import { cliStudioResultSchema } from "../lib/ai-cli-contract";

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
