import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  assertEbayCreateRequiredFields,
  ebayCreateConfigurationEvidence,
  ebayCreateLineageDecision,
  ebayExactReconciliationOffer,
  ebayInventoryLocationEvidence,
  ebayInventorySkuAbsent,
} from "../lib/channels/ebay-create-preflight";
import type { RemoteResponse } from "../lib/channels/protocols";

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return { data, text: JSON.stringify(data), response: Response.json(data, { status }) };
}
const missing = { errors: [{ errorId: 25710, domain: "API_INVENTORY" }] };
const sku = "한글 / SKU+1";
function args() {
  return {
    sku, publish: true,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 0,
    inventoryItem: { condition: "NEW", availability: { shipToLocationAvailability: { quantity: 2 } },
      product: { title: "Verified item", description: "Product description", imageUrls: ["https://cdn.example.com/item.jpg"],
        aspects: { Color: ["Blue"] } } },
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

test("eBay create lineage branches only from complete exact Inventory and Offer reads", () => {
  const absent = remote(missing, 400);
  const inventory = remote({ sku });
  const none = remote({ total: 0, offers: [] });
  const one = remote({ total: 1, offers: [exactOffer] });
  assert.equal(ebayCreateLineageDecision({
    inventory: absent, offers: none, sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE",
  }).action, "create_inventory");
  assert.equal(ebayCreateLineageDecision({
    inventory, offers: none, sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE",
  }).action, "create_offer");
  assert.deepEqual(ebayCreateLineageDecision({
    inventory, offers: one, sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE",
  }), {
    action: "resume_offer",
    code: "EBAY_EXACT_OFFER_PRESENT",
    inventoryPresent: true,
    offerId: "offer-1",
  });
  assert.equal(ebayCreateLineageDecision({
    inventory, offers: remote({ offers: [] }), sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE",
  }).action, "blocked");
  assert.equal(ebayCreateLineageDecision({
    inventory,
    offers: remote({ total: 2, offers: [exactOffer, { ...exactOffer, offerId: "offer-2" }] }),
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
  }).code, "EBAY_OFFER_NOT_UNIQUE");
  assert.equal(ebayCreateLineageDecision({
    inventory: absent, offers: one, sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE",
  }).code, "EBAY_OFFER_WITHOUT_INVENTORY");
});

test("eBay required create fields reject KRW reuse and quantity drift before provider access", () => {
  const valid = args();
  valid.inventoryItem.condition = "NEW";
  valid.inventoryItem.product.aspects = {};
  assert.doesNotThrow(() => assertEbayCreateRequiredFields(valid));
  const invalid = args();
  invalid.inventoryItem.condition = "NEW";
  invalid.offer.pricingSummary.price = { value: "3190", currency: "KRW" };
  invalid.offer.availableQuantity = 3;
  assert.throws(
    () => assertEbayCreateRequiredFields(invalid),
    /offer\.availableQuantity,offer\.pricingSummary\.price\.currency/u,
  );
});

test("eBay required create fields reject partially malformed and duplicate images or aspects", () => {
  const malformed: Array<{ path: "imageUrls" | "aspects"; value: unknown }> = [
    { path: "imageUrls", value: ["https://cdn.example.com/item.jpg", null] },
    { path: "imageUrls", value: ["https://cdn.example.com/item.jpg", {}] },
    { path: "imageUrls", value: ["https://cdn.example.com/item.jpg", "https://cdn.example.com/item.jpg"] },
    { path: "aspects", value: { Color: ["Blue", null] } },
    { path: "aspects", value: { Color: ["Blue", "Blue"] } },
    { path: "aspects", value: { " Color ": ["Blue"] } },
    { path: "aspects", value: { Color: "Blue" } },
  ];
  for (const fixture of malformed) {
    const input = args();
    Object.assign(input.inventoryItem.product, { [fixture.path]: fixture.value });
    assert.throws(
      () => assertEbayCreateRequiredFields(input),
      fixture.path === "imageUrls"
        ? /inventoryItem\.product\.imageUrls/u
        : /inventoryItem\.product\.aspects/u,
    );
  }
});

test("eBay CREATE rejects missing or tampered publication contracts before provider access", async () => {
  for (const mutation of [
    { publicationStateContract: undefined },
    { publicationStateContract: "verified_remote_state_v0" },
    { publicationIntent: "preview" },
    { publicationExpectedFingerprint: "not-a-fingerprint" },
    { publicationExpectedLocale: "ko-KR" },
  ]) {
    const arguments_ = args();
    Object.assign(arguments_, mutation);
    let fetches = 0;
    let mutationFences = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error("provider access must not occur");
    };
    try {
      await assert.rejects(
        () => executeChannelOperation({
          channel: "ebay",
          operation: "listing.create",
          payload: { access_token: "fixture-token" },
          arguments: arguments_,
          environment: "sandbox",
          providerMutationHooks: {
            begin: async () => { mutationFences += 1; },
            assertLeaseHealthy: async () => { mutationFences += 1; },
          },
        }),
        /EBAY_CREATE_PUBLICATION_CONTRACT_INVALID/u,
      );
      assert.equal(fetches, 0);
      assert.equal(mutationFences, 0);
    } finally {
      globalThis.fetch = original;
    }
  }
});

test("eBay create configuration binds category-specific aspects, policies, return terms, location and USD", () => {
  const arguments_ = args();
  arguments_.inventoryItem.condition = "NEW";
  arguments_.inventoryItem.product.aspects = { Color: ["Blue"] };
  const locationRemote = remote({ total: 1, locations: [{
    merchantLocationKey: "warehouse",
    merchantLocationStatus: "ENABLED",
    location: { address: { country: "KR" } },
  }] });
  assert.equal(ebayInventoryLocationEvidence(locationRemote, "warehouse").ok, true);
  const evidence = ebayCreateConfigurationEvidence({
    arguments: arguments_,
    locationRemote,
    taxonomy: {
      marketplaceId: "EBAY_US",
      categoryId: "1234",
      categoryTreeId: "0",
      treeHttpStatus: 200,
      aspectsHttpStatus: 200,
      aspectsShapeVerified: true,
      aspectCount: 1,
      aspects: [{
        name: "Color",
        required: true,
        usage: "RECOMMENDED",
        expectedRequiredByDate: null,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        valueCount: 1,
        valuesSample: ["Blue"],
        values: [{ value: "Blue", constraints: [] }],
      }],
      requiredAspectNames: ["Color"],
      upcomingRequiredAspectNames: [],
      brandAspect: null,
      productAspect: null,
      brandProbeHits: [],
      productProbeHits: [],
      aspectProbeHits: { Color: ["Blue"] },
      conditionPolicyHttpStatus: 200,
      conditionPolicyCategoryTreeId: "0",
      conditionRequired: true,
      conditionIds: ["1000"],
      fulfillmentPolicy: { httpStatus: 200, ids: ["f1"], names: ["Ship"], marketplaceIds: ["EBAY_US"], exactId: "f1" },
      paymentPolicy: { httpStatus: 200, ids: ["p1"], names: ["Pay"], marketplaceIds: ["EBAY_US"], exactId: "p1" },
      returnPolicy: { httpStatus: 200, ids: ["r1"], names: ["Returns"], marketplaceIds: ["EBAY_US"], exactId: "r1" },
      returnPolicyDetails: [{
        id: "r1", name: "Returns", marketplaceId: "EBAY_US",
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
        returnMethod: null,
        internationalOverride: null,
      }],
    },
  });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.currency, "USD");
  assert.equal(evidence.returnTerms?.returnShippingCostPayer, "BUYER");
  assert.equal(evidence.location.country, "KR");
});

