import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cliStudioResultSchema,
  normalizeStudioLocalizedKeywordCoverage,
  normalizeStudioWarningLimits,
  productResearchJobRequestSchema,
  productResearchResultSchema,
  studioJobRequestSchema,
  supportReplyJobRequestSchema,
  supportReplyResultSchema,
  supportReplyWorkerRequestSchema,
  workerCompletionSchema,
} from "../lib/ai-cli-contract";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { canonicalizeStudioCompetitorUrl } from "../lib/studio-competitor-evidence";
import { hasNegatedHealthFunctionalFoodSignal } from "../lib/product-classification";

const CLAIM_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("AI studio output schema keeps every object strict for structured output", () => {
  const schema = JSON.parse(readFileSync(new URL("../scripts/ai-studio-output.schema.json", import.meta.url), "utf8")) as unknown;

  const visit = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (!value || typeof value !== "object") return;

    const node = value as Record<string, unknown>;
    if (Object.hasOwn(node, "const")) {
      assert.ok(Object.hasOwn(node, "type"), `${path.join(".")} const schema must declare an explicit type`);
    }
    if (node.type === "object" || Object.hasOwn(node, "properties")) {
      const label = path.join(".");
      assert.equal(node.type, "object", `${label} must declare type=object`);
      assert.equal(node.additionalProperties, false, `${label} must reject additional properties`);

      if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
        const propertyNames = Object.keys(node.properties as Record<string, unknown>).sort();
        const requiredNames = Array.isArray(node.required)
          ? node.required.map(String).sort()
          : [];
        assert.deepEqual(requiredNames, propertyNames, `${label} must require every declared property`);
      }
    }

    Object.entries(node).forEach(([key, nested]) => visit(nested, [...path, key]));
  };

  visit(schema, ["$"]);
});

