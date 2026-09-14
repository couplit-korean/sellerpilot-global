import assert from "node:assert/strict";
import test from "node:test";

import { incident, runRepair } from "../scripts/ebay-narangd-unpublished-offer-repair.mjs";

const material = "정제수, 탄산가스, 난소화성말토덱스트린, 정제소금, 레몬농축과즙, 구연산, 사과산, 염화칼륨, 구연산삼나트륨, 젖산칼슘, 향료, 감미료(아세설팜칼륨, 수크랄로스)";
const inventoryItem = {
  availability: { shipToLocationAvailability: { quantity: 10 } },
  condition: "NEW",
  product: {
    title: "Narangd Cider Zero Carbonated Soft Drink 500 ml Single Bottle",
    description: "Ingredients are preserved here in the complete product description.",
    imageUrls: ["https://cdn.example.com/one.jpg"],
    aspects: { Brand: ["Dong-A Otsuka"], Product: ["Soft Drink"], Material: [material] },
  },
};
const offer = {
  sku: incident.sku,
  marketplaceId: incident.marketplaceId,
  format: "FIXED_PRICE",
  categoryId: incident.categoryId,
  listingDescription: "<h1>Narangd Cider Zero</h1><p>Ingredients remain complete in this description.</p>",
  availableQuantity: 10,
  pricingSummary: { price: { value: "2.25", currency: "USD" } },
  merchantLocationKey: "warehouse",
  listingPolicies: { fulfillmentPolicyId: "f1", paymentPolicyId: "p1", returnPolicyId: "r1" },
};

function sourceRow() {
  return {
    job_id: incident.jobId,
    listing_id: incident.listingId,
    attempt_id: incident.attemptId,
    product_id: incident.productId,
    job_channel: "ebay",
    job_operation: "listing.create",
    job_status: "reconciliation_required",
    attempt_status: "manual_required",
    listing_status: "failed",
    failure_class: "external_action",
    listing_remote_id: incident.offerId,
    attempt_remote_id: incident.offerId,
    marketplace_sku: null,
    provider_resource_id: null,
    remote_resources: {},
    remote_visibility: "unknown",
    market: "US",
    target_id: incident.marketplaceId,
    provider_mutation_started: true,
    running_ebay_jobs: 0,
    request_fingerprint: "a".repeat(64),
    attempt_fingerprint: "a".repeat(64),
    job_seller_account_key: "b".repeat(64),
    attempt_seller_account_key: "b".repeat(64),
    credential_seller_account_key: "b".repeat(64),
    active_credential_count: 1,
    credential_channel: "ebay",
    credential_environment: "production",
    credential_status: "active",
    credential_identity_source: "provider_certified_v1",
    credential_identity_verified: true,
    credential_payload: {
      access_token: "secret-never-output",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      marketplace_id: incident.marketplaceId,
      provider_account_identity_version: "v1",
      provider_account_subject: "ebay:eias:fixture",
    },
    request_payload: { arguments: { sku: incident.sku, inventoryItem, offer, publish: true } },
    response_payload: {
      ok: false,
      remoteId: incident.offerId,
      steps: [
        { name: "inventory-item", ok: true, status: 204, data: {} },
        { name: "offer", ok: true, status: 201, data: { offerId: incident.offerId } },
        { name: "offer-detail-image-readback", ok: true, status: 200, data: { ...offer, offerId: incident.offerId, status: "UNPUBLISHED" } },
        { name: "publish", ok: false, status: 400, data: { errors: [{ errorId: 25002, parameters: [{ name: "3", value: "Material" }, { name: "4", value: material }] }] } },
      ],
    },
  };
}

