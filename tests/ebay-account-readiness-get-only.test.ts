import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ebayInventoryLocationsEvidence,
  ebaySellerPrivilegeEvidence,
  readEbayAccountReadinessGetOnly,
  readEbaySelectedPoliciesGetOnly,
} from "../lib/channels/ebay-account-readiness-get-only";
import { ebayRequest, runWithProviderReadOnlyTransport } from "../lib/channels/protocols";

function remote(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  return { response, data: body as Record<string, unknown>, text: JSON.stringify(body) };
}

test("eBay account readiness uses only official privilege and inventory-location GETs", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ url, method });
    if (url.endsWith("/sell/account/v1/privilege/")) {
      return Response.json({
        sellerRegistrationCompleted: true,
        sellingLimit: { amount: { value: "1000.00", currency: "USD" }, quantity: 100 },
      });
    }
    if (url.includes("/sell/inventory/v1/location?")) {
      return Response.json({
        total: 1,
        locations: [{
          merchantLocationKey: "seoul-warehouse",
          merchantLocationStatus: "ENABLED",
          name: "Seoul Warehouse",
          location: { address: { country: "KR" } },
        }],
      });
    }
    throw new Error(url);
  };
  try {
    const result = await readEbayAccountReadinessGetOnly({
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
    });
    assert.equal(result.marketplaceId, "EBAY_US");
    assert.equal(result.privilege.verified, true);
    assert.equal(result.inventoryLocations.complete, true);
    assert.deepEqual(result.inventoryLocations.enabledLocationKeys, ["seoul-warehouse"]);
    assert.equal(result.inventoryLocations.exactEnabledLocationKey, "seoul-warehouse");
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay account readiness never auto-selects among multiple enabled locations", () => {
  const result = ebayInventoryLocationsEvidence(remote({
    total: 2,
    locations: [
      { merchantLocationKey: "a", merchantLocationStatus: "ENABLED", location: { address: { country: "KR" } } },
      { merchantLocationKey: "b", merchantLocationStatus: "ENABLED", location: { address: { country: "US" } } },
    ],
  }));
  assert.equal(result.complete, true);
  assert.equal(result.exactEnabledLocationKey, null);
  assert.equal(result.code, "EBAY_INVENTORY_LOCATION_SELECTION_REQUIRED");
});