function sourcePreservingImageSpec(overrides: Partial<{
  originalWidth: number;
  originalHeight: number;
  bytes: number;
}> = {}) {
  return {
    name: "001.jpg",
    role: "main",
    originalName: "source.png",
    originalBytes: 875_000,
    originalMediaType: "image/png" as const,
    originalPath: "user/job/original/001.source",
    originalWidth: 1600,
    originalHeight: 900,
    width: 1200 as const,
    height: 1200 as const,
    bytes: 450_000,
    mediaType: "image/jpeg" as const,
    fit: "contain" as const,
    ...overrides,
  };
}

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
  ["elevenst", "KR", "ko-KR", "화이트 도자기 에스프레소 컵"],
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
  const sectionBlueprints = [
    { type: "benefit", buyerQuestion: "What exactly is included in this listing?", evidence: "The main reference image shows one white cup and no saucer or accessory.", eyebrow: "WHAT YOU RECEIVE", title: "One clearly defined cup", body: "The listing contains the single white ceramic espresso cup visible in the supplied image. A saucer, spoon, gift box, and additional cup are not shown and are therefore not presented as included items. This section keeps the purchase quantity separate from any decorative objects that may appear in a marketplace context.", points: ["One visible cup", "No saucer shown", "No accessory assumed"], layout: "cards", imageAsset: "detail-overview", visualDirection: "Show one complete cup alone at a readable three-quarter angle with clear empty space around every edge.", motion: "stagger" },
    { type: "story", buyerQuestion: "What visible form makes the cup identifiable?", evidence: "The front and side reference views support a compact bowl, white finish, and one curved handle.", eyebrow: "VISIBLE FORM", title: "A compact silhouette with a curved handle", body: "The visible form is defined by a small rounded drinking vessel and a single side handle. Keep the description limited to those observable characteristics instead of assigning an unverified capacity or ergonomic claim. The close view should help a shopper recognize the actual rim, wall, and handle relationship at a glance.", points: ["Rounded vessel profile", "Single curved side handle", "White exterior finish"], layout: "full-bleed", imageAsset: "detail-feature", visualDirection: "Use a tight oblique crop that makes the rim, ceramic surface, and handle connection visibly distinct.", motion: "reveal" },
    { type: "howto", buyerQuestion: "How is the cup used in an everyday coffee moment?", evidence: "The product category and supplied description identify the object as an espresso cup for home coffee use.", eyebrow: "USE MOMENT", title: "Prepared for a single coffee serving", body: "Place the cup on a stable surface before filling it with a suitable drink. The use scene should communicate ordinary home coffee service without implying heat resistance, dishwasher safety, or a measured serving volume that was not supplied. Buyers should follow their drink and appliance guidance independently of this listing.", points: ["Use on a stable surface", "Confirm drink temperature separately", "Keep the handle accessible"], layout: "split", imageAsset: "detail-use", visualDirection: "Show the cup as the dominant object on a real coffee surface with restrained preparation cues and no unverified accessories.", motion: "reveal" },
    { type: "proof", buyerQuestion: "Which package and product details can be verified visually?", evidence: "The uploaded views provide the visible product finish and physical outline but do not prove packaging claims.", eyebrow: "REFERENCE CHECK", title: "Only visible details become claims", body: "The white finish, overall vessel shape, and handle can be described because they are visible in the source material. Packaging, barcode, manufacturer marks, and certifications must remain unspecified unless another supplied view confirms them. The evidence panel distinguishes source-backed observations from facts that still need seller documentation.", points: ["Visible shape is usable evidence", "Unseen package data stays unclaimed", "Certifications require a source"], layout: "editorial", imageAsset: "detail-package", visualDirection: "Create a factual inspection view of verified surfaces only; do not invent a retail box, label, barcode, or included item.", motion: "none" },
    { type: "spec", buyerQuestion: "Which dimensions are confirmed and which still need measurement?", evidence: "No verified height, diameter, weight, or liquid capacity appears in the supplied source material.", eyebrow: "DIMENSION STATUS", title: "Measurements remain a seller checkpoint", body: "Height, rim diameter, base diameter, weight, and liquid capacity should be measured by the seller before publication rather than estimated from the photograph. A technical view may show the observable form and leave space for later values, but it must not render invented numbers, ruler marks, or scale claims.", points: ["Height is not yet supplied", "Capacity needs documentation", "Never estimate from pixels"], layout: "spec-grid", imageAsset: "detail-dimensions", visualDirection: "Use an isometric form inspection with blank annotation space and no numeric dimensions or measurement lines.", motion: "stagger" },
    { type: "benefit", buyerQuestion: "Where could the cup fit into a simple home coffee routine?", evidence: "The seller description identifies home coffee drinkers as the target customer for this espresso cup.", eyebrow: "ROUTINE FIT", title: "A straightforward place in the coffee setup", body: "The supplied audience description supports a calm home coffee context in which the cup is prepared beside ordinary brewing tools. It does not support claims about professional café performance, a specific brewing machine, or a guaranteed serving ritual. The scene should remain a plausible context rather than a performance promise.", points: ["Home coffee context", "Routine shown without guarantees", "Machine compatibility unverified"], layout: "cards", imageAsset: "detail-routine", visualDirection: "Place the cup in a restrained preparation routine while keeping unverified machines and accessories secondary or absent.", motion: "stagger" },
    { type: "story", buyerQuestion: "How should shoppers interpret the cup's apparent scale?", evidence: "The photographs reveal relative form but the intake includes no seller-confirmed measurements.", eyebrow: "SCALE CONTEXT", title: "Visual scale without false precision", body: "A familiar and factually safe tabletop cue can provide rough visual context, but it cannot replace seller measurements. The cup should remain the dominant object, and the composition must avoid rulers, printed dimensions, or language that converts perspective into an exact capacity. Buyers should rely on confirmed specifications when those are added.", points: ["Context is only illustrative", "Perspective is not measurement", "Await confirmed specifications"], layout: "full-bleed", imageAsset: "detail-scale", visualDirection: "Use one neutral tabletop reference object for spatial context without suggesting a numeric size or capacity.", motion: "reveal" },
    { type: "howto", buyerQuestion: "How can the cup be stored between uses?", evidence: "The product is a single handled ceramic vessel, while stacking strength and cabinet dimensions are not documented.", eyebrow: "STORAGE VIEW", title: "Store with the rim and handle protected", body: "Place the cup in a stable location where the rim and handle are not pressed against heavier objects. The listing must not promise stackability, impact resistance, or a particular cabinet fit because those properties were not provided. A storage scene can demonstrate accessible placement while leaving clearance visibly understandable.", points: ["Choose a stable shelf", "Avoid pressure on the handle", "Stackability is not confirmed"], layout: "steps", imageAsset: "detail-storage", visualDirection: "Show a single cup in an accessible shelf position with visible clearance around the rim and handle.", motion: "stagger" },
    { type: "caution", buyerQuestion: "Which care claims must remain unconfirmed?", evidence: "No dishwasher, microwave, oven, freezer, or cleaning instruction is present in the supplied facts.", eyebrow: "CARE CONFIRMATION", title: "Verify care directions before publishing", body: "Do not add dishwasher-safe, microwave-safe, oven-safe, freezer-safe, or thermal-shock claims without manufacturer evidence. Until care instructions are confirmed, the detail page should identify the relevant physical surfaces only and direct the seller to supply documented cleaning and temperature guidance before those claims appear.", points: ["Do not assume appliance safety", "Request manufacturer guidance", "Avoid thermal-resistance claims"], layout: "spec-grid", imageAsset: "detail-care", visualDirection: "Show the relevant rim and interior surfaces as an inspection view without soap, appliances, or invented care actions.", motion: "none" },
    { type: "comparison", buyerQuestion: "What does the supplied material fact establish?", evidence: "The seller-confirmed intake identifies ceramic as the product material and the source shows a smooth white surface.", eyebrow: "MATERIAL BOUNDARY", title: "Ceramic is confirmed; performance is not", body: "Ceramic may be stated as the material because it comes from the seller-confirmed intake. That fact alone does not prove a particular glaze formula, scratch resistance, stain resistance, insulation level, or durability rating. The material close-up should therefore focus on the visible finish and edge without suggesting laboratory performance.", points: ["Material: ceramic", "Surface finish is visible", "Durability rating not supplied"], layout: "cards", imageAsset: "detail-material", visualDirection: "Render a macro view of the visible ceramic finish and rim edge without diagrams or performance badges.", motion: "reveal" },
    { type: "proof", buyerQuestion: "How are the package contents verified for purchase?", evidence: "The intake states one mug, and the main reference shows one cup without any confirmed accessory.", eyebrow: "CONTENTS CHECK", title: "One item, shown once", body: "The package contents should present exactly one cup because that is the seller-confirmed quantity. No saucer, spoon, lid, gift box, or duplicate cup belongs in the contents view unless new evidence is supplied. Showing the physical item once creates a clear reconciliation point between the written intake and the listing image.", points: ["Confirmed quantity: one", "Accessories are excluded", "Duplicates are prohibited"], layout: "editorial", imageAsset: "detail-contents", visualDirection: "Use a factual top-down contents arrangement with the single verified cup shown once and no decorative duplicate.", motion: "none" },
    { type: "notice", buyerQuestion: "What can the closing lifestyle scene communicate safely?", evidence: "The product category supports an everyday tabletop context but does not establish health or performance outcomes.", eyebrow: "EVERYDAY CONTEXT", title: "A realistic moment without outcome claims", body: "The closing scene may place the cup in an ordinary coffee setting to help shoppers imagine placement and mood. It must not imply improved focus, energy, taste, brewing quality, or any bodily result. The product remains clearly visible while lighting, surface, and props create context that is visually distinct from the hero image.", points: ["Keep the cup clearly visible", "Avoid wellness implications", "Use a distinct environment"], layout: "full-bleed", imageAsset: "detail-context", visualDirection: "Create a wide everyday tabletop context with distinct lighting and no text, people, or outcome symbolism.", motion: "reveal" },
    { type: "faq", buyerQuestion: "Does the listing confirm microwave or dishwasher use?", evidence: "The seller intake and supplied images contain no appliance-safety or cleaning certification.", eyebrow: "COMMON QUESTION", title: "Appliance compatibility is not yet verified", body: "No. The current evidence does not confirm microwave, dishwasher, oven, or freezer compatibility. Those statements should remain absent until the manufacturer or seller supplies reliable instructions. This answer protects the buyer from treating a common category assumption as a product-specific guarantee.", points: ["Microwave use unverified", "Dishwasher use unverified", "Follow documented instructions"], layout: "split", imageAsset: "none", visualDirection: "Use a concise question-and-answer panel with neutral status markers and no appliance certification icons.", motion: "stagger" },
    { type: "spec", buyerQuestion: "Which product facts can appear in the specification table today?", evidence: "The seller-confirmed intake supplies the ceramic material, white cup identity, and one-item package contents.", eyebrow: "FACT TABLE", title: "Separate confirmed values from pending fields", body: "The specification table can list the product identity, ceramic material, and quantity of one. Capacity, weight, height, diameters, care compatibility, brand, and origin should be labeled for seller review or omitted until evidence is available. This separation keeps structured marketplace data aligned with the same proof standard as the visual page.", points: ["Identity and material confirmed", "Quantity confirmed as one", "Unknown values stay pending"], layout: "spec-grid", imageAsset: "none", visualDirection: "Create a two-state specification table that visibly separates confirmed entries from fields awaiting seller evidence.", motion: "none" },
    { type: "comparison", buyerQuestion: "Who fits this listing and who needs more information first?", evidence: "The supplied target customer is a home coffee drinker, while measurements and specialist compatibility remain unverified.", eyebrow: "FIT CHECK", title: "A fit for simple use, not specialist assumptions", body: "This listing can serve shoppers seeking a simple white ceramic espresso cup for a home setting and who can wait for confirmed measurements if size is important. Buyers needing exact machine clearance, commercial service durability, child suitability, or appliance-safe care instructions should request those facts before ordering.", points: ["Fits a simple home context", "Exact clearance needs dimensions", "Specialist requirements need proof"], layout: "cards", imageAsset: "none", visualDirection: "Use balanced fit and needs-confirmation columns without negative stereotypes or exaggerated benefit language.", motion: "stagger" },
    { type: "caution", buyerQuestion: "What must be checked immediately before an order is placed?", evidence: "The supplied cautions limit the purchase to one cup and identify measurements and care directions as unverified.", eyebrow: "FINAL ORDER CHECK", title: "Confirm quantity, size, and care evidence", body: "Before ordering, verify that one cup is the intended quantity and review seller-confirmed dimensions if fit or capacity matters. Do not assume a saucer or other accessory is included. If microwave, dishwasher, or temperature compatibility affects the decision, obtain the applicable manufacturer guidance before purchase rather than relying on category conventions.", points: ["Purchase quantity is one", "Check confirmed measurements", "Verify required care compatibility"], layout: "editorial", imageAsset: "none", visualDirection: "Finish with a high-contrast three-part checklist covering quantity, measurements, and documented care guidance.", motion: "none" },
  ] as const;
  return {
    mode: "cli" as const,
    product: {
      name: "White ceramic espresso cup",
      category: "Drinkware",
      classification: {
        displayName: "Ceramic drinkware",
        verificationStatus: "verified" as const,
        evidence: "Seller-confirmed ceramic material and the supplied product views identify a handled drinking vessel.",
        isHealthFunctionalFood: false,
      },
      oneLine: "A compact ceramic cup for espresso.",
      targetCustomer: "Home coffee drinkers",
      features: ["Ceramic body", "Compact vessel form", "Neutral white finish", "Single curved handle"],
      cautions: ["Cup only; saucer is not included.", "Dimensions and appliance compatibility require seller confirmation."],
    },
    design: {
      themeName: "Quiet tableware",
      creativeStrategy: {
        designArchetype: "material-led" as const,
        purchaseDecision: "Whether the visible ceramic form, included quantity, and pending measurements suit a home espresso serving.",
        contentDensity: "long" as const,
        targetSectionCount: sectionBlueprints.length,
        lengthRationale: "A sixteen-section flow covers distinct form, use, specification, evidence, care, comparison, FAQ, and ordering questions without inventing facts.",
        differentiationKey: "The white ceramic rim-to-handle silhouette is explained through a quiet home coffee inspection story.",
        artDirection: "Warm side light, pale mineral surfaces, restrained coffee context, and close attention to the white ceramic rim and curved handle.",
        motionPolicy: "static-first" as const,
      },
      palette: { primary: "#262626", accent: "#b7895b", surface: "#f6f2ed", text: "#171717" },
      heroCopy: "A calm espresso moment",
      heroSubcopy: "A simple white cup for a daily single shot.",
      cta: "View details",
      sections: sectionBlueprints.map((section) => ({ ...section })),
    },
    thumbnail: { headline: "White espresso cup", subline: "Ceramic cup only", badge: "1 piece" },
    localizedListings: localized.map(([channel, market, locale, copy]) => {
      const localizedBody = Array.from({ length: 8 }, () => copy).join(". ");
      const localizedEvidence = `${copy}. ${copy}.`;
      return {
        channel,
        market,
        locale,
        title: copy,
        shortDescription: copy,
        description: `${copy}. ${copy}.`,
        keywords: [copy, `${copy} 1`, `${copy} 2`],
        thumbnailAltText: copy,
        classification: {
          displayName: `${copy} product classification`,
          verificationStatus: "verified" as const,
          evidence: `${copy}. ${copy}. Supplied seller evidence.`,
          isHealthFunctionalFood: false,
        },
        detailSections: [
          { type: "overview" as const, buyerQuestion: `${copy}: overview?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Overview.`, imageAsset: "detail-overview" as const, imageAltText: copy },
          { type: "feature" as const, buyerQuestion: `${copy}: visible feature?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Feature.`, imageAsset: "detail-feature" as const, imageAltText: copy },
          { type: "howto" as const, buyerQuestion: `${copy}: safe use?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Use.`, imageAsset: "detail-use" as const, imageAltText: copy },
          { type: "spec" as const, buyerQuestion: `${copy}: specification?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Specification.`, imageAsset: "detail-package" as const, imageAltText: copy },
          { type: "routine" as const, buyerQuestion: `${copy}: routine fit?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Routine.`, imageAsset: "detail-routine" as const, imageAltText: copy },
          { type: "contents" as const, buyerQuestion: `${copy}: included contents?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Contents.`, imageAsset: "detail-contents" as const, imageAltText: copy },
          { type: "care" as const, buyerQuestion: `${copy}: care status?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Care.`, imageAsset: "detail-care" as const, imageAltText: copy },
          { type: "proof" as const, buyerQuestion: `${copy}: evidence status?`, evidence: localizedEvidence, heading: copy, body: `${localizedBody}. Evidence.`, imageAsset: "detail-material" as const, imageAltText: copy },
        ],
      };
    }),
    warnings: [],
  };
}