test("eBay aspect validation follows generic required, selection, cardinality and conditional metadata", () => {
  const arguments_ = args() as ReturnType<typeof args> & {
    inventoryItem: { product: { aspects: Record<string, string[]> } };
  };
  arguments_.inventoryItem.product.aspects = {
    Metal: ["Yellow Gold"],
    Shape: ["Round"],
    "Metal Purity": ["10k"],
  };
  const locationRemote = remote({ total: 1, locations: [{
    merchantLocationKey: "warehouse",
    merchantLocationStatus: "ENABLED",
    location: { address: { country: "KR" } },
  }] });
  const taxonomy = {
    marketplaceId: "EBAY_US",
    categoryId: "1234",
    categoryTreeId: "0",
    treeHttpStatus: 200,
    aspectsHttpStatus: 200,
    aspectsShapeVerified: true,
    aspectCount: 4,
    aspects: [
      {
        name: "Metal",
        required: true,
        usage: "RECOMMENDED",
        expectedRequiredByDate: null,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        valueCount: 2,
        valuesSample: ["Yellow Gold", "Silver"],
        values: [
          { value: "Yellow Gold", constraints: [] },
          { value: "Silver", constraints: [] },
        ],
      },
      {
        name: "Shape",
        required: false,
        usage: "OPTIONAL",
        expectedRequiredByDate: null,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        valueCount: 2,
        valuesSample: ["Round", "Square"],
        values: [
          { value: "Round", constraints: [] },
          { value: "Square", constraints: [] },
        ],
      },
      {
        name: "Metal Purity",
        required: false,
        usage: "OPTIONAL",
        expectedRequiredByDate: null,
        mode: "SELECTION_ONLY",
        cardinality: "SINGLE",
        valueCount: 1,
        valuesSample: ["10k"],
        values: [{
          value: "10k",
          constraints: [
            { aspectName: "Metal", aspectValues: ["Yellow Gold"] },
            { aspectName: "Shape", aspectValues: ["Round", "Oval"] },
          ],
        }],
      },
      {
        name: "Model",
        required: false,
        usage: "RECOMMENDED",
        expectedRequiredByDate: "2027-01-01T00:00:00.000Z",
        mode: "FREE_TEXT",
        cardinality: "SINGLE",
        valueCount: 0,
        valuesSample: [],
        values: [],
      },
    ],
    requiredAspectNames: ["Metal"],
    upcomingRequiredAspectNames: ["Model"],
    brandAspect: null,
    productAspect: null,
    brandProbeHits: [],
    productProbeHits: [],
    aspectProbeHits: {
      Metal: ["Yellow Gold"],
      Shape: ["Round"],
      "Metal Purity": ["10k"],
    },
    conditionPolicyHttpStatus: 200,
    conditionPolicyCategoryTreeId: "0",
    conditionRequired: true,
    conditionIds: ["1000"],
    fulfillmentPolicy: { httpStatus: 200, ids: ["f1"], names: ["Ship"], marketplaceIds: ["EBAY_US"], exactId: "f1" },
    paymentPolicy: { httpStatus: 200, ids: ["p1"], names: ["Pay"], marketplaceIds: ["EBAY_US"], exactId: "p1" },
    returnPolicy: { httpStatus: 200, ids: ["r1"], names: ["Returns"], marketplaceIds: ["EBAY_US"], exactId: "r1" },
    returnPolicyDetails: [{
      id: "r1", name: "Returns", marketplaceId: "EBAY_US",
      returnsAccepted: false, returnPeriod: null, returnShippingCostPayer: null,
      refundMethod: null, returnMethod: null, internationalOverride: null,
    }],
  };
  const valid = ebayCreateConfigurationEvidence({ arguments: arguments_, taxonomy, locationRemote });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.upcomingRequiredAspectNames, ["Model"]);

  const oneOfTwoDependencies = structuredClone(arguments_);
  oneOfTwoDependencies.inventoryItem.product.aspects.Shape = ["Square"];
  taxonomy.aspectProbeHits.Shape = ["Square"];
  assert.equal(ebayCreateConfigurationEvidence({
    arguments: oneOfTwoDependencies,
    taxonomy,
    locationRemote,
  }).code, "EBAY_ASPECT_CONDITION_UNSATISFIED");
  taxonomy.aspectProbeHits.Shape = ["Round"];

  const missingRequired = structuredClone(arguments_);
  delete missingRequired.inventoryItem.product.aspects.Metal;
  const missingEvidence = ebayCreateConfigurationEvidence({
    arguments: missingRequired,
    taxonomy,
    locationRemote,
  });
  assert.equal(missingEvidence.code, "EBAY_REQUIRED_ASPECT_MISSING");
  assert.deepEqual(missingEvidence.missingAspectNames, ["Metal"]);

  const invalidSelection = structuredClone(arguments_);
  invalidSelection.inventoryItem.product.aspects.Metal = ["Platinum"];
  taxonomy.aspectProbeHits.Metal = [];
  assert.equal(ebayCreateConfigurationEvidence({
    arguments: invalidSelection,
    taxonomy,
    locationRemote,
  }).code, "EBAY_ASPECT_SELECTION_UNVERIFIED");

  const invalidCardinality = structuredClone(arguments_);
  invalidCardinality.inventoryItem.product.aspects.Metal = ["Yellow Gold", "Silver"];
  taxonomy.aspectProbeHits.Metal = ["Yellow Gold", "Silver"];
  assert.equal(ebayCreateConfigurationEvidence({
    arguments: invalidCardinality,
    taxonomy,
    locationRemote,
  }).code, "EBAY_ASPECT_CARDINALITY_INVALID");

  arguments_.inventoryItem.product.aspects.Metal = ["Silver"];
  taxonomy.aspectProbeHits.Metal = ["Silver"];
  const invalid = ebayCreateConfigurationEvidence({ arguments: arguments_, taxonomy, locationRemote });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "EBAY_ASPECT_CONDITION_UNSATISFIED");
  assert.deepEqual(invalid.invalidConditionalAspectValues, ["Metal Purity=10k"]);
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
      assert.equal(methods.length > 0, true);
      assert.equal(methods.every((method) => method === "GET"), true);
    } finally { globalThis.fetch = original; }
  });
}

