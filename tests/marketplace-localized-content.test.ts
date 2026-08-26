import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalizedBudgetedPlainDetail,
  buildLocalizedPlainDetail,
  buildLocalizedRichDetail,
  buildLocalizedSectionBulletPoints,
  detailAssetOrderForChannel,
  localizedImageSeo,
  type LocalizedCreativeListing,
} from "../lib/marketplace-localized-content";

const listing: LocalizedCreativeListing = {
  locale: "en-US",
  title: "Hydrating face cream 50 ml",
  shortDescription: "Daily face cream with a lightweight texture.",
  description: "A verified 50 ml cream for daily skincare routines.",
  keywords: ["face cream", "hydrating cream", "50 ml"],
  thumbnailAltText: "Front view of a 50 ml hydrating face cream jar",
  classification: {
    displayName: "Cosmetic face cream",
    verificationStatus: "verified",
    evidence: "The supplied front and label photographs identify the item as a cosmetic face cream.",
    isHealthFunctionalFood: false,
  },
  detailSections: [
    { type: "overview", buyerQuestion: "What is this product?", evidence: "The supplied front photograph shows one labelled face cream jar.", heading: "Product overview", body: "See the jar and verified package.", imageAsset: "detail-overview", imageAltText: "Hydrating face cream jar overview" },
    { type: "feature", buyerQuestion: "What texture is visible?", evidence: "The supplied detail photograph shows the visible cream texture.", heading: "Visible texture", body: "A close view of the visible cream texture.", imageAsset: "detail-feature", imageAltText: "Close view of face cream texture" },
    { type: "howto", buyerQuestion: "How should it be used?", evidence: "The supplied label contains the manufacturer's directions.", heading: "How to use", body: "Use as directed on the verified product label.", imageAsset: "detail-use", imageAltText: "Face cream shown in a skincare routine" },
    { type: "spec", buyerQuestion: "How much product is supplied?", evidence: "The package label states a net volume of 50 ml.", heading: "Package details", body: "The package contains one 50 ml jar.", imageAsset: "detail-package", imageAltText: "One 50 ml face cream package" },
    { type: "routine", buyerQuestion: "Where does it fit in a routine?", evidence: "The verified directions identify the applicable skincare step.", heading: "Routine placement", body: "Place it in the routine only as described on the label.", imageAsset: "detail-routine", imageAltText: "Face cream beside verified routine items" },
    { type: "contents", buyerQuestion: "What arrives in the package?", evidence: "The supplied contents photograph shows one jar and its retail carton.", heading: "Package contents", body: "The verified package contains one jar and one retail carton.", imageAsset: "detail-contents", imageAltText: "Verified contents of the face cream package" },
    { type: "care", buyerQuestion: "How should it be stored?", evidence: "The supplied label provides the storage caution.", heading: "Storage care", body: "Follow the storage directions printed on the verified label.", imageAsset: "detail-care", imageAltText: "Face cream stored according to its label" },
    { type: "proof", buyerQuestion: "Which claims are verified?", evidence: "Only the product identity, volume, directions, and visible package are supported by supplied evidence.", heading: "Verified claim boundary", body: "Claims remain limited to facts visible in the supplied evidence.", imageAsset: "detail-context", imageAltText: "Evidence-backed context for the face cream" },
  ],
};

const expandedListing: LocalizedCreativeListing = {
  ...listing,
  title: `TITLE-MUST-REMAIN ${"title ".repeat(30)}`,
  shortDescription: `SUMMARY-MUST-REMAIN ${"summary detail ".repeat(45)}`,
  description: `DESCRIPTION-MUST-REMAIN ${"verified product description ".repeat(90)}`,
  classification: {
    ...listing.classification!,
    displayName: `CLASSIFICATION-MUST-REMAIN ${"cosmetic ".repeat(20)}`,
    evidence: `CLASSIFICATION-EVIDENCE-MUST-REMAIN ${"supplied label evidence ".repeat(30)}`,
  },
  detailSections: listing.detailSections?.map((section, index) => ({
    ...section,
    buyerQuestion: `QUESTION-${index + 1}-MUST-REMAIN ${"buyer decision question ".repeat(12)}`,
    heading: `HEADING-${index + 1}-MUST-REMAIN ${"section heading ".repeat(8)}`,
    body: `BODY-${index + 1}-MUST-REMAIN ${"specific verified product information and claim boundary ".repeat(18)}`,
    evidence: `EVIDENCE-${index + 1}-MUST-REMAIN ${"input photograph and seller confirmed field ".repeat(14)}`,
  })),
};