test("AI studio contract accepts all 27 exact channel-market locales", () => {
  const parsed = cliStudioResultSchema.safeParse(validResult());
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio contract rejects conflicting health-functional-food classification", () => {
  const result = validResult();
  result.product.category = "당류가공품";
  result.product.classification = {
    displayName: "건강기능식품",
    verificationStatus: "verified",
    evidence: "패키지에 건강기능식품 표시가 있다고 초안에 적히었습니다.",
    isHealthFunctionalFood: true,
  };
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /일반식품 표시/);
});

test("health-functional-food negation recognizes common Korean legal-label wording", () => {
  const negatedPhrases = [
    "건강기능식품이 아님",
    "건강기능식품이 아닌 일반식품",
    "건강기능식품이 아닙니다",
    "건강기능식품 아니다",
    "건강기능식품이 아니며 일반식품입니다",
    "건강기능식품이 아니오",
    "건강기능식품 해당 없음",
    "건강기능식품에 해당하지 않습니다",
    "건강기능식품 표시가 없습니다",
    "건강기능식품 마크 없음",
  ];
  for (const phrase of negatedPhrases) {
    assert.equal(hasNegatedHealthFunctionalFoodSignal(phrase), true, phrase);
    const result = validResult();
    result.product.category = `정제형 일반식품 · ${phrase}`;
    result.product.classification = {
      displayName: "건강기능식품",
      verificationStatus: "verified",
      evidence: "후면 라벨의 건강기능식품 표시와 기능정보 표에서 확인했습니다.",
      isHealthFunctionalFood: true,
    };
    result.localizedListings.forEach((listing) => {
      listing.classification.verificationStatus = "verified";
      listing.classification.isHealthFunctionalFood = true;
    });
    const parsed = cliStudioResultSchema.safeParse(result);
    assert.equal(parsed.success, false, phrase);
    assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /일반식품 표시/, phrase);
  }
});

