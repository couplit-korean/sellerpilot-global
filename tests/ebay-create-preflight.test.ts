import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { ebayInventorySkuAbsent, ebayExactReconciliationOffer } from "../lib/channels/ebay-create-preflight";
import type { RemoteResponse } from "../lib/channels/protocols";

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return { data, text: JSON.stringify(data), response: Response.json(data, { status }) };
}
const missing = { errors: [{ errorId: 25710, domain: "API_INVENTORY" }] };
const sku = "한글 / SKU+1";
function args() {
  return {
    sku, publish: true,
    inventoryItem: { condition: "NEW", availability: { shipToLocationAvailability: { quantity: 2 } },
      product: { title: "Verified item", description: "Product description", imageUrls: ["https://cdn.example.com/item.jpg"] } },
    offer: { sku: "stale-sku", marketplaceId: "EBAY_US", format: "FIXED_PRICE", categoryId: "1234",
      listingDescription: "Description", availableQuantity: 2, pricingSummary: { price: { value: "29.50", currency: "USD" } },
      merchantLocationKey: "warehouse", listingPolicies: { fulfillmentPolicyId: "f1", paymentPolicyId: "p1", returnPolicyId: "r1" } },
  };
}
const exactOffer = { offerId: "offer-1", sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE" };

test("eBay inventory absence requires a documented Inventory error, not an HTTP status", () => {
  for (const code of [25702, 25710]) for (const status of [400, 404]) {
    assert.equal(ebayInventorySkuAbsent(remote({ errors: [{ errorId: code, domain: "API_INVENTORY" }] }, status)), true);
  }
  for (const value of [remote({}, 404), remote(missing), remote({ errors: [] }, 404),
    remote({ errors: [{ errorId: 25710, domain: "ACCESS" }] }, 404),
    remote({ errors: [...missing.errors, { errorId: 1001, domain: "API_INVENTORY" }] }, 400)]) {
    assert.equal(ebayInventorySkuAbsent(value), false);
  }
});

for (const [name, data] of Object.entries({
  "wrong SKU": { total: 1, offers: [{ ...exactOffer, sku: "someone-else" }] },
  "wrong market": { total: 1, offers: [{ ...exactOffer, marketplaceId: "EBAY_DE" }] },
  "wrong format": { total: 1, offers: [{ ...exactOffer, format: "AUCTION" }] },
  "duplicate identity": { total: 2, offers: [exactOffer, { ...exactOffer, offerId: "offer-2" }] },
  "partial page": { total: 2, offers: [exactOffer] },
  "next page": { total: 1, offers: [exactOffer], next: "https://api.ebay.com/page2" },
  "missing count": { offers: [exactOffer] },
  "missing ID": { total: 1, offers: [{ ...exactOffer, offerId: "" }] },
})) {
  test(`eBay reconciliation rejects ${name}`, () => {
    assert.equal(ebayExactReconciliationOffer(remote(data), sku, "EBAY_US", "FIXED_PRICE"), null);
  });
}

test("eBay reconciliation requires exactly one matching offer in a complete result", () => {
  assert.equal(ebayExactReconciliationOffer(remote({ total: 1, offers: [exactOffer] }), sku, "EBAY_US", "FIXED_PRICE")?.offerId, "offer-1");
});

for (const [name, data, status] of [
  ["existing inventory", { sku }, 200], ["malformed absence", {}, 404], ["authentication error", {}, 401],
] as const) {
  test(`eBay create performs no write after ${name}`, async () => {
    const original = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = async (_url, init) => { methods.push(init?.method ?? "GET"); return Response.json(data, { status }); };
    try {
      const result = await executeChannelOperation({ channel: "ebay", operation: "listing.create",
        payload: { access_token: "fixture-token" }, arguments: args(), environment: "sandbox" });
      assert.equal(result.ok, false);
      assert.deepEqual(methods, ["GET"]);
    } finally { globalThis.fetch = original; }
  });
}

for (const scenario of ["normal", "dropped-response", "wrong-offer", "wrong-price", "wrong-inventory", "reconcile-mismatch"] as const) {
  test(`eBay create ${scenario}: exact identity and content before publication`, async () => {
    const original = globalThis.fetch;
    const calls: Array<{ path: string; method: string }> = [];
    let inventory: Record<string, unknown> | undefined;
    let offer: Record<string, unknown> = {};
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ path: url.pathname, method });
      if (url.pathname.includes("/inventory_item/")) {
        assert.equal(url.pathname.split("/").at(-1), encodeURIComponent(sku));
        if (method === "PUT") { inventory = JSON.parse(String(init?.body)); return new Response(null, { status: 204 }); }
        if (!inventory) return Response.json(missing, { status: 400 });
        return Response.json(scenario === "wrong-inventory" ? { ...inventory, condition: "USED_EXCELLENT" } : inventory);
      }
      if (url.pathname.endsWith("/offer") && method === "POST") {
        offer = JSON.parse(String(init?.body));
        assert.equal(offer.sku, sku);
        if (scenario === "dropped-response" || scenario === "reconcile-mismatch") throw new TypeError("network dropped after accept");
        return Response.json({ offerId: "offer-1" }, { status: 201 });
      }
      if (url.pathname.endsWith("/offer") && method === "GET") {
        assert.equal(url.searchParams.get("sku"), sku);
        return Response.json({ total: 1, offers: [{ ...exactOffer, ...(scenario === "reconcile-mismatch" ? { sku: "other" } : {}) }] });
      }
      if (url.pathname.endsWith("/offer/offer-1") && method === "GET") {
        return Response.json({ ...offer, offerId: "offer-1", status: "UNPUBLISHED",
          ...(scenario === "wrong-offer" ? { sku: "other" } : {}),
          ...(scenario === "wrong-price" ? { pricingSummary: { price: { value: "999", currency: "USD" } } } : {}),
        });
      }
      if (url.pathname.endsWith("/publish") && method === "POST") return Response.json({ listingId: "110000000001" });
      throw new Error(`Unexpected ${method} ${url.pathname}`);
    };
    try {
      const result = await executeChannelOperation({ channel: "ebay", operation: "listing.create",
        payload: { access_token: "fixture-token" }, arguments: args(), environment: "sandbox" });
      const expectedPublish = scenario === "normal" || scenario === "dropped-response";
      assert.equal(result.ok, expectedPublish);
      if (scenario === "reconcile-mismatch") assert.equal(result.remoteId, sku);
      assert.equal(calls.filter(call => call.path.endsWith("/offer") && call.method === "POST").length, 1);
      assert.equal(calls.filter(call => call.path.endsWith("/publish")).length, expectedPublish ? 1 : 0);
      assert.equal(calls.filter(call => call.path.includes("/offer/") && call.method === "PUT").length, 0);
    } finally { globalThis.fetch = original; }
  });
}
