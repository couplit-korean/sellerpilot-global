import assert from "node:assert/strict";
import test from "node:test";
import { ebayInventoryDescription, ebayInventoryDescriptionMatches } from "../lib/channels/ebay-inventory-description";
import { upsertMarketplaceDetailImages } from "../lib/channels/marketplace-images";

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