test("AI studio contract rejects negative health-functional-food evidence", () => {
  const result = validResult();
  result.product.category = "정제형 식품";
  result.product.classification = {
    displayName: "건강기능식품",
    verificationStatus: "verified",
    evidence: "후면 라벨에는 건강기능식품 표시가 없습니다.",
    isHealthFunctionalFood: true,
  };
  result.localizedListings.forEach((listing) => {
    listing.classification.verificationStatus = "verified";
    listing.classification.isHealthFunctionalFood = true;
  });
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /일반식품 표시|확인 근거/);
});

test("AI studio contract keeps unknown classification in review state", () => {
  const result = validResult();
  result.product.classification = {
    displayName: "상품 분류 확인 필요",
    verificationStatus: "verified",
    evidence: "후면 표시사항 이미지가 제공되지 않아 분류를 확정하지 못했습니다.",
    isHealthFunctionalFood: null,
  };
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /확정 상태/);
});

test("AI studio contract enforces classification status and value in both directions", () => {
  const unresolved = validResult();
  unresolved.product.classification = {
    displayName: "상품 분류 확인 필요",
    verificationStatus: "needs-review",
    evidence: "후면 표시사항 이미지가 제공되지 않아 분류를 확정하지 못했습니다.",
    isHealthFunctionalFood: false,
  };
  unresolved.localizedListings.forEach((listing) => {
    listing.classification.verificationStatus = "needs-review";
    listing.classification.isHealthFunctionalFood = false;
  });
  const invalid = cliStudioResultSchema.safeParse(unresolved);
  assert.equal(invalid.success, false);
  assert.match(invalid.error?.issues.map((issue) => issue.message).join("\n") ?? "", /null로 유지/);

  unresolved.product.classification.isHealthFunctionalFood = null;
  unresolved.localizedListings.forEach((listing) => { listing.classification.isHealthFunctionalFood = null; });
  const valid = cliStudioResultSchema.safeParse(unresolved);
  if (!valid.success) assert.fail(JSON.stringify(valid.error.issues, null, 2));
});

