import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildOfferUpdate,
  buildOneDayPolicy,
  runOneDayChange,
  target,
  verifyOfferPolicyOnlyChange,
  verifyTargetPolicy,
} from "../scripts/ebay-narangd-one-day-fulfillment-policy.mjs";

const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");

const sourcePolicy = {
  name: "Couplit-US-Fulfillment-Standard",
  description: "Shared policy",
  marketplaceId: target.marketplaceId,
  categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: false }],
  handlingTime: { value: 2, unit: "DAY" },
  globalShipping: false,
  pickupDropOff: false,
  freightShipping: false,
  fulfillmentPolicyId: target.sourcePolicyId,
  shipToLocations: {},
  shippingOptions: [{
    optionType: "DOMESTIC",
    costType: "FLAT_RATE",
    shippingServices: [{
      sortOrder: 1,
      shippingCarrierCode: "GENERIC",
      shippingServiceCode: "StandardShippingFromOutsideUS",
      shippingCost: { value: "0.0", currency: "USD" },
      additionalShippingCost: { value: "0.0", currency: "USD" },
      freeShipping: true,
      buyerResponsibleForShipping: false,
    }],
    shippingDiscountProfileId: "0",
    shippingPromotionOffered: false,
  }],
};

const offer = {
  offerId: target.offerId,
  sku: target.sku,
  marketplaceId: target.marketplaceId,
  format: "FIXED_PRICE",
  availableQuantity: 10,
  pricingSummary: { price: { value: "2.25", currency: "USD" } },
  listingPolicies: {
    fulfillmentPolicyId: target.sourcePolicyId,
    paymentPolicyId: "287802924015",
    returnPolicyId: "287803019015",
    eBayPlusIfEligible: false,
  },
  categoryId: "179188",
  merchantLocationKey: "SP-KR-INCHEON-01",
  tax: { applyTax: false },
  listing: { listingId: target.listingId, listingStatus: "ACTIVE", soldQuantity: 0 },
  status: "PUBLISHED",
  listingDuration: "GTC",
  includeCatalogProductDetails: true,
  hideBuyerDetails: false,
  listingDescription: "<p>Full ingredients stay in the description.</p>",
};

function databaseRow() {
  return {
    product_id: target.productId,
    product_sku: target.productSku,
    product_owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    listing_id: target.localListingId,
    listing_product_id: target.productId,
    listing_owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    listing_operation_attempt_id: target.sourceAttemptId,
    source_job_id: target.sourceJobId,
    source_attempt_id: target.sourceAttemptId,
    attempt_owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    credential_id: target.credentialId,
    channel_key: "ebay",
    market: "US",
    target_id: target.marketplaceId,
    listing_status: "published",
    remote_visibility: "live",
    provider_status: "ACTIVE",
    remote_id: target.listingId,
    marketplace_sku: target.sku,
    provider_resource_id: target.offerId,
    listing_seller_account_key: "b".repeat(64),
    credential_status: "active",
    credential_channel: "ebay",
    credential_environment: "production",
    credential_seller_account_key: "b".repeat(64),
    receipt_digest: target.repairReceiptDigest,
    receipt_offer_id: target.offerId,
    receipt_remote_listing_id: target.listingId,
    running_ebay_jobs: 0,
    credential_payload: {
      access_token: "fixture-secret-never-output",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      provider_account_identity_version: "v1",
      provider_account_subject: "ebay:eias:fixture",
    },
  };
}

function provider({ targetExists = false, offerBound = false, loseCreateResponse = false } = {}) {
  const state = {
    policy: targetExists ? { ...buildOneDayPolicy(sourcePolicy), fulfillmentPolicyId: "999888777666" } : null,
    offer: structuredClone(offer),
    writes: [],
  };
  if (offerBound) state.offer.listingPolicies.fulfillmentPolicyId = "999888777666";
  const request = async (method, path, query, body) => {
    if (method !== "GET") state.writes.push(`${method} ${path}`);
    if (path === `/sell/account/v1/fulfillment_policy/${target.sourcePolicyId}`) {
      return { ok: true, status: 200, data: structuredClone(sourcePolicy) };
    }
    if (path === "/sell/account/v1/fulfillment_policy/get_by_policy_name") {
      assert.equal(query.get("marketplace_id"), target.marketplaceId);
      assert.equal(query.get("name"), target.policyName);
      return state.policy
        ? { ok: true, status: 200, data: structuredClone(state.policy) }
        : { ok: false, status: 404, data: { errors: [{ errorId: 20404 }] } };
    }
    if (path === "/sell/account/v1/fulfillment_policy" && method === "POST") {
      state.policy = { ...structuredClone(body), fulfillmentPolicyId: "999888777666" };
      if (loseCreateResponse) throw new TypeError("response lost after acceptance");
      return { ok: true, status: 201, data: { fulfillmentPolicyId: "999888777666" } };
    }
    if (path === `/sell/inventory/v1/offer/${target.offerId}` && method === "GET") {
      return { ok: true, status: 200, data: structuredClone(state.offer) };
    }
    if (path === `/sell/inventory/v1/offer/${target.offerId}` && method === "PUT") {
      state.offer = {
        ...structuredClone(body), offerId: target.offerId, status: "PUBLISHED",
        listing: structuredClone(offer.listing),
      };
      return { ok: true, status: 204, data: {} };
    }
    throw new Error(`unexpected request: ${method} ${path}`);
  };
  return { state, request };
}

