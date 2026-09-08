import assert from "node:assert/strict";
import test from "node:test";
import { lazadaCreateSkuChecks } from "../lib/channels/lazada-create-preflight";
import { temuCreateSkuChecks } from "../lib/channels/temu-create-preflight";
import { inspectListingDraft } from "../lib/channels/listing-preflight";
import { executeChannelOperation } from "../lib/channels/commerce-operations";
import { prepareMarketplaceListingArguments } from "../lib/channels/provider-listing-runtime";
import { shopeeGlobalCreateBody } from "../lib/channels/shopee-create-preflight";

function lazada() {
  return { publicationStateContract: "verified_remote_state_v1", publicationIntent: "live", request: { Request: { Product: { Skus: { Sku: ["A", "B"].map(SellerSku => ({
    SellerSku, price: "12.50", quantity: "1", package_content: "One item",
    package_weight: "0.1", package_length: "10", package_width: "8", package_height: "2",
  })) } } } } };
}
function temu() {
  return { publicationStateContract: "verified_remote_state_v1", publicationIntent: "live", body: {
    goodsBasic: { externalGoodsId: "PRODUCT-A" }, skuList: ["A", "B"].map(externalSkuId => ({
      externalSkuId, price: { basePrice: { amount: "5000", currency: "KRW" } }, quantity: 1,
      images: ["https://example.test/sku.jpg"], packageInfo: { weight: "100", length: "10", width: "8", height: "2" },
      variations: [{ name: "Color", value: externalSkuId }],
    })),
  } };
}

test("complete multi-SKU contracts pass without changing caller data", () => {
  const a = lazada(), b = temu(), before = JSON.stringify([a, b]);
  assert.ok(Object.values(lazadaCreateSkuChecks(a)).every(Boolean));
  assert.ok(Object.values(temuCreateSkuChecks(b.body)).every(Boolean));
  assert.equal(JSON.stringify([a, b]), before);
});

for (const channel of ["lazada", "temu"] as const) {
  test(`${channel}: a later SKU cannot reuse the first SKU identity`, () => {
    const draft = channel === "lazada" ? lazada() : temu();
    if ("request" in draft) draft.request.Request.Product.Skus.Sku[1].SellerSku = "A";
    else draft.body.skuList[1].externalSkuId = "A";
    assert.equal(inspectListingDraft(channel, draft).find(row => row.key === "sku")?.status, "manual");
  });
  for (const invalid of [-1, 0.5, null, true, "", Infinity]) {
    test(`${channel}: later SKU quantity ${String(invalid)} is blocked`, () => {
      const draft = channel === "lazada" ? lazada() : temu();
      const rows = "request" in draft ? draft.request.Request.Product.Skus.Sku : draft.body.skuList;
      Object.assign(rows[1], { quantity: invalid });
      assert.equal(inspectListingDraft(channel, draft).find(row => row.key === "stock")?.status, "manual");
    });
  }
  test(`${channel}: missing later packaging is blocked before any provider request`, async () => {
    const draft = channel === "lazada" ? lazada() : temu();
    if ("request" in draft) draft.request.Request.Product.Skus.Sku[1].package_weight = "";
    else draft.body.skuList[1].packageInfo.height = "";
    assert.equal(inspectListingDraft(channel, draft).find(row => row.key === "package")?.status, "manual");
    const originalFetch = globalThis.fetch;
    let calls = 0, mutations = 0;
    globalThis.fetch = async () => { calls++; throw Error("Unexpected provider request"); };
    try {
      const result = await executeChannelOperation({ channel, operation: "listing.create", environment: "production", payload: {}, arguments: draft });
      assert.equal(result.ok, false);
      assert.equal(result.steps[0].status, 422);
      await assert.rejects(prepareMarketplaceListingArguments({
        channel, operation: "listing.create", environment: "production", credential: {}, arguments: draft,
        signal: new AbortController().signal,
        hooks: { assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { mutations++; } },
      }), /CREATE_SKU_CONTRACT_INVALID/);
      assert.equal(calls, 0);
      assert.equal(mutations, 0);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("Temu requires image and specification data for every SKU", () => {
  const draft = temu();
  draft.body.skuList[1].images = [];
  draft.body.skuList[1].variations = [];
  const checks = temuCreateSkuChecks(draft.body);
  assert.equal(checks.images, false);
  assert.equal(checks.variations, false);
  assert.equal(inspectListingDraft("temu", draft).find(row => row.key === "variations")?.status, "manual");
});

test("Temu optional list price must exceed base price in the same currency", () => {
  const draft = temu();
  for (const listPrice of [{ amount: "5000", currency: "KRW" }, { amount: "6000", currency: "USD" }, { amount: "bad", currency: "KRW" }]) {
    Object.assign(draft.body.skuList[1].price, { listPrice });
    assert.equal(temuCreateSkuChecks(draft.body).price, false);
  }
  Object.assign(draft.body.skuList[1].price, { listPrice: { amount: "6000", currency: "KRW" } });
  assert.equal(temuCreateSkuChecks(draft.body).price, true);
});

test("documented zero inventory remains a valid integer; malformed prices never pass", () => {
  const a = lazada(), b = temu();
  a.request.Request.Product.Skus.Sku[1].quantity = "0";
  b.body.skuList[1].quantity = 0;
  assert.equal(lazadaCreateSkuChecks(a).stock, true);
  assert.equal(temuCreateSkuChecks(b.body).stock, true);
  for (const amount of ["Infinity", "-1", "", "5,000", "NaN"]) {
    a.request.Request.Product.Skus.Sku[1].price = amount;
    b.body.skuList[1].price.basePrice.amount = amount;
    assert.equal(lazadaCreateSkuChecks(a).price, false);
    assert.equal(temuCreateSkuChecks(b.body).price, false);
  }
});

test("Shopee removes the sunset stock field without mutating the source or changing inventory", () => {
  const legacy = { condition: "NEW", normal_stock: 3 };
  assert.deepEqual(shopeeGlobalCreateBody(legacy, true), { condition: "NEW", seller_stock: [{ stock: 3 }] });
  assert.equal(legacy.normal_stock, 3);
  const multi = { condition: "USED", normal_stock: 3, seller_stock: [{ location_id: "A", stock: 1 }, { location_id: "B", stock: 2 }] };
  assert.deepEqual(shopeeGlobalCreateBody(multi, true).seller_stock, multi.seller_stock);
  assert.throws(() => shopeeGlobalCreateBody({ ...multi, normal_stock: 4 }, true), /STOCK_CONFLICT/);
  assert.throws(() => shopeeGlobalCreateBody({ ...multi, seller_stock: [] }, true), /STOCK_INVALID/);
});

test("Shopee rejects missing or unsupported condition before global create reaches the provider", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("Unexpected provider request"); };
  try {
    for (const condition of [undefined, "REFURBISHED", "", "UNKNOWN"]) {
      await assert.rejects(executeChannelOperation({ channel: "shopee", operation: "listing.create", environment: "production", payload: {},
        arguments: { globalProduct: true, publicationStateContract: "verified_remote_state_v1", publicationIntent: "live", body: { condition }, publish: { shop_id: 1, item: {} } },
      }), /SHOPEE_CREATE_CONDITION_REQUIRED/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