test("AI studio contract rejects short or internally duplicated master detail pages", () => {
  const shortResult = validResult();
  shortResult.design.sections.pop();
  shortResult.design.creativeStrategy.targetSectionCount = shortResult.design.sections.length;
  const shortParsed = cliStudioResultSchema.safeParse(shortResult);
  assert.equal(shortParsed.success, false);

  const duplicatedResult = validResult();
  duplicatedResult.design.sections[1].title = duplicatedResult.design.sections[0].title;
  const duplicatedParsed = cliStudioResultSchema.safeParse(duplicatedResult);
  assert.equal(duplicatedParsed.success, false);
  assert.match(duplicatedParsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /중복/);
});

test("AI studio contract assigns each master detail image to one unique question", () => {
  const result = validResult();
  result.design.sections[1].imageAsset = "detail-overview";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /정확히 한 번/);
});


test("AI studio contract rejects a mismatched market locale", () => {
  const result = validResult();
  result.localizedListings[1].locale = "en-PH";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /en-SG/);
});

test("AI studio contract preserves classification status across locales", () => {
  const result = validResult();
  result.localizedListings[1].classification.isHealthFunctionalFood = true;
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /마스터 상품 분류와 일치/);
});

test("AI studio contract rejects Korean residue in localized listings", () => {
  const result = validResult();
  result.localizedListings[1].description += " 한국어 문장";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /한국어/);
});

test("AI studio contract validates the expected script in every localized detail field", () => {
  const result = validResult();
  result.localizedListings[0].detailSections[0].body = "This English-only detail body is deliberately long enough to satisfy the structural minimum while violating the Japanese locale requirement for this individual field.";
  const detailParsed = cliStudioResultSchema.safeParse(result);
  assert.equal(detailParsed.success, false);
  assert.ok(detailParsed.error?.issues.some((issue) => issue.path.join(".") === "localizedListings.0.detailSections.0.body"));

  const coreResult = validResult();
  coreResult.localizedListings[0].shortDescription = "English-only marketplace summary";
  const coreParsed = cliStudioResultSchema.safeParse(coreResult);
  assert.equal(coreParsed.success, false);
  assert.ok(coreParsed.error?.issues.some((issue) => issue.path.join(".") === "localizedListings.0.shortDescription"));
});

