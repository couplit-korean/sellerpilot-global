import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";

const listingId = "800551945442";
const offerId = "offer-immutable-1";
const sku = "SELLERPILOT-CABLE-CLIP-1";
const marketplaceId = "EBAY_US";
const fingerprint = "a".repeat(64);

function detailHtml(prefix = "updated") {
  return `<p>${prefix} cable clip detail</p>${Array.from(
    { length: 8 },
    (_, index) => `<img src="https://cdn.example.com/detail-${index + 1}.jpg">`,
  ).join("")}`;
}

function currentOffer(overrides: Record<string, unknown> = {}) {
  return {
    offerId,
    sku,
    marketplaceId,
    status: "PUBLISHED",
    format: "FIXED_PRICE",
    categoryId: "175673",
    merchantLocationKey: "seoul-warehouse",
    listingPolicies: {
      fulfillmentPolicyId: "fulfillment-policy",
      paymentPolicyId: "payment-policy",
      returnPolicyId: "return-policy",
    },
    pricingSummary: { price: { currency: "USD", value: "12.99" } },
    listingDescription: detailHtml("current"),
    listing: { listingId, listingStatus: "ACTIVE" },
    ...overrides,
  };
}

function currentInventory(overrides: Record<string, unknown> = {}) {
  return {
    availability: { shipToLocationAvailability: { quantity: 20 } },
    condition: "NEW",
    product: {
      title: "Current Cable Organizer Clips",
      description: "Current English description",
      imageUrls: ["https://cdn.example.com/current-main.jpg"],
      aspects: { Type: ["Cable Clip"] },
    },
    ...overrides,
  };
}

function updateArguments() {
  return {
    listingId,
    offerId,
    sku,
    marketplaceId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    inventoryItem: {
      product: {
        title: "Adhesive Cable Organizer Clips",
        description: "Keep charging cables tidy with compact adhesive clips.",
        imageUrls: ["https://cdn.example.com/updated-main.jpg"],
      },
    },
    offer: { listingDescription: detailHtml() },
  };
}

test("eBay UPDATE preserves the immutable tuple and full-replacement fields without create or publish", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  let wroteInventory = false;
  let wroteOffer = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method, url, ...(body ? { body } : {}) });
    if (method === "GET" && url.endsWith(`/offer/${offerId}`)) {
      return Response.json(wroteOffer
        ? currentOffer({ listingDescription: detailHtml() })
        : currentOffer());
    }
    if (method === "GET" && url.endsWith(`/inventory_item/${sku}`)) {
      return Response.json(wroteInventory
        ? currentInventory({
            product: {
              title: "Adhesive Cable Organizer Clips",
              description: "Keep charging cables tidy with compact adhesive clips.",
              imageUrls: ["https://cdn.example.com/updated-main.jpg"],
              aspects: { Type: ["Cable Clip"] },
            },
          })
        : currentInventory());
    }
    if (method === "PUT" && url.endsWith(`/inventory_item/${sku}`)) {
      wroteInventory = true;
      return new Response(null, { status: 204 });
    }
    if (method === "PUT" && url.endsWith(`/offer/${offerId}`)) {
      wroteOffer = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected eBay request: ${method} ${url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.update",
      payload: { access_token: "secret", marketplace_id: marketplaceId },
      arguments: updateArguments(),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, listingId);
    assert.deepEqual(result.remoteState?.resources, { offerId, listingId, sku, marketplaceId });
    assert.equal(
      result.steps.find((item) => item.name === "listing-update-content-readback")?.data.sellerpilotVerification,
      "LISTING_MUTABLE_FIELDS_VERIFIED",
    );
    assert.equal(calls.some((call) => call.method === "POST"), false);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "PUT", "PUT", "GET", "GET"]);

    const inventoryWrite = calls.find((call) => call.method === "PUT" && call.url.includes("/inventory_item/"));
    const offerWrite = calls.find((call) => call.method === "PUT" && call.url.includes(`/offer/${offerId}`));
    assert.deepEqual(inventoryWrite?.body?.availability, { shipToLocationAvailability: { quantity: 20 } });
    assert.equal(inventoryWrite?.body?.condition, "NEW");
    assert.equal((inventoryWrite?.body?.product as Record<string, unknown>).title, "Adhesive Cable Organizer Clips");
    assert.equal(offerWrite?.body?.categoryId, "175673");
    assert.deepEqual(offerWrite?.body?.pricingSummary, { price: { currency: "USD", value: "12.99" } });
    assert.deepEqual(offerWrite?.body?.listingPolicies, currentOffer().listingPolicies);
    assert.equal(offerWrite?.body?.merchantLocationKey, "seoul-warehouse");
    assert.equal(offerWrite?.body?.sku, sku);
    assert.equal(offerWrite?.body?.marketplaceId, marketplaceId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay UPDATE fails closed when the independent GET readback keeps stale content", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "PUT") return new Response(null, { status: 204 });
    if (url.includes("/inventory_item/")) return Response.json(currentInventory());
    return Response.json(currentOffer());
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.update",
      payload: { access_token: "secret", marketplace_id: marketplaceId },
      arguments: updateArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(methods, ["GET", "GET", "PUT", "PUT", "GET", "GET"]);
    const readback = result.steps.find((item) => item.name === "listing-update-content-readback");
    assert.equal(readback?.ok, false);
    assert.equal(readback?.data.sellerpilotVerification, "LISTING_MUTABLE_FIELDS_MISMATCH");
    assert.deepEqual(readback?.data.sellerpilotMismatchPaths, [
      "inventoryItem.product.title",
      "inventoryItem.product.description",
      "inventoryItem.product.imageUrls[0]",
      "offer.listingDescription.text",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay UPDATE performs zero writes when preflight listing identity mismatches", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method !== "GET") throw new Error("provider write must not be reached");
    if (url.includes("/inventory_item/")) return Response.json(currentInventory());
    return Response.json(currentOffer({ listing: { listingId: "wrong-listing", listingStatus: "ACTIVE" } }));
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.update",
      payload: { access_token: "secret", marketplace_id: marketplaceId },
      arguments: updateArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(methods, ["GET", "GET"]);
    assert.equal(result.steps[0]?.data.sellerpilotVerification, "EBAY_IMMUTABLE_LISTING_IDENTITY_MISMATCH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
