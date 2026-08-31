import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  ebayExactExistingQaRecoveryArgument,
  ebayExactExistingQaRecoveryIdentity,
} from "../lib/channels/ebay-exact-existing-qa-recovery";

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

test("exact eBay UPDATE discovers the offer by SKU, finishes all GET preflights, then crosses the mutation fence", async () => {
  const originalFetch = globalThis.fetch;
  const exactSku = ebayExactExistingQaRecoveryIdentity.marketplaceSku;
  const exactOfferId = ebayExactExistingQaRecoveryIdentity.offerId;
  const stock = 7;
  const events: string[] = [];
  let wroteInventory = false;
  let wroteOffer = false;
  const exactHtml = detailHtml("This durable adhesive cable organizer keeps charging cords tidy and easy to reach");
  const exactImages = ["https://cdn.example.com/qa-main.jpg"];
  const exactArguments = {
    listingId,
    sku: exactSku,
    marketplaceId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    [ebayExactExistingQaRecoveryArgument]: {
      contract: "ebay_exact_existing_qa_recovery_v2",
      phase: "listing.update",
      productId: ebayExactExistingQaRecoveryIdentity.productId,
      listingId: ebayExactExistingQaRecoveryIdentity.listingId,
      sourceAttemptId: ebayExactExistingQaRecoveryIdentity.sourceAttemptId,
      publicListingId: listingId,
      market: "US",
      marketplaceId,
      marketplaceSku: exactSku,
      offerId: exactOfferId,
      currency: "USD",
      priceUsd: 12.9,
      stock,
      credentialId: ebayExactExistingQaRecoveryIdentity.credentialId,
      sellerAccountKey: ebayExactExistingQaRecoveryIdentity.sellerAccountKey,
      offerIdSource: "immutable_lineage_attestation_v1",
      sellerAccountLineage: "validated_by_service_rpc",
    },
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: stock } },
      product: {
        title: "Adhesive Cable Organizer Clips",
        description: exactHtml,
        imageUrls: exactImages,
        aspects: { Type: ["Cable Clip"] },
        brand: "Unbranded",
        mpn: "QA-CC-001",
      },
    },
    offer: {
      availableQuantity: stock,
      listingDescription: exactHtml,
      pricingSummary: { price: { currency: "USD", value: 12.9 } },
    },
  };
  const providerOffer = () => ({
    ...currentOffer({
      offerId: exactOfferId,
      sku: exactSku,
      ...(wroteOffer
        ? {
            availableQuantity: stock,
            pricingSummary: { price: { currency: "USD", value: 12.9 } },
            listingDescription: exactHtml,
          }
        : {}),
    }),
  });
  const providerInventory = () => wroteInventory
    ? {
        ...currentInventory(),
        condition: "NEW",
        availability: { shipToLocationAvailability: { quantity: stock } },
        product: {
          title: "Adhesive Cable Organizer Clips",
          description: exactHtml,
          imageUrls: exactImages,
          aspects: { Type: ["Cable Clip"] },
          brand: "Unbranded",
          mpn: "QA-CC-001",
        },
      }
    : currentInventory();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("/offer?") && url.includes(`sku=${exactSku}`)) {
      events.push("GET:offer-discovery");
      return Response.json({ offers: [providerOffer()] });
    }
    if (method === "GET" && url.endsWith(`/offer/${exactOfferId}`)) {
      events.push("GET:offer");
      return Response.json(providerOffer());
    }
    if (method === "GET" && url.endsWith(`/inventory_item/${exactSku}`)) {
      events.push("GET:inventory");
      return Response.json(providerInventory());
    }
    if (method === "PUT" && url.endsWith(`/inventory_item/${exactSku}`)) {
      events.push("PUT:inventory");
      wroteInventory = true;
      return new Response(null, { status: 204 });
    }
    if (method === "PUT" && url.endsWith(`/offer/${exactOfferId}`)) {
      events.push("PUT:offer");
      wroteOffer = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected eBay exact QA request: ${method} ${url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.update",
      payload: { access_token: "secret", marketplace_id: marketplaceId },
      arguments: exactArguments,
      environment: "production",
      providerMutationHooks: {
        assertLeaseHealthy: async () => { events.push("lease"); },
        begin: async () => { events.push("mutation-fence"); },
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      "GET:offer-discovery",
      "GET:offer",
      "GET:inventory",
      "lease",
      "mutation-fence",
      "lease",
      "PUT:inventory",
      "PUT:offer",
      "GET:offer",
      "GET:inventory",
    ]);
    assert.equal(
      result.steps.find((item) => item.name === "listing-update-content-readback")?.ok,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact eBay UPDATE performs zero writes for missing, mismatched, or duplicate bound-offer discovery", async () => {
  const originalFetch = globalThis.fetch;
  const exactSku = ebayExactExistingQaRecoveryIdentity.marketplaceSku;
  const marker = {
    contract: "ebay_exact_existing_qa_recovery_v2",
    phase: "listing.update",
    productId: ebayExactExistingQaRecoveryIdentity.productId,
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    sourceAttemptId: ebayExactExistingQaRecoveryIdentity.sourceAttemptId,
    publicListingId: listingId,
    market: "US",
    marketplaceId,
    marketplaceSku: exactSku,
    offerId: ebayExactExistingQaRecoveryIdentity.offerId,
    currency: "USD",
    priceUsd: 12.9,
    stock: 7,
    credentialId: ebayExactExistingQaRecoveryIdentity.credentialId,
    sellerAccountKey: ebayExactExistingQaRecoveryIdentity.sellerAccountKey,
    offerIdSource: "immutable_lineage_attestation_v1",
    sellerAccountLineage: "validated_by_service_rpc",
  };
  const html = detailHtml("This durable adhesive cable organizer keeps charging cords tidy and easy to reach");
  const exactCandidate = (candidateOfferId: unknown, includeOfferId = true) => {
    const candidate: Record<string, unknown> = currentOffer({
      offerId: candidateOfferId,
      sku: exactSku,
    });
    if (!includeOfferId) delete candidate.offerId;
    return candidate;
  };
  const discoveryCases = [
    { name: "zero", offers: [] },
    { name: "inventory-api-404", offers: [], status: 404 },
    { name: "different", offers: [exactCandidate("244042196012")] },
    { name: "null", offers: [exactCandidate(null)] },
    { name: "missing", offers: [exactCandidate(undefined, false)] },
    {
      name: "duplicate",
      offers: [
        exactCandidate(ebayExactExistingQaRecoveryIdentity.offerId),
        exactCandidate(ebayExactExistingQaRecoveryIdentity.offerId),
      ],
    },
    {
      name: "mixed-exact-and-different",
      offers: [
        exactCandidate(ebayExactExistingQaRecoveryIdentity.offerId),
        exactCandidate("244042196012"),
      ],
    },
  ];
  try {
    for (const discoveryCase of discoveryCases) {
      const events: string[] = [];
      globalThis.fetch = async (input, init) => {
        events.push(`${init?.method ?? "GET"}:${String(input)}`);
        return Response.json(
          { offers: discoveryCase.offers },
          { status: discoveryCase.status ?? 200 },
        );
      };
      const result = await executeChannelOperation({
        channel: "ebay",
        operation: "listing.update",
        payload: { access_token: "secret", marketplace_id: marketplaceId },
        arguments: {
          listingId,
          sku: exactSku,
          marketplaceId,
          publicationIntent: "live",
          publicationStateContract: "verified_remote_state_v1",
          publicationExpectedLocale: "en-US",
          publicationExpectedImageCount: 8,
          [ebayExactExistingQaRecoveryArgument]: marker,
          inventoryItem: {
            condition: "NEW",
            availability: { shipToLocationAvailability: { quantity: 7 } },
            product: {
              title: "Adhesive Cable Organizer Clips",
              description: html,
              imageUrls: ["https://cdn.example.com/qa-main.jpg"],
            },
          },
          offer: {
            availableQuantity: 7,
            listingDescription: html,
            pricingSummary: { price: { currency: "USD", value: 12.9 } },
          },
        },
        environment: "production",
        providerMutationHooks: {
          assertLeaseHealthy: async () => { events.push("lease"); },
          begin: async () => { events.push("mutation-fence"); },
        },
      });
      assert.equal(result.ok, false, discoveryCase.name);
      assert.equal(events.length, 1, discoveryCase.name);
      assert.equal(events[0].startsWith("GET:"), true, discoveryCase.name);
      assert.equal(events.includes("mutation-fence"), false, discoveryCase.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