test("Latin-script locales validate distinctive language signals across the whole listing", () => {
  const shortAsciiFields = validResult();
  for (const index of [4, 7, 8]) {
    shortAsciiFields.localizedListings[index].thumbnailAltText = "ACV package front view";
    shortAsciiFields.localizedListings[index].detailSections[0].imageAltText = "ACV package overview";
  }
  const shortAsciiParsed = cliStudioResultSchema.safeParse(shortAsciiFields);
  if (!shortAsciiParsed.success) assert.fail(JSON.stringify(shortAsciiParsed.error.issues, null, 2));

  for (const index of [4, 7, 8]) {
    const englishOnly = validResult();
    const listing = englishOnly.localizedListings[index];
    listing.title = "White ceramic espresso cup";
    listing.shortDescription = "White ceramic espresso cup for a simple home coffee routine.";
    listing.description = "A white ceramic espresso cup shown as one item for a simple home coffee routine.";
    listing.keywords = ["white ceramic espresso cup", "home coffee cup", "single cup"];
    listing.thumbnailAltText = "White ceramic espresso cup";
    listing.classification.displayName = "Ceramic drinkware";
    listing.classification.evidence = "The seller-supplied product views show a single handled ceramic drinking vessel.";
    listing.detailSections.forEach((section, sectionIndex) => {
      section.buyerQuestion = `What should the buyer check in section ${sectionIndex + 1}?`;
      section.evidence = `Seller-supplied product evidence for section ${sectionIndex + 1}.`;
      section.heading = `Buyer detail ${sectionIndex + 1}`;
      section.body = `This English-only section ${sectionIndex + 1} describes a visible product detail without adding unsupported claims. Buyers should check the seller-supplied evidence before purchase.`;
      section.imageAltText = `White ceramic cup detail ${sectionIndex + 1}`;
    });

    const parsed = cliStudioResultSchema.safeParse(englishOnly);
    assert.equal(parsed.success, false);
    assert.ok(parsed.error?.issues.some((issue) => (
      issue.path.join(".") === `localizedListings.${index}`
      && /현지화 전체/.test(issue.message)
    )));
  }
});

test("AI studio contract rejects duplicated localized detail image roles", () => {
  const result = validResult();
  result.localizedListings[1].detailSections[1].imageAsset = "detail-overview";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /중복 없이 8개/);
});

test("AI studio contract rejects disconnected keyword stuffing", () => {
  const result = validResult();
  result.localizedListings[1].keywords = ["unrelated alpha", "unrelated beta", "unrelated gamma"];
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /자연스럽게 포함/);
});

test("general-food contract rejects invented efficacy and intake directions without exact label evidence", () => {
  const efficacy = validResult();
  efficacy.product.category = "일반식품";
  efficacy.product.classification = {
    displayName: "일반식품",
    verificationStatus: "verified",
    evidence: "후면 표시사항에서 일반식품 분류를 확인했습니다.",
    isHealthFunctionalFood: false,
  };
  efficacy.design.sections[0].body += " 이 상품은 면역력 개선과 혈당 조절에 도움을 줍니다.";
  const efficacyParsed = cliStudioResultSchema.safeParse(efficacy);
  assert.equal(efficacyParsed.success, false);
  assert.match(efficacyParsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /효능/);

  const dosage = validResult();
  dosage.product.category = "일반식품";
  dosage.product.classification = { ...efficacy.product.classification };
  dosage.design.sections[2].body += " 하루 2포를 매일 섭취하세요.";
  const dosageParsed = cliStudioResultSchema.safeParse(dosage);
  assert.equal(dosageParsed.success, false);
  assert.match(dosageParsed.error?.issues.map((issue) => issue.message).join("\n") ?? "", /섭취량/);
});