for (const scenario of ["normal", "dropped-response", "wrong-offer", "wrong-price", "wrong-inventory", "reconcile-mismatch"] as const) {
  test(`eBay create ${scenario}: exact identity and content before publication`, async () => {
    const original = globalThis.fetch;
    const calls: Array<{ path: string; method: string }> = [];
    const events: string[] = [];
    let inventory: Record<string, unknown> | undefined;
    let offer: Record<string, unknown> = {};
    let offerCollectionReads = 0;
    let published = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ path: url.pathname, method });
      events.push(`http:${method}:${url.pathname}`);
      if (url.pathname.endsWith("/get_default_category_tree_id")) return Response.json({ categoryTreeId: "0" });
      if (url.pathname.includes("get_item_aspects_for_category")) return Response.json({ aspects: [
        { localizedAspectName: "Color", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Blue" }] },
      ] });
      if (url.pathname.includes("get_item_condition_policies")) return Response.json({ itemConditionPolicies: [{ categoryId: "1234", categoryTreeId: "0", itemConditionRequired: true, itemConditions: [{ conditionId: "1000" }] }] });
      if (url.pathname.endsWith("/fulfillment_policy")) return Response.json({ total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "f1", name: "Ship", marketplaceId: "EBAY_US" }] });
      if (url.pathname.endsWith("/payment_policy")) return Response.json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p1", name: "Pay", marketplaceId: "EBAY_US" }] });
      if (url.pathname.endsWith("/return_policy")) return Response.json({ total: 1, returnPolicies: [{ returnPolicyId: "r1", name: "Return", marketplaceId: "EBAY_US", returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER" }] });
      if (url.pathname.endsWith("/location")) return Response.json({ total: 1, locations: [{ merchantLocationKey: "warehouse", merchantLocationStatus: "ENABLED", location: { address: { country: "KR" } } }] });
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
        assert.equal(url.searchParams.get("marketplace_id"), "EBAY_US");
        offerCollectionReads += 1;
        if (offerCollectionReads === 1) return Response.json({ total: 0, offers: [] });
        return Response.json({ total: 1, offers: [{ ...exactOffer, ...(scenario === "reconcile-mismatch" ? { sku: "other" } : {}) }] });
      }
      if (url.pathname.endsWith("/offer/offer-1") && method === "GET") {
        return Response.json({ ...offer, offerId: "offer-1", status: published ? "PUBLISHED" : "UNPUBLISHED",
          ...(published ? { listing: { listingId: "110000000001", listingStatus: "ACTIVE" } } : {}),
          ...(scenario === "wrong-offer" ? { sku: "other" } : {}),
          ...(scenario === "wrong-price" ? { pricingSummary: { price: { value: "999", currency: "USD" } } } : {}),
        });
      }
      if (url.pathname.endsWith("/publish") && method === "POST") {
        published = true;
        return Response.json({ listingId: "110000000001" });
      }
      throw new Error(`Unexpected ${method} ${url.pathname}`);
    };
    try {
      const result = await executeChannelOperation({
        channel: "ebay",
        operation: "listing.create",
        payload: { access_token: "fixture-token" },
        arguments: args(),
        environment: "sandbox",
        providerMutationHooks: {
          begin: async () => { events.push("provider-fence"); },
          assertLeaseHealthy: async () => { events.push("lease"); },
        },
      });
      const expectedPublish = scenario === "normal" || scenario === "dropped-response";
      assert.equal(result.ok, expectedPublish);
      if (scenario === "reconcile-mismatch") assert.equal(result.remoteId, sku);
      assert.equal(calls.filter(call => call.path.endsWith("/offer") && call.method === "POST").length, 1);
      assert.equal(calls.filter(call => call.path.endsWith("/publish")).length, expectedPublish ? 1 : 0);
      assert.equal(calls.filter(call => call.path.includes("/offer/") && call.method === "PUT").length, 0);
      assert.equal(events.filter((event) => event === "provider-fence").length, 1);
      const fenceIndex = events.indexOf("provider-fence");
      const firstWriteIndex = events.findIndex((event) => /^http:(?:POST|PUT):/u.test(event));
      assert.equal(fenceIndex > -1 && fenceIndex < firstWriteIndex, true);
      for (const path of [
        "get_default_category_tree_id",
        "get_item_aspects_for_category",
        "get_item_condition_policies",
        "/fulfillment_policy",
        "/payment_policy",
        "/return_policy",
        "/location",
        "/inventory_item/",
        "/offer",
      ]) {
        const readIndex = events.findIndex((event) => event.startsWith("http:GET:") && event.includes(path));
        assert.equal(readIndex > -1 && readIndex < fenceIndex, true, path);
      }
    } finally { globalThis.fetch = original; }
  });
}