function provider() {
  const state = {
    inventory: structuredClone(inventoryItem),
    published: false,
    writes: [],
  };
  const request = async (method, path, query, body) => {
    if (method !== "GET") state.writes.push(`${method} ${path}`);
    if (path.includes("/inventory_item/")) {
      if (method === "PUT") {
        state.inventory = structuredClone(body);
        return { ok: true, status: 204, data: {} };
      }
      return { ok: true, status: 200, data: structuredClone(state.inventory) };
    }
    if (path === "/sell/inventory/v1/offer") {
      assert.equal(query.get("sku"), incident.sku);
      assert.equal(query.get("marketplace_id"), incident.marketplaceId);
      return { ok: true, status: 200, data: { total: 1, offers: [{
        offerId: incident.offerId, sku: incident.sku,
        marketplaceId: incident.marketplaceId, format: "FIXED_PRICE",
      }] } };
    }
    if (path.endsWith("/publish")) {
      state.published = true;
      return { ok: true, status: 200, data: { listingId: "999000111222" } };
    }
    if (path.endsWith(`/offer/${incident.offerId}`)) {
      return { ok: true, status: 200, data: {
        ...structuredClone(offer), offerId: incident.offerId,
        status: state.published ? "PUBLISHED" : "UNPUBLISHED",
        ...(state.published ? { listing: { listingId: "999000111222", listingStatus: "ACTIVE" } } : {}),
      } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { state, request };
}

test("dry-run proves the one exact unpublished offer and performs no provider write", async () => {
  const fixture = provider();
  const result = await runRepair({ execute: false, sourceRow: sourceRow(), request: fixture.request });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.eligible, true);
  assert.equal(result.providerWrites, 0);
  assert.deepEqual(fixture.state.writes, []);
});

test("execute removes only optional Material, publishes the same offer, and verifies final state", async () => {
  const fixture = provider();
  let receipt;
  const result = await runRepair({
    execute: true,
    sourceRow: sourceRow(),
    request: fixture.request,
    writeEvidence: async (value) => { receipt = value; return { path: "/private/evidence", digest: "d".repeat(64) }; },
  });
  assert.deepEqual(fixture.state.writes, [
    `PUT /sell/inventory/v1/inventory_item/${encodeURIComponent(incident.sku)}`,
    `POST /sell/inventory/v1/offer/${incident.offerId}/publish`,
  ]);
  assert.equal(Object.hasOwn(fixture.state.inventory.product.aspects, "Material"), false);
  assert.equal(fixture.state.inventory.product.description, inventoryItem.product.description);
  assert.equal(result.publishedListingId, "999000111222");
  assert.equal(result.next, "exact-lineage-succession-required");
  assert.equal(receipt.incident.jobId, incident.jobId);
  assert.equal(receipt.listingId, "999000111222");
  assert.equal(receipt.providerReadback.offer.listing.listingStatus, "ACTIVE");
  assert.equal(Object.hasOwn(receipt.providerReadback.inventoryItem.product.aspects, "Material"), false);
});

test("any remote identity drift stops before Inventory or publish writes", async () => {
  const fixture = provider();
  const original = fixture.request;
  fixture.request = async (method, path, query, body) => {
    const response = await original(method, path, query, body);
    if (method === "GET" && path.endsWith(`/offer/${incident.offerId}`)) {
      response.data.sku = "different-sku";
    }
    return response;
  };
  await assert.rejects(
    runRepair({ execute: true, sourceRow: sourceRow(), request: fixture.request }),
    /EBAY_NARANGD_REPAIR_PROVIDER_PREFLIGHT_DRIFT/,
  );
  assert.deepEqual(fixture.state.writes, []);
});

test("a new publish rejection is preserved with both readbacks before execution stops", async () => {
  const fixture = provider();
  const original = fixture.request;
  let failureReceipt;
  fixture.request = async (method, path, query, body) => {
    if (method === "POST" && path.endsWith("/publish")) {
      fixture.state.writes.push(`${method} ${path}`);
      return { ok: false, status: 400, data: {
        errors: [{ errorId: 99999, message: "new provider rejection" }],
      } };
    }
    return original(method, path, query, body);
  };
  await assert.rejects(runRepair({
    execute: true,
    sourceRow: sourceRow(),
    request: fixture.request,
    writeEvidence: async (value) => { failureReceipt = value; return { path: "/private/failure", digest: "e".repeat(64) }; },
  }), /EBAY_NARANGD_REPAIR_PUBLISH_NOT_VERIFIED/);
  assert.equal(failureReceipt.outcome, "failed");
  assert.equal(failureReceipt.failedStage, "offer-final-readback");
  assert.equal(failureReceipt.providerStatuses.publish, 400);
  assert.equal(failureReceipt.providerStatuses.inventoryReadback, 200);
  assert.equal(failureReceipt.providerStatuses.offerReadback, 200);
  assert.equal(failureReceipt.providerReadback.publish.errors[0].errorId, 99999);
  assert.equal(failureReceipt.providerReadback.offer.status, "UNPUBLISHED");
  assert.equal(Object.hasOwn(failureReceipt.providerReadback.inventoryItem.product.aspects, "Material"), false);
  assert.equal(failureReceipt.incident.jobId, incident.jobId);
  assert.equal(fixture.state.writes.filter((value) => value.endsWith("/publish")).length, 1);
});

for (const lostPhase of ["inventory", "publish"]) {
  test(`a lost ${lostPhase} response is resolved by GET and the write is never repeated`, async () => {
    const fixture = provider();
    const original = fixture.request;
    let dropped = false;
    fixture.request = async (method, path, query, body) => {
      const response = await original(method, path, query, body);
      if (!dropped && ((lostPhase === "inventory" && method === "PUT")
          || (lostPhase === "publish" && path.endsWith("/publish")))) {
        dropped = true;
        throw new TypeError("response lost after provider acceptance");
      }
      return response;
    };
    const result = await runRepair({
      execute: true,
      sourceRow: sourceRow(),
      request: fixture.request,
      writeEvidence: async () => ({ path: "/private/evidence", digest: "d".repeat(64) }),
    });
    assert.equal(result.publishedListingId, "999000111222");
    assert.equal(fixture.state.writes.filter((value) => value.startsWith("PUT ")).length, 1);
    assert.equal(fixture.state.writes.filter((value) => value.endsWith("/publish")).length, 1);
  });
}