test("general-food contract accepts an exact label-backed intake amount and an explicit no-efficacy statement", () => {
  const result = validResult();
  result.product.category = "일반식품";
  result.product.classification = {
    displayName: "일반식품",
    verificationStatus: "verified",
    evidence: "후면 표시사항에서 일반식품 분류를 확인했습니다.",
    isHealthFunctionalFood: false,
  };
  result.design.sections[2].body += " 후면 라벨에 적힌 섭취방법은 하루 1회 30 g입니다.";
  result.design.sections[2].evidence += " 후면 라벨의 섭취방법에 하루 1회 30 g으로 표시되어 있습니다.";
  result.design.sections[11].body += " 이 문구는 면역력을 개선하거나 질병을 예방한다고 표현하지 않습니다.";
  const parsed = cliStudioResultSchema.safeParse(result);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("general-food guard also rejects invented efficacy inside a localized section", () => {
  const result = validResult();
  result.product.category = "General food";
  result.product.classification = {
    displayName: "General food",
    verificationStatus: "verified",
    evidence: "The supplied rear label identifies the product as a general food.",
    isHealthFunctionalFood: false,
  };
  result.localizedListings[1].detailSections[0].body += " This food improves immunity and lowers blood sugar.";
  const parsed = cliStudioResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  assert.ok(parsed.error?.issues.some((issue) => issue.path.join(".").startsWith("localizedListings.1.detailSections.0")));
});
test("AI studio warning limits are normalized deterministically before terminal validation", () => {
  const result = validResult();
  result.warnings = ["  " + "경".repeat(450) + "  ", "   ", "두 번째 경고", "세 번째 경고", "네 번째 경고", "다섯 번째 경고", "여섯 번째 경고"];
  const normalized = normalizeStudioWarningLimits(result) as ReturnType<typeof validResult>;
  assert.equal(normalized.warnings.length, 5);
  assert.equal(normalized.warnings[0].length, 400);
  assert.equal(normalized.warnings[0].startsWith("경"), true);
  assert.equal(normalized.warnings.includes(""), false);
  const parsed = cliStudioResultSchema.safeParse(normalized);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio warning truncation never leaves an unpaired UTF-16 surrogate", () => {
  const result = validResult();
  result.warnings = [`${"가".repeat(399)}😀뒤`];
  const normalized = normalizeStudioWarningLimits(result) as ReturnType<typeof validResult>;
  assert.equal(normalized.warnings[0].length, 399);
  assert.doesNotMatch(normalized.warnings[0], /[\uD800-\uDBFF]$/);
  const parsed = cliStudioResultSchema.safeParse(normalized);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio keyword coverage repair derives only a bounded phrase from the existing localized title", () => {
  const result = validResult();
  const disconnectedListings = new Map<string, { title: string; keywordCount: number }>([
    ["AU", { title: "Sajo Mild Tuna Chunks in a Convenient Pantry Pack for Everyday Family Meals and Quick Recipes 😀", keywordCount: 3 }],
    ["CA", { title: "Sajo Mild Tuna Chunks Pantry Pack", keywordCount: 3 }],
    ["FR", { title: "Thon Sajo léger en boîte pratique", keywordCount: 10 }],
    ["IT", { title: "Bocconcini di tonno delicato Sajo in confezione pratica", keywordCount: 10 }],
  ]);
  for (const [market, { title, keywordCount }] of disconnectedListings) {
    const listing = result.localizedListings.find((item) => item.channel === "ebay" && item.market === market);
    assert.ok(listing);
    listing.title = title;
    listing.shortDescription = "A concise localized product summary.";
    listing.description = "Use only the confirmed pack information shown by the seller.";
    listing.keywords = Array.from({ length: keywordCount }, (_, index) => `disconnected term ${index}`);
  }

  const normalized = normalizeStudioLocalizedKeywordCoverage(result) as ReturnType<typeof validResult>;
  for (const [market, { title, keywordCount }] of disconnectedListings) {
    const repaired = normalized.localizedListings.find((item) => item.channel === "ebay" && item.market === market);
    assert.ok(repaired);
    const connectedKeyword = repaired.keywords.at(-1) ?? "";
    assert.ok(connectedKeyword.length > 0 && connectedKeyword.length <= 80);
    assert.equal(title.includes(connectedKeyword), true);
    assert.doesNotMatch(connectedKeyword, /[\uD800-\uDBFF]$/u);
    if (title.length > 80) assert.match(title.slice(connectedKeyword.length), /^\s/u);
    const retainedKeywordCount = Math.min(keywordCount, 9);
    assert.equal(repaired.keywords.length, Math.min(keywordCount + 1, 10));
    assert.deepEqual(repaired.keywords.slice(0, -1), Array.from({ length: retainedKeywordCount }, (_, index) => `disconnected term ${index}`));
  }
  const parsed = cliStudioResultSchema.safeParse(normalized);
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
  assert.strictEqual(normalizeStudioLocalizedKeywordCoverage(normalized), normalized);
});

test("AI studio keyword coverage repair leaves already connected localized copy unchanged", () => {
  const result = validResult();
  assert.strictEqual(normalizeStudioLocalizedKeywordCoverage(result), result);
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
    imageSpecs: [sourcePreservingImageSpec()],
  });
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));
});

