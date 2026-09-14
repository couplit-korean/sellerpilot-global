import assert from "node:assert/strict";
import test from "node:test";
import { ebayInventoryDescription, ebayInventoryDescriptionMatches } from "../lib/channels/ebay-inventory-description";
import { upsertMarketplaceDetailImages } from "../lib/channels/marketplace-images";
import { buildLocalizedRichDetail, type LocalizedCreativeListing } from "../lib/marketplace-localized-content";

function annotatedListing(): LocalizedCreativeListing {
  const types = ["overview", "feature", "howto", "spec", "routine", "contents", "care", "proof"] as const;
  const roles = ["detail-overview", "detail-feature", "detail-use", "detail-dimensions", "detail-routine", "detail-contents", "detail-care", "detail-package"] as const;
  return {
    title: "Fixture carbonated drink 500 ml single bottle",
    shortDescription: "One bottle. Keep the original label for ingredient details.",
    description: "No health benefit is claimed. The complete allergen statement must be checked on the label.",
    keywords: [], locale: "en-US",
    classification: { displayName: "Carbonated soft drink", verificationStatus: "verified", isHealthFunctionalFood: false, evidence: "Classification follows the original food-type label." },
    detailSections: types.map((type, index) => ({
      type, imageAsset: roles[index], heading: `Section ${index + 1}`,
      body: `Product fact ${index + 1}: one 500 ml bottle, sodium 90 mg. Ingredients include water and carbon dioxide. Refrigerate after opening. The full ingredients and allergens require the original label.`,
      buyerQuestion: `EDITORIAL QUESTION ${index + 1}: ${"Which supplied photo explains this product detail? ".repeat(3)}`,
      evidence: `PHOTO PROVENANCE ${index + 1}: ${"The source photograph and confirmed seller field support the corresponding product paragraph. ".repeat(3)}`,
      imageAltText: `Bottle label view ${index + 1}`,
    })),
  };
}

test("long generated details omit only marked editorial annotations from Inventory and preserve the full Offer", () => {
  const listing = annotatedListing();
  const html = buildLocalizedRichDetail(listing, listing.title, listing.description);
  const urls = Array.from({ length: 8 }, (_, i) => `https://images.example/${i}.jpg`);
  const offer = upsertMarketplaceDetailImages(html, urls, [], listing.detailSections!.map(section => section.imageAsset));
  const originalOffer = offer;
  const inventory = ebayInventoryDescription(offer);
  assert.ok(inventory.length <= 4000);
  assert.ok(inventory.includes(listing.title));
  assert.ok(inventory.includes(listing.shortDescription));
  assert.ok(inventory.includes(listing.description));
  assert.ok(inventory.includes(listing.classification!.evidence));
  for (const section of listing.detailSections!) {
    assert.ok(inventory.includes(section.heading));
    assert.ok(inventory.includes(section.body), `must preserve complete ${section.type} facts`);
    assert.ok(offer.includes(section.buyerQuestion!.trim()));
    assert.ok(offer.includes(section.evidence!.trim()));
  }
  assert.doesNotMatch(inventory, /EDITORIAL QUESTION|PHOTO PROVENANCE/);
  assert.equal(offer, originalOffer);
  assert.equal((offer.match(/<img\b/gu) ?? []).length, 8);
  assert.equal(ebayInventoryDescriptionMatches(inventory, offer), true);
  assert.equal(ebayInventoryDescriptionMatches(inventory.replace("sodium 90 mg", "sodium 0 mg"), offer), false);
  assert.equal(ebayInventoryDescription(html), inventory);
});

test("annotation reduction cannot truncate oversized facts or apply to unmarked/incomplete documents", () => {
  const listing = annotatedListing();
  const html = buildLocalizedRichDetail(listing, listing.title, listing.description);
  assert.throws(() => ebayInventoryDescription(html.replace('data-sellerpilot-localized-detail="true"', 'data-other="true"')), /TOO_LONG/);
  assert.throws(() => ebayInventoryDescription(html.replace('data-sellerpilot-section-count="8"', 'data-sellerpilot-section-count="7"')), /TOO_LONG/);
  listing.detailSections![0].body = "Ingredient warning: " + "complete factual text ".repeat(210);
  assert.throws(() => ebayInventoryDescription(buildLocalizedRichDetail(listing, listing.title, listing.description)), /TOO_LONG/);
});

test("eight expanded transport images do not consume the Inventory description limit", () => {
  const facts = "Narangd Cider Zero 500ml. One bottle. Ingredients: purified water, carbon dioxide. Store away from direct sunlight.";
  const source = `<h2>Narangd</h2><p>${facts}</p>{{SELLERPILOT_IMAGE:detail-overview}}`;
  const urls = Array.from({ length: 8 }, (_, i) => `https://images.example/${i}.jpg?signature=${"a".repeat(800)}`);
  const offerHtml = upsertMarketplaceDetailImages(source, urls, [], ["detail-overview"]);
  assert.ok(offerHtml.length > 4000);
  const inventory = ebayInventoryDescription(offerHtml);
  assert.equal(inventory, `Narangd ${facts}`);
  assert.equal(ebayInventoryDescriptionMatches(inventory, offerHtml), true);
  assert.equal(ebayInventoryDescriptionMatches(`${inventory} altered`, offerHtml), false);
  assert.equal((offerHtml.match(/<img\b/gu) ?? []).length, 8);
  assert.equal(ebayInventoryDescription(source), inventory);
});

test("keeps Unicode and factual entities, ignores image attributes and script/style text", () => {
  const html = '<style>.x { content: "fake" }</style><script>fake facts()</script><!-- hidden -->'
    + '<p>사이다 &amp; 물 &#x1F34B; &#8209; 500ml&nbsp;1병 &quot;제로&quot; &#39;무설탕&#39;</p>'
    + '<img src="https://example.test/long" alt="not product facts > text"><p>A &lt; B</p>';
  assert.equal(ebayInventoryDescription(html), '사이다 & 물 🍋 ‑ 500ml 1병 "제로" \'무설탕\' A < B');
});

test("rejects empty and oversized factual text without truncating facts", () => {
  assert.throws(() => ebayInventoryDescription('<img src="x"><script>fake</script>'), /EMPTY/);
  assert.equal(ebayInventoryDescription("가".repeat(4000)).length, 4000);
  assert.throws(() => ebayInventoryDescription("가".repeat(4001)), /TOO_LONG/);
  assert.throws(() => ebayInventoryDescription("🍋".repeat(2001)), /TOO_LONG/);
  assert.equal(ebayInventoryDescriptionMatches("", "<style>fake</style>"), false);
});