function harness(fixture) {
  const evidence = new Map();
  return {
    evidence,
    args: {
      sourceRow: databaseRow(),
      request: fixture.request,
      expectations: { offerDigest: digest(offer), sourcePolicyDigest: digest(sourcePolicy) },
      readEvidence: async (kind) => evidence.get(kind) ?? null,
      writeEvidence: async (kind, value) => {
        assert.equal(evidence.has(kind), false, `duplicate ${kind} evidence`);
        evidence.set(kind, structuredClone(value));
        return { path: `/private/${kind}`, digest: digest(value) };
      },
    },
  };
}

test("policy copy preserves shipping terms but strips response-only fields and changes only handling identity", () => {
  const body = buildOneDayPolicy(sourcePolicy);
  assert.equal(body.name, target.policyName);
  assert.deepEqual(body.handlingTime, { value: 1, unit: "DAY" });
  assert.deepEqual(body.categoryTypes, [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }]);
  assert.equal(Object.hasOwn(body, "fulfillmentPolicyId"), false);
  assert.equal(Object.hasOwn(body, "shipToLocations"), false);
  assert.equal(Object.hasOwn(body.shippingOptions[0], "shippingDiscountProfileId"), false);
  assert.equal(Object.hasOwn(body.shippingOptions[0].shippingServices[0], "buyerResponsibleForShipping"), false);
  const readback = { ...body, fulfillmentPolicyId: "999888777666" };
  assert.equal(verifyTargetPolicy(readback, body), "999888777666");
  readback.handlingTime = { value: 2, unit: "DAY" };
  assert.equal(verifyTargetPolicy(readback, body), "");
});

test("offer update body omits provider read-only fields and changes only fulfillmentPolicyId", () => {
  const body = buildOfferUpdate(offer, "999888777666");
  assert.equal(Object.hasOwn(body, "offerId"), false);
  assert.equal(Object.hasOwn(body, "listing"), false);
  assert.equal(Object.hasOwn(body, "status"), false);
  assert.equal(body.listingPolicies.paymentPolicyId, offer.listingPolicies.paymentPolicyId);
  assert.equal(body.listingPolicies.returnPolicyId, offer.listingPolicies.returnPolicyId);
  assert.equal(body.listingPolicies.fulfillmentPolicyId, "999888777666");
  const after = { ...structuredClone(body), offerId: target.offerId, status: "PUBLISHED", listing: offer.listing };
  assert.equal(verifyOfferPolicyOnlyChange(offer, after, "999888777666"), true);
  after.availableQuantity = 9;
  assert.equal(verifyOfferPolicyOnlyChange(offer, after, "999888777666"), false);
});

test("default preflight performs the three exact GETs and no provider write", async () => {
  const fixture = provider();
  const run = harness(fixture);
  const result = await runOneDayChange({ ...run.args, execute: false });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.eligible, true);
  assert.equal(result.currentHandlingDays, 2);
  assert.equal(result.targetPolicyState, "absent");
  assert.deepEqual(fixture.state.writes, []);
  assert.equal(run.evidence.size, 0);
});

for (const loseCreateResponse of [false, true]) {
  test(`execute creates one policy and updates the same Offer once (lost create response: ${loseCreateResponse})`, async () => {
    const fixture = provider({ loseCreateResponse });
    const run = harness(fixture);
    const result = await runOneDayChange({ ...run.args, execute: true });
    assert.deepEqual(fixture.state.writes, [
      "POST /sell/account/v1/fulfillment_policy",
      `PUT /sell/inventory/v1/offer/${target.offerId}`,
    ]);
    assert.equal(result.providerWrites, 2);
    assert.equal(result.fulfillmentPolicyId, "999888777666");
    assert.equal(fixture.state.offer.listingPolicies.fulfillmentPolicyId, "999888777666");
    assert.equal(fixture.state.offer.listingPolicies.paymentPolicyId, offer.listingPolicies.paymentPolicyId);
    assert.deepEqual(run.evidence.get("complete").handlingTime, { value: 1, unit: "DAY" });
  });
}

test("durable policy receipt resumes an already-bound Offer without repeating POST or PUT", async () => {
  const fixture = provider({ targetExists: true, offerBound: true });
  const run = harness(fixture);
  const policyBody = buildOneDayPolicy(sourcePolicy);
  run.evidence.set("policy", {
    version: 1, outcome: "policy_verified", offerId: target.offerId, listingId: target.listingId,
    policyId: "999888777666", policyBodyDigest: digest(policyBody), originalOfferDigest: digest(offer),
  });
  const expectedFinalDigest = digest(fixture.state.offer);
  run.evidence.set("complete", {
    version: 1, outcome: "one_day_verified", offerId: target.offerId, listingId: target.listingId,
    fulfillmentPolicyId: "999888777666", originalOfferDigest: digest(offer),
    finalOfferDigest: expectedFinalDigest, policyBodyDigest: digest(policyBody),
  });
  const result = await runOneDayChange({ ...run.args, execute: true });
  assert.equal(result.providerWrites, 0);
  assert.deepEqual(fixture.state.writes, []);
  assert.equal(result.evidence.state, "existing_exact");
});

test("an already-bound Offer without the durable pre-update receipt is rejected before writes", async () => {
  const fixture = provider({ targetExists: true, offerBound: true });
  const run = harness(fixture);
  await assert.rejects(runOneDayChange({ ...run.args, execute: true }),
    /EBAY_NARANGD_ONE_DAY_OFFER_PREIMAGE_DRIFT/);
  assert.deepEqual(fixture.state.writes, []);
});