test("AI studio request accepts only bounded verified same-product price evidence", () => {
  const base = {
    jobId: "11111111-1111-4111-8111-111111111111",
    manualFields: validRequiredIntake(),
    imagePaths: ["user/job/input/001.jpg"],
    imageSpecs: [sourcePreservingImageSpec()],
  };
  const competitorContext = {
    query: "화이트 도자기 에스프레소 컵",
    providerStatuses: [{ provider: "elevenst_product_search", status: "searched", count: 1, marketplaces: ["elevenst"] }],
    candidates: [{
      provider: "elevenst_product_search",
      marketplace: "elevenst",
      externalId: "12345",
      title: "화이트 도자기 에스프레소 컵 1개",
      url: "https://www.11st.co.kr/products/12345",
      mallName: "11번가 판매자",
      price: 12_900,
      currency: "KRW",
      verifiedSameProduct: true,
    }],
  } as const;
  assert.equal(studioJobRequestSchema.safeParse({ ...base, competitorContext }).success, true);
  assert.equal(studioJobRequestSchema.safeParse({
    ...base,
    competitorContext: {
      ...competitorContext,
      candidates: [{ ...competitorContext.candidates[0], verifiedSameProduct: false }],
    },
  }).success, false);
  assert.equal(studioJobRequestSchema.safeParse({
    ...base,
    competitorContext: { ...competitorContext, query: "<script>not evidence</script>" },
  }).success, false);
});

test("AI studio request canonicalizes HTTP 11st evidence before the second stage", () => {
  const url = canonicalizeStudioCompetitorUrl({
    provider: "elevenst_product_search",
    marketplace: "elevenst",
    url: "http://ignored:secret@www.11st.co.kr/products/654321?prdNo=654321#offer",
  });
  assert.equal(url, "https://www.11st.co.kr/products/654321?prdNo=654321");

  const parsed = studioJobRequestSchema.safeParse({
    jobId: "22222222-2222-4222-8222-222222222222",
    manualFields: validRequiredIntake(),
    imagePaths: ["user/job/input/001.jpg"],
    imageSpecs: [sourcePreservingImageSpec()],
    competitorContext: {
      query: "롯데샌드 파인애플 315g",
      providerStatuses: [{ provider: "elevenst_product_search", status: "searched", count: 1, marketplaces: ["elevenst"] }],
      candidates: [{
        provider: "elevenst_product_search",
        marketplace: "elevenst",
        externalId: "654321",
        title: "롯데샌드 파인애플 315g",
        url,
        mallName: "11번가 판매자",
        price: 3_900,
        currency: "KRW",
        verifiedSameProduct: true,
      }],
    },
  });
  if (!parsed.success) assert.fail(JSON.stringify(parsed.error.issues, null, 2));

  assert.equal(canonicalizeStudioCompetitorUrl({
    provider: "elevenst_product_search",
    marketplace: "elevenst",
    url: "http://www.11st.co.kr.evil.example/products/654321",
  }), "");
  assert.equal(canonicalizeStudioCompetitorUrl({
    provider: "ebay_browse",
    marketplace: "ebay",
    url: "http://www.ebay.com/itm/654321",
  }), "");
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
    imageSpecs: [sourcePreservingImageSpec({ originalWidth: 1200, originalHeight: 1200, bytes: 350_000 })],
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
  const assetStoragePaths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [asset.id, aiGeneratedAssetPath(jobId, asset, CLAIM_TOKEN)]));
  const complete = workerCompletionSchema.safeParse({ jobId, claimToken: CLAIM_TOKEN, status: "succeeded", result: validResult(), assetStoragePaths });
  if (!complete.success) assert.fail(JSON.stringify(complete.error.issues, null, 2));

  const incompletePaths = { ...assetStoragePaths };
  delete incompletePaths["detail-package"];
  assert.equal(workerCompletionSchema.safeParse({ jobId, claimToken: CLAIM_TOKEN, status: "succeeded", result: validResult(), assetStoragePaths: incompletePaths }).success, false);
  assert.equal(aiGeneratedAssetSpecs.filter((asset) => asset.role === "detail").length, 12);
});

test("AI worker completion accepts a product research result without generated images", () => {
  const complete = workerCompletionSchema.safeParse({
    jobId: "22222222-2222-4222-8222-222222222222",
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: validResearchResult(),
  });
  if (!complete.success) assert.fail(JSON.stringify(complete.error.issues, null, 2));
});

test("AI worker completion accepts exactly the regenerated image path", () => {
  const jobId = "33333333-3333-4333-8333-333333333333";
  const completion = workerCompletionSchema.safeParse({
    jobId,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      mode: "asset-regeneration",
      assetId: "detail-use",
      sourceJobId: "11111111-1111-4111-8111-111111111111",
      sourceProductId: "22222222-2222-4222-8222-222222222222",
    },
    assetStoragePaths: {
      "detail-use": aiGeneratedAssetPath(jobId, aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-use")!, CLAIM_TOKEN),
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
  assert.equal(supportReplyWorkerRequestSchema.safeParse({
    ticket_id: "55555555-5555-4555-8555-555555555555",
    channel: "lazada",
    target_locale: "ja-JP",
    tone: "polite",
    subject: "Delivery status",
    message: "Please confirm the current delivery status.",
    order: {
      external_order_id: "ORDER-1",
      product_name: "Test product",
      quantity: 1,
      status: "paid",
      ordered_at: "2026-08-25T10:00:00+00:00",
      shipped_at: null,
    },
  }).success, true);
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
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result,
  }).success, true);
});
