import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { verifyListingUpdateReadback } from "../lib/channels/listing-update";
import {
  ebayExactExistingQaRecoveryArgument,
  ebayExactExistingQaRecoveryIdentity,
  ebayExactV101ContentContract,
  ebayExactV101ContentContractArgument,
} from "../lib/channels/ebay-exact-existing-qa-recovery";

const listingId = "800551945442";
const offerId = "offer-immutable-1";
const sku = "SELLERPILOT-CABLE-CLIP-1";
const marketplaceId = "EBAY_US";
const fingerprint = "a".repeat(64);
const currentCredentialId = "11111111-2222-4333-8444-555555555555";
const exactDetailRoles = [
  "detail-overview", "detail-context", "detail-package", "detail-feature",
  "detail-contents", "detail-use", "detail-care", "detail-routine",
];
const exactDetailDigests = Array.from(
  { length: 8 },
  (_, index) => (index + 1).toString(16).padStart(64, "0"),
);
const exactDetailUrls = exactDetailDigests.map((digest) =>
  `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
const exactRepresentativeDigest =
  "292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a";
const exactRepresentativeUrl =
  `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/29/${exactRepresentativeDigest}.jpg`;

function detailHtml(prefix = "updated") {
  return `<p>${prefix} cable clip detail</p>${Array.from(
    { length: 8 },
    (_, index) => `<img src="https://cdn.example.com/detail-${index + 1}.jpg">`,
  ).join("")}`;
}

function exactPreparedImageHtml() {
  return `<section data-sellerpilot-detail-images="true">${exactDetailUrls
    .map((url) => `<img src="${url}">`)
    .join("")}</section>`;
}

function exactAssetBinding() {
  const approvedDetailImages = exactDetailUrls.map((publicUrl, index) => ({
    role: exactDetailRoles[index],
    approvedObjectPath: `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/${exactDetailRoles[index]}.png`,
    approvedSourceSha256: (index + 17).toString(16).padStart(64, "0"),
    publicUrl,
    objectPath: `normalized/${exactDetailDigests[index].slice(0, 2)}/${exactDetailDigests[index]}.jpg`,
    contentSha256: exactDetailDigests[index],
  }));
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "b".repeat(64),
    approvedDetailImages,
    providerImageSurface: "gallery",
    providerTransportImages: [{
      role: "gallery-representative",
      publicUrl: exactRepresentativeUrl,
      objectPath: `normalized/29/${exactRepresentativeDigest}.jpg`,
      contentSha256: exactRepresentativeDigest,
      approvedObjectPath: "results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/gallery-square.png",
      approvedSourceSha256: "e".repeat(64),
    }, ...approvedDetailImages.map((image) => ({
      role: image.role,
      publicUrl: image.publicUrl,
      objectPath: image.objectPath,
      contentSha256: image.contentSha256,
    }))],
  };
}

function exactMarker(stock = 7) {
  return {
    contract: "ebay_exact_existing_qa_recovery_v2",
    phase: "listing.update",
    productId: ebayExactExistingQaRecoveryIdentity.productId,
    listingId: ebayExactExistingQaRecoveryIdentity.listingId,
    sourceAttemptId: ebayExactExistingQaRecoveryIdentity.sourceAttemptId,
    publicListingId: listingId,
    market: "US",
    marketplaceId,
    marketplaceSku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    offerId: ebayExactExistingQaRecoveryIdentity.offerId,
    currency: "USD",
    priceUsd: 12.9,
    stock,
    credentialId: currentCredentialId,
    sellerAccountKey: ebayExactExistingQaRecoveryIdentity.sellerAccountKey,
    offerIdSource: "immutable_lineage_attestation_v1",
    sellerAccountLineage: "validated_by_service_rpc",
  };
}

function exactProviderCopyRequest(stock = 7) {
  const imageHtml = exactPreparedImageHtml();
  return {
    listingId,
    sku: ebayExactExistingQaRecoveryIdentity.marketplaceSku,
    marketplaceId,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    [ebayExactExistingQaRecoveryArgument]: exactMarker(stock),
    [ebayExactV101ContentContractArgument]: ebayExactV101ContentContract,
    sellerpilotPublicationAssetBinding: exactAssetBinding(),
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: stock } },
      product: {
        description: imageHtml,
        imageUrls: [exactRepresentativeUrl, ...exactDetailUrls],
      },
    },
    offer: {
      availableQuantity: stock,
      listingDescription: imageHtml,
      pricingSummary: { price: { currency: "USD", value: 12.9 } },
    },
  };
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
    listingStartDate: "2026-08-23T03:15:00.000Z",
    listing: { listingId, listingStatus: "ACTIVE" },
    ...overrides,
  };
}

function currentInventory(overrides: Record<string, unknown> = {}) {
  return {
    availability: { shipToLocationAvailability: { quantity: 20 } },
    condition: "NEW",
    conditionDescription: "New and unused in original packaging.",
    packageWeightAndSize: {
      packageType: "MAILING_BOX",
      weight: { unit: "KILOGRAM", value: 0.2 },
      dimensions: { unit: "CENTIMETER", length: 10, width: 8, height: 3 },
    },
    product: {
      title: "Current Cable Organizer Clips",
      description: "Current English description",
      imageUrls: ["https://cdn.example.com/current-main.jpg"],
      aspects: {
        Brand: ["Unbranded"],
        Material: ["ABS 플라스틱"],
        Type: ["Cable Clip(s)"],
        "Country/Region of Manufacture": ["China"],
      },
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
    assert.equal(offerWrite?.body?.listingStartDate, "2026-08-23T03:15:00.000Z");
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
  const exactArguments = exactProviderCopyRequest(stock);
  const providerTitle = "Adhesive Cable Clips Black ABS Plastic 6 Pack Desk Wall Cord Organizers New";
  const providerInventoryText = "Current provider English inventory description stays unchanged.";
  const providerOfferText = "Current provider English listing description stays unchanged.";
  const legacyImages = Array.from(
    { length: 4 },
    (_, index) => `<img src="https://i.ebayimg.com/legacy-${index + 1}.jpg">`,
  ).join("");
  const oversizedProviderInventoryDescription =
    `<section><p>${providerInventoryText}</p><p>${"Use the clip on a clean dry surface and route one cable securely. ".repeat(90)}</p></section>${legacyImages}`;
  assert.equal(oversizedProviderInventoryDescription.length > 4_000, true);
  let writtenInventory: Record<string, unknown> | null = null;
  let writtenOffer: Record<string, unknown> | null = null;
  const providerOffer = () => ({
    ...currentOffer({
      offerId: exactOfferId,
      sku: exactSku,
      listingDescription: `<p>${providerOfferText}</p>${legacyImages}`,
      ...(writtenOffer ?? {}),
    }),
  });
  const providerInventory = () => writtenInventory ?? currentInventory({
    product: {
      title: providerTitle,
      description: oversizedProviderInventoryDescription,
      imageUrls: ["https://i.ebayimg.com/provider-main.jpg"],
      aspects: {
        Brand: ["Unbranded"],
        Material: ["ABS 플라스틱"],
        Type: ["Cable Clip(s)"],
        "Country/Region of Manufacture": ["China"],
      },
      brand: "Unbranded",
      mpn: "QA-CC-001",
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
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
      const description = String(
        ((body?.product as Record<string, unknown> | undefined)?.description) ?? "",
      );
      if (description.length < 1 || description.length > 4_000) {
        return Response.json({ errors: [{ errorId: 25718 }] }, { status: 400 });
      }
      writtenInventory = body;
      return new Response(null, { status: 204 });
    }
    if (method === "PUT" && url.endsWith(`/offer/${exactOfferId}`)) {
      events.push("PUT:offer");
      writtenOffer = body;
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
    assert.ok(writtenInventory);
    assert.ok(writtenOffer);
    const writtenProduct = writtenInventory.product as Record<string, unknown>;
    assert.equal(writtenProduct.title, providerTitle);
    assert.match(String(writtenProduct.description), new RegExp(providerInventoryText));
    assert.equal(String(writtenProduct.description).length <= 1_000, true);
    assert.equal((String(writtenProduct.description).match(/<img\b/giu) ?? []).length, 0);
    assert.doesNotMatch(String(writtenProduct.description), /<[^>]+>/u);
    assert.deepEqual(writtenProduct.imageUrls, [
      exactRepresentativeUrl,
      ...exactDetailUrls,
    ]);
    assert.equal(new Set(writtenProduct.imageUrls as string[]).size, 9);
    assert.deepEqual(writtenProduct.aspects, {
      Brand: ["Unbranded"],
      Material: ["ABS Plastic"],
      Type: ["Cable Clip(s)"],
      "Country/Region of Manufacture": ["China"],
    });
    assert.equal(
      writtenInventory.conditionDescription,
      "New and unused in original packaging.",
    );
    assert.deepEqual(
      writtenInventory.packageWeightAndSize,
      currentInventory().packageWeightAndSize,
    );
    assert.equal(writtenOffer.categoryId, "175673");
    assert.match(String(writtenOffer.listingDescription), new RegExp(providerOfferText));
    assert.equal((String(writtenOffer.listingDescription).match(/<img\b/giu) ?? []).length, 8);
    assert.doesNotMatch(String(writtenOffer.listingDescription), /legacy-/u);
    assert.deepEqual(writtenOffer.pricingSummary, { price: { currency: "USD", value: 12.9 } });
    assert.equal(writtenOffer.availableQuantity, stock);
    assert.equal(writtenOffer.categoryId, "175673");
    assert.equal(writtenOffer.merchantLocationKey, "seoul-warehouse");
    assert.equal(writtenOffer.listingStartDate, "2026-08-23T03:15:00.000Z");
    assert.deepEqual(writtenOffer.listingPolicies, currentOffer().listingPolicies);
    assert.equal(writtenOffer.sku, exactSku);
    assert.equal(writtenOffer.marketplaceId, marketplaceId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact eBay UPDATE fails final readback when a preserved offer policy drifts", async () => {
  const originalFetch = globalThis.fetch;
  const exactSku = ebayExactExistingQaRecoveryIdentity.marketplaceSku;
  const exactOfferId = ebayExactExistingQaRecoveryIdentity.offerId;
  let writtenInventory: Record<string, unknown> | null = null;
  let writtenOffer: Record<string, unknown> | null = null;
  let offerReads = 0;
  const exactProviderOffer = () => currentOffer({
    offerId: exactOfferId,
    sku: exactSku,
    listingDescription: "Current English provider listing description remains authoritative.",
  });
  const exactProviderInventory = () => currentInventory({
    product: {
      title: "Adhesive Cable Clips Black ABS Plastic 6 Pack Desk Wall Cord Organizers New",
      description: "Current English provider inventory description remains authoritative.",
      imageUrls: ["https://i.ebayimg.com/current.jpg"],
      aspects: {
        Brand: ["Unbranded"],
        Material: ["ABS 플라스틱"],
        Type: ["Cable Clip(s)"],
        "Country/Region of Manufacture": ["China"],
      },
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
    if (method === "GET" && url.includes("/offer?") && url.includes(`sku=${exactSku}`)) {
      return Response.json({ offers: [exactProviderOffer()] });
    }
    if (method === "GET" && url.endsWith(`/offer/${exactOfferId}`)) {
      offerReads += 1;
      if (offerReads === 1) return Response.json(exactProviderOffer());
      return Response.json({
        ...exactProviderOffer(),
        ...(writtenOffer ?? {}),
        listingPolicies: {
          ...(currentOffer().listingPolicies as Record<string, unknown>),
          fulfillmentPolicyId: "unexpected-policy-drift",
        },
      });
    }
    if (method === "GET" && url.endsWith(`/inventory_item/${exactSku}`)) {
      return Response.json(writtenInventory ?? exactProviderInventory());
    }
    if (method === "PUT" && url.endsWith(`/inventory_item/${exactSku}`)) {
      writtenInventory = body;
      return new Response(null, { status: 204 });
    }
    if (method === "PUT" && url.endsWith(`/offer/${exactOfferId}`)) {
      writtenOffer = body;
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected eBay policy-drift request: ${method} ${url}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.update",
      payload: { access_token: "secret", marketplace_id: marketplaceId },
      arguments: exactProviderCopyRequest(),
      environment: "production",
      providerMutationHooks: {
        assertLeaseHealthy: async () => undefined,
        begin: async () => undefined,
      },
    });
    assert.equal(result.ok, false);
    const readback = result.steps.find((item) =>
      item.name === "listing-update-content-readback");
    assert.equal(readback?.ok, false);
    assert.equal(
      readback?.data.sellerpilotVerification,
      "LISTING_MUTABLE_FIELDS_MISMATCH",
    );
    assert.ok((readback?.data.sellerpilotMismatchPaths as string[]).includes(
      "offer.listingPolicies.fulfillmentPolicyId",
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact eBay readback rejects reordered or duplicate gallery and detail images", () => {
  const expected = exactProviderCopyRequest();
  const exactReadback = {
    inventoryItem: structuredClone(expected.inventoryItem),
    offer: structuredClone(expected.offer),
  };
  assert.deepEqual(
    verifyListingUpdateReadback("ebay", expected, exactReadback),
    { ok: true, mismatches: [] },
  );

  const reordered = structuredClone(exactReadback);
  const reorderedProduct = reordered.inventoryItem.product;
  [reorderedProduct.imageUrls[1], reorderedProduct.imageUrls[2]] = [
    reorderedProduct.imageUrls[2],
    reorderedProduct.imageUrls[1],
  ];
  const reorderedResult = verifyListingUpdateReadback(
    "ebay",
    expected,
    reordered,
  );
  assert.equal(reorderedResult.ok, false);
  assert.ok(reorderedResult.mismatches.includes(
    "inventoryItem.product.imageUrls[1]",
  ));

  const duplicate = structuredClone(exactReadback);
  duplicate.inventoryItem.product.imageUrls[8] =
    duplicate.inventoryItem.product.imageUrls[7];
  const duplicateResult = verifyListingUpdateReadback(
    "ebay",
    expected,
    duplicate,
  );
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.mismatches.includes(
    "inventoryItem.product.imageUrls[8]",
  ));

  const reversedDetailMarkup = structuredClone(exactReadback);
  reversedDetailMarkup.offer.listingDescription =
    `${exactDetailUrls.slice().reverse().map((url) => `<img src="${url}">`).join("")}`;
  const detailResult = verifyListingUpdateReadback(
    "ebay",
    expected,
    reversedDetailMarkup,
  );
  assert.equal(detailResult.ok, false);
  assert.ok(detailResult.mismatches.includes(
    "offer.listingDescription.text",
  ) || detailResult.mismatches.includes(
    "offer.listingDescription.imageUrls[0]",
  ));
});

test("exact eBay UPDATE performs zero writes for missing, mismatched, or duplicate bound-offer discovery", async () => {
  const originalFetch = globalThis.fetch;
  const exactSku = ebayExactExistingQaRecoveryIdentity.marketplaceSku;
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
        arguments: exactProviderCopyRequest(),
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

test("exact eBay UPDATE rejects client buyer copy before every provider call", async () => {
  const originalFetch = globalThis.fetch;
  const argumentsValue = exactProviderCopyRequest();
  (argumentsValue.inventoryItem.product as Record<string, unknown>).title =
    "Browser supplied title must not reach eBay";
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider call must not be reached");
  };
  try {
    await assert.rejects(
      executeChannelOperation({
        channel: "ebay",
        operation: "listing.update",
        payload: { access_token: "secret", marketplace_id: marketplaceId },
        arguments: argumentsValue,
        environment: "production",
        providerMutationHooks: {
          assertLeaseHealthy: async () => undefined,
          begin: async () => undefined,
        },
      }),
      /EBAY_EXACT_EXISTING_QA_PROVIDER_COPY_REQUEST_REQUIRED/u,
    );
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact eBay UPDATE performs all identity GETs but zero writes for non-English provider copy", async () => {
  const originalFetch = globalThis.fetch;
  const exactSku = ebayExactExistingQaRecoveryIdentity.marketplaceSku;
  const exactOfferId = ebayExactExistingQaRecoveryIdentity.offerId;
  const events: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    events.push(`${method}:${url.includes("/offer?") ? "discovery" : url.includes("/inventory_item/") ? "inventory" : "offer"}`);
    if (method !== "GET") throw new Error("provider write must not be reached");
    if (url.includes("/offer?")) {
      return Response.json({
        offers: [currentOffer({
          offerId: exactOfferId,
          sku: exactSku,
        })],
      });
    }
    if (url.endsWith(`/offer/${exactOfferId}`)) {
      return Response.json(currentOffer({
        offerId: exactOfferId,
        sku: exactSku,
        listingDescription: "Current English provider listing description remains authoritative.",
      }));
    }
    if (url.endsWith(`/inventory_item/${exactSku}`)) {
      return Response.json(currentInventory({
        product: {
          title: "부착형 케이블 정리 클립",
          description: "Current English provider inventory description remains authoritative.",
          imageUrls: ["https://i.ebayimg.com/current.jpg"],
          aspects: {
            Brand: ["Unbranded"],
            Material: ["ABS 플라스틱"],
            Type: ["Cable Clip(s)"],
            "Country/Region of Manufacture": ["China"],
          },
        },
      }));
    }
    throw new Error(`unexpected eBay request: ${url}`);
  };
  try {
    await assert.rejects(
      executeChannelOperation({
        channel: "ebay",
        operation: "listing.update",
        payload: { access_token: "secret", marketplace_id: marketplaceId },
        arguments: exactProviderCopyRequest(),
        environment: "production",
        providerMutationHooks: {
          assertLeaseHealthy: async () => { events.push("lease"); },
          begin: async () => { events.push("mutation-fence"); },
        },
      }),
      /EBAY_EXACT_EXISTING_QA_CONTENT_CONTRACT_REQUIRED/u,
    );
    assert.deepEqual(events, ["GET:discovery", "GET:offer", "GET:inventory"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