test("eBay selected policy readback verifies exact IDs and preserves shipping/payment terms", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "GET");
    const url = String(input);
    if (url.endsWith("/fulfillment_policy/f-1")) {
      return Response.json({
        fulfillmentPolicyId: "f-1",
        name: "US shipping",
        marketplaceId: "EBAY_US",
        handlingTime: { value: 3, unit: "DAY" },
        shipToLocations: {
          regionIncluded: [{ regionName: "Worldwide" }],
          regionExcluded: [{ regionName: "RU" }],
        },
        shippingOptions: [{
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [{
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSPriority",
            freeShipping: false,
            shippingCost: { value: "5.00", currency: "USD" },
            additionalShippingCost: { value: "1.00", currency: "USD" },
            shipToLocations: { regionIncluded: [{ regionName: "US" }] },
          }],
        }],
      });
    }
    if (url.endsWith("/payment_policy/p-1")) {
      return Response.json({
        paymentPolicyId: "p-1",
        name: "Managed payments",
        marketplaceId: "EBAY_US",
        immediatePay: true,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        paymentMethods: [{ paymentMethodType: "PAYPAL" }],
      });
    }
    throw new Error(url);
  };
  try {
    const result = await readEbaySelectedPoliciesGetOnly({
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      fulfillmentPolicyId: "f-1",
      paymentPolicyId: "p-1",
    });
    assert.equal(result.fulfillment.verified, true);
    assert.deepEqual(result.fulfillment.handlingTime, { value: 3, unit: "DAY" });
    assert.deepEqual(result.fulfillment.shipToExcluded, ["RU"]);
    assert.equal(result.fulfillment.shippingOptions[0].services[0].shippingCost?.value, "5.00");
    assert.equal(result.payment.verified, true);
    assert.equal(result.payment.immediatePay, true);
    assert.deepEqual(result.payment.categoryTypes, ["ALL_EXCLUDING_MOTORS_VEHICLES"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay account readiness rejects partial pages and malformed selling limits", () => {
  const locations = ebayInventoryLocationsEvidence(remote({
    total: 2,
    next: "/sell/inventory/v1/location?offset=1",
    locations: [{ merchantLocationKey: "a", merchantLocationStatus: "ENABLED" }],
  }));
  assert.equal(locations.complete, false);
  assert.equal(locations.locations.length, 0);
  assert.equal(locations.code, "EBAY_INVENTORY_LOCATIONS_RESPONSE_MALFORMED");

  const privilege = ebaySellerPrivilegeEvidence(remote({
    sellerRegistrationCompleted: true,
    sellingLimit: { amount: { value: "NaN", currency: "USD" }, quantity: 10 },
  }));
  assert.equal(privilege.verified, false);
  assert.equal(privilege.code, "EBAY_SELLING_LIMIT_MALFORMED");
});

test("eBay readiness never verifies HTTP 200 payloads that also contain provider errors", async () => {
  const privilegeBody = {
    sellerRegistrationCompleted: true,
    sellingLimit: { amount: { value: "1000.00", currency: "USD" }, quantity: 100 },
  };
  for (const errors of [[{ errorId: 20400 }], { errorId: 20400 }, null]) {
    const privilege = ebaySellerPrivilegeEvidence(remote({ ...privilegeBody, errors }));
    assert.equal(privilege.verified, false);
    assert.equal(privilege.code, "EBAY_SELLER_PRIVILEGE_PROVIDER_ERRORS");
  }
  assert.equal(ebaySellerPrivilegeEvidence(remote({ ...privilegeBody, errors: [] })).verified, true);

  const locationBody = {
    total: 1,
    locations: [{
      merchantLocationKey: "seoul-warehouse",
      merchantLocationStatus: "ENABLED",
      location: { address: { country: "KR" } },
    }],
  };
  const locations = ebayInventoryLocationsEvidence(remote({
    ...locationBody,
    errors: [{ errorId: 25704 }],
  }));
  assert.equal(locations.complete, false);
  assert.deepEqual(locations.locations, []);
  assert.deepEqual(locations.enabledLocationKeys, []);
  assert.equal(locations.exactEnabledLocationKey, null);
  assert.equal(locations.code, "EBAY_INVENTORY_LOCATIONS_PROVIDER_ERRORS");
  assert.equal(ebayInventoryLocationsEvidence(remote({ ...locationBody, errors: [] })).complete, true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/fulfillment_policy/f-1")) {
      return Response.json({
        fulfillmentPolicyId: "f-1",
        marketplaceId: "EBAY_US",
        errors: [{ errorId: 20400 }],
      });
    }
    if (url.endsWith("/payment_policy/p-1")) {
      return Response.json({
        paymentPolicyId: "p-1",
        marketplaceId: "EBAY_US",
        errors: [{ errorId: 20400 }],
      });
    }
    throw new Error(url);
  };
  try {
    const policies = await readEbaySelectedPoliciesGetOnly({
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      fulfillmentPolicyId: "f-1",
      paymentPolicyId: "p-1",
    });
    assert.equal(policies.fulfillment.httpStatus, 200);
    assert.equal(policies.fulfillment.verified, false);
    assert.equal(policies.payment.httpStatus, 200);
    assert.equal(policies.payment.verified, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay account readiness source cannot mutate a provider resource", async () => {
  const source = await readFile(
    new URL("../lib/channels/ebay-account-readiness-get-only.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /runWithProviderReadOnlyTransport/);
  assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  await assert.rejects(
    () => runWithProviderReadOnlyTransport(() => ebayRequest({
      payload: { access_token: "fixture", marketplace_id: "EBAY_US" },
      environment: "production",
      method: "POST",
      path: "/sell/inventory/v1/offer",
      body: {},
    })),
    /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/,
  );
});

test("eBay approved OAuth readiness preserves recorded scopes and cannot persist or publish", async () => {
  const source = await readFile(
    new URL("../scripts/ebay-approved-oauth-readiness.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /scopes: recordedScopes/);
  assert.match(source, /oauthRefreshPersisted: false/);
  assert.match(source, /providerListingWrites: 0/);
  assert.match(source, /databaseWrites: 0/);
  assert.match(source, /EBAY_TARGET_SKU/);
  assert.match(source, /ebayCreateLineageDecision/);
  assert.doesNotMatch(source, /sellerpilot_record_credential_test|sellerpilot_rotate_credential/);
  assert.doesNotMatch(source, /offer\/publish|listing\.create|executeChannelOperation/);
  assert.doesNotMatch(source, /method:\s*"(PUT|PATCH|DELETE)"/);
});