test("localized rich detail keeps text and image roles interleaved for marketplace rendering", () => {
  const html = buildLocalizedRichDetail(listing, "Fallback", "Fallback description");
  assert.match(html, /Hydrating face cream 50 ml/);
  assert.match(html, /\{\{SELLERPILOT_IMAGE:detail-overview\}\}/);
  assert.match(html, /\{\{SELLERPILOT_IMAGE:detail-context\}\}/);
  assert.match(html, /data-sellerpilot-section-count="8"/);
  assert.match(html, /data-sellerpilot-buyer-question="true"/);
  assert.match(html, /Verification basis/);
  assert.match(html, /Cosmetic face cream/);
  assert.match(html, /Not verified as a health functional food/);
  assert.doesNotMatch(html, /data-sellerpilot-seo/);
  assert.doesNotMatch(html, /<script/i);
});

test("localized plain detail carries SEO title, sections and keywords to text-only channels", () => {
  const text = buildLocalizedPlainDetail(listing, "Fallback", "Fallback description");
  assert.match(text, /Product overview/);
  assert.match(text, /Buyer question: What is this product\?/);
  assert.match(text, /Verification basis: The supplied front photograph/);
  assert.match(text, /Product classification: Cosmetic face cream/);
  assert.doesNotMatch(text, /face cream · hydrating cream · 50 ml/);
});

test("channel image plans change order and preserve localized alt text", () => {
  assert.notDeepEqual(detailAssetOrderForChannel("shopee"), detailAssetOrderForChannel("ebay"));
  const plan = localizedImageSeo(listing, "ebay", "Fallback");
  assert.equal(plan.thumbnailAltText, listing.thumbnailAltText);
  assert.deepEqual(plan.detailImageRoles, ["detail-overview", "detail-context", "detail-package", "detail-feature", "detail-contents", "detail-use", "detail-care", "detail-routine"]);
  assert.equal(plan.detailImageAltTexts[2], "One 50 ml face cream package");
});

test("legacy localized listings still render without creative fields", () => {
  const legacy = { title: "Legacy title", shortDescription: "Legacy short", description: "Legacy description", keywords: ["legacy"] };
  assert.match(buildLocalizedRichDetail(legacy, "Fallback", "Fallback description"), /Legacy description/);
  assert.equal(localizedImageSeo(legacy, "qoo10", "Fallback").detailImageAltTexts.length, 8);
});

test("budgeted plain detail keeps classification and every section field within Shopee and Temu limits", () => {
  for (const maximum of [3_000, 10_000]) {
    const text = buildLocalizedBudgetedPlainDetail(expandedListing, "Fallback", "Fallback description", maximum);
    assert.ok(Array.from(text).length <= maximum);
    assert.match(text, /CLASSIFICATION-MUST-REMAIN/);
    assert.match(text, /CLASSIFICATION-EVIDENCE-MUST-REMAIN/);
    for (let index = 1; index <= 8; index += 1) {
      assert.match(text, new RegExp(`QUESTION-${index}-MUST-REMAIN`));
      assert.match(text, new RegExp(`HEADING-${index}-MUST-REMAIN`));
      assert.match(text, new RegExp(`BODY-${index}-MUST-REMAIN`));
      assert.match(text, new RegExp(`EVIDENCE-${index}-MUST-REMAIN`));
    }
  }
});

test("Temu bullet points preserve each section question, body and evidence under the per-point budget", () => {
  const bulletPoints = buildLocalizedSectionBulletPoints(expandedListing, 700);
  assert.equal(bulletPoints.length, 8);
  bulletPoints.forEach((point, index) => {
    assert.ok(Array.from(point).length <= 700);
    assert.match(point, new RegExp(`QUESTION-${index + 1}-MUST-REMAIN`));
    assert.match(point, new RegExp(`HEADING-${index + 1}-MUST-REMAIN`));
    assert.match(point, new RegExp(`BODY-${index + 1}-MUST-REMAIN`));
    assert.match(point, new RegExp(`EVIDENCE-${index + 1}-MUST-REMAIN`));
  });
});
