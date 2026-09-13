import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkbenchListingDraft } from "../app/product-publish-workbench";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";
import { marketplaceGlobalBasePriceMissing, marketplaceListingPrice } from "../lib/channels/listing-normalization";

const listing = { status: "published", remoteId: "123456789", publishedAt: "2026-09-14T00:00:00Z" };

test("foreign create drafts require a price while Qoo10 and Shopee content updates preserve provider pricing", () => {
  const unpriced = marketplaceListingPrice("qoo10", 3_000, { globalBaseUsdPrice: 0 });
  const qoo10 = { params: { ItemTitle: "商品", ItemDescription: "説明", ItemPrice: String(unpriced) } };
  const shopee = {
    shopId: "456",
    body: { original_price: unpriced },
    publish: { item: { item_name: "Product", description: "Description", original_price: unpriced } },
  };
  for (const [channel, draft] of [["qoo10", qoo10], ["shopee", shopee]] as const) {
    assert.equal(inspectWorkbenchListingDraft(channel, draft, "listing.create").find(item => item.key === "price")?.status, "manual");
    assert.equal(inspectWorkbenchListingDraft(channel, draft, "listing.update").find(item => item.key === "price")?.status, "runtime");
  }
  const qoo10Update = prepareListingUpdateArguments("qoo10", qoo10, listing);
  const shopeeUpdate = prepareListingUpdateArguments("shopee", shopee, listing);
  assert.equal(Object.hasOwn(qoo10Update.params as object, "ItemPrice"), false);
  assert.equal(Object.hasOwn(shopeeUpdate.body as object, "original_price"), false);
});

test("a restored positive eBay draft does not supply the required current USD base", () => {
  const restoredDraft = { offer: { pricingSummary: { price: { currency: "USD", value: "3000" } } } };
  // The draft itself is syntactically priced, so the independent base-price
  // guard is required in both single and bulk CREATE admission.
  assert.equal(inspectWorkbenchListingDraft("ebay", restoredDraft).find(item => item.key === "price")?.status, "ready");
  assert.equal(marketplaceGlobalBasePriceMissing("ebay", 0), true);
  assert.equal(marketplaceGlobalBasePriceMissing("ebay", 2.25), false);
});
