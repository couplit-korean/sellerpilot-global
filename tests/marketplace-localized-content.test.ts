import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalizedPlainDetail,
  buildLocalizedRichDetail,
  detailAssetOrderForChannel,
  localizedImageSeo,
  type LocalizedCreativeListing,
} from "../lib/marketplace-localized-content";

const listing: LocalizedCreativeListing = {
  title: "Hydrating face cream 50 ml",
  shortDescription: "Daily face cream with a lightweight texture.",
  description: "A verified 50 ml cream for daily skincare routines.",
  keywords: ["face cream", "hydrating cream", "50 ml"],
  thumbnailAltText: "Front view of a 50 ml hydrating face cream jar",
  detailSections: [
    { type: "overview", heading: "Product overview", body: "See the jar and verified package.", imageAsset: "detail-overview", imageAltText: "Hydrating face cream jar overview" },
    { type: "feature", heading: "Visible texture", body: "A close view of the visible cream texture.", imageAsset: "detail-feature", imageAltText: "Close view of face cream texture" },
    { type: "howto", heading: "How to use", body: "Use as directed on the verified product label.", imageAsset: "detail-use", imageAltText: "Face cream shown in a skincare routine" },
    { type: "spec", heading: "Package details", body: "The package contains one 50 ml jar.", imageAsset: "detail-package", imageAltText: "One 50 ml face cream package" },
  ],
};

test("localized rich detail keeps text and image roles interleaved for marketplace rendering", () => {
  const html = buildLocalizedRichDetail(listing, "Fallback", "Fallback description");
  assert.match(html, /Hydrating face cream 50 ml/);
  assert.match(html, /\{\{SELLERPILOT_IMAGE:detail-overview\}\}/);
  assert.doesNotMatch(html, /data-sellerpilot-seo/);
  assert.doesNotMatch(html, /<script/i);
});

test("localized plain detail carries SEO title, sections and keywords to text-only channels", () => {
  const text = buildLocalizedPlainDetail(listing, "Fallback", "Fallback description");
  assert.match(text, /Product overview/);
  assert.doesNotMatch(text, /face cream · hydrating cream · 50 ml/);
});

test("channel image plans change order and preserve localized alt text", () => {
  assert.notDeepEqual(detailAssetOrderForChannel("shopee"), detailAssetOrderForChannel("ebay"));
  const plan = localizedImageSeo(listing, "ebay", "Fallback");
  assert.equal(plan.thumbnailAltText, listing.thumbnailAltText);
  assert.deepEqual(plan.detailImageRoles, ["detail-overview", "detail-package", "detail-feature", "detail-use"]);
  assert.equal(plan.detailImageAltTexts[1], "One 50 ml face cream package");
});

test("legacy localized listings still render without creative fields", () => {
  const legacy = { title: "Legacy title", shortDescription: "Legacy short", description: "Legacy description", keywords: ["legacy"] };
  assert.match(buildLocalizedRichDetail(legacy, "Fallback", "Fallback description"), /Legacy description/);
  assert.equal(localizedImageSeo(legacy, "qoo10", "Fallback").detailImageAltTexts.length, 4);
});