test("eBay create resumes one exact existing offer without Inventory or Offer recreation", async () => {
  const original = globalThis.fetch;
  const arguments_ = args();
  const inventory = { ...arguments_.inventoryItem, sku };
  const exactExistingOffer = { ...arguments_.offer, sku, offerId: "offer-1", status: "UNPUBLISHED" };
  const mutations: string[] = [];
  let mutationFences = 0;
  let published = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method !== "GET") mutations.push(`${method} ${url.pathname}`);
    if (url.pathname.endsWith("/get_default_category_tree_id")) return Response.json({ categoryTreeId: "0" });
    if (url.pathname.includes("get_item_aspects_for_category")) return Response.json({ aspects: [
      { localizedAspectName: "Color", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE" }, aspectValues: [{ localizedValue: "Blue" }] },
    ] });
    if (url.pathname.includes("get_item_condition_policies")) return Response.json({ itemConditionPolicies: [{ categoryId: "1234", categoryTreeId: "0", itemConditionRequired: true, itemConditions: [{ conditionId: "1000" }] }] });
    if (url.pathname.endsWith("/fulfillment_policy")) return Response.json({ total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "f1", name: "Ship", marketplaceId: "EBAY_US" }] });
    if (url.pathname.endsWith("/payment_policy")) return Response.json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p1", name: "Pay", marketplaceId: "EBAY_US" }] });
    if (url.pathname.endsWith("/return_policy")) return Response.json({ total: 1, returnPolicies: [{ returnPolicyId: "r1", name: "Return", marketplaceId: "EBAY_US", returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER" }] });
    if (url.pathname.endsWith("/location")) return Response.json({ total: 1, locations: [{ merchantLocationKey: "warehouse", merchantLocationStatus: "ENABLED", location: { address: { country: "KR" } } }] });
    if (url.pathname.endsWith(`/inventory_item/${encodeURIComponent(sku)}`)) return Response.json(inventory);
    if (url.pathname.endsWith("/offer")) return Response.json({ total: 1, offers: [exactExistingOffer] });
    if (url.pathname.endsWith("/offer/offer-1")) return Response.json({
      ...exactExistingOffer,
      status: published ? "PUBLISHED" : "UNPUBLISHED",
      ...(published ? { listing: { listingId: "110000000001", listingStatus: "ACTIVE" } } : {}),
    });
    if (url.pathname.endsWith("/offer/offer-1/publish")) {
      published = true;
      return Response.json({ listingId: "110000000001" });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "fixture-token", marketplace_id: "EBAY_US" },
      arguments: arguments_,
      environment: "sandbox",
      providerMutationHooks: {
        begin: async () => { mutationFences += 1; },
        assertLeaseHealthy: async () => {},
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "110000000001");
    assert.deepEqual(mutations, ["POST /sell/inventory/v1/offer/offer-1/publish"]);
    assert.equal(mutationFences, 1);
    assert.equal(result.steps.some((item) => item.name === "inventory-existing-content-readback" && item.ok), true);
    assert.equal(result.steps.some((item) => item.name === "listing-create-content-readback" && item.ok), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("eBay create blocks duplicate exact offers before every provider mutation", async () => {
  const original = globalThis.fetch;
  const arguments_ = args();
  const inventory = { ...arguments_.inventoryItem, sku };
  const mutations: string[] = [];
  let mutationFences = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method !== "GET") mutations.push(`${method} ${url.pathname}`);
    if (url.pathname.endsWith("/get_default_category_tree_id")) return Response.json({ categoryTreeId: "0" });
    if (url.pathname.includes("get_item_aspects_for_category")) return Response.json({ aspects: [] });
    if (url.pathname.includes("get_item_condition_policies")) return Response.json({ itemConditionPolicies: [{ categoryId: "1234", categoryTreeId: "0", itemConditionRequired: true, itemConditions: [{ conditionId: "1000" }] }] });
    if (url.pathname.endsWith("/fulfillment_policy")) return Response.json({ total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "f1", name: "Ship", marketplaceId: "EBAY_US" }] });
    if (url.pathname.endsWith("/payment_policy")) return Response.json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p1", name: "Pay", marketplaceId: "EBAY_US" }] });
    if (url.pathname.endsWith("/return_policy")) return Response.json({ total: 1, returnPolicies: [{ returnPolicyId: "r1", name: "Return", marketplaceId: "EBAY_US", returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER" }] });
    if (url.pathname.endsWith("/location")) return Response.json({ total: 1, locations: [{ merchantLocationKey: "warehouse", merchantLocationStatus: "ENABLED", location: { address: { country: "KR" } } }] });
    if (url.pathname.includes("/inventory_item/")) return Response.json(inventory);
    if (url.pathname.endsWith("/offer")) return Response.json({ total: 2, offers: [exactOffer, { ...exactOffer, offerId: "offer-2" }] });
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "fixture-token", marketplace_id: "EBAY_US" },
      arguments: arguments_,
      environment: "sandbox",
      providerMutationHooks: {
        begin: async () => { mutationFences += 1; },
        assertLeaseHealthy: async () => {},
      },
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /EBAY_OFFER_NOT_UNIQUE/u);
    assert.deepEqual(mutations, []);
    assert.equal(mutationFences, 0);
  } finally {
    globalThis.fetch = original;
  }
});
