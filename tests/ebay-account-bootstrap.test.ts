import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ensureEbayBusinessPolicies,
  ensureEbayInventoryLocation,
} from "../lib/channels/ebay-account-bootstrap";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";

type RecordedCall = { url: string; method: string; body: unknown };

const payload = { access_token: "fixture-token", marketplace_id: "EBAY_US" };

function fulfillmentTerms() {
  return {
    name: "SellerPilot standard shipping",
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    handlingTime: { value: 1, unit: "DAY" as const },
    shippingOptions: [{
      optionType: "DOMESTIC",
      costType: "FLAT_RATE",
      shippingServices: [{
        sortOrder: 1,
        shippingCarrierCode: "USPS",
        shippingServiceCode: "USPSPriority",
        shippingCost: { value: "12.50", currency: "USD" },
      }],
    }],
  };
}

function paymentTerms() {
  return {
    name: "SellerPilot immediate payment",
    immediatePay: true,
    paymentMethods: [{ paymentMethodType: "CREDIT_CARD" }],
  };
}

function returnTerms() {
  return {
    name: "SellerPilot 30 day returns",
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" as const },
    returnShippingCostPayer: "BUYER",
    refundMethod: "MONEY_BACK",
    returnMethod: "REPLACEMENT",
  };
}

function terms() {
  return {
    fulfillment: fulfillmentTerms(),
    payment: paymentTerms(),
    return: returnTerms(),
  };
}

function locationTerms() {
  return {
    merchantLocationKey: "sellerpilot-seoul-warehouse",
    name: "SellerPilot Seoul Warehouse",
    address: {
      addressLine1: "12 Operator Supplied Street",
      city: "Seoul",
      stateOrProvince: "Seoul",
      postalCode: "04524",
      country: "KR",
    },
    locationTypes: ["WAREHOUSE"],
  };
}

function withFetch(
  handler: (call: RecordedCall) => Response | undefined,
): { calls: RecordedCall[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: RecordedCall[] = [];
  globalThis.fetch = async (input, init) => {
    const call: RecordedCall = {
      url: String(input),
      method: String(init?.method ?? "GET"),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    const response = handler(call);
    if (!response) throw new Error(`unexpected provider call ${call.method} ${call.url}`);
    return response;
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

test("eBay policy bootstrap reuses existing policies with GET-only reads", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname === "/sell/account/v1/fulfillment_policy") {
      return json({
        total: 1,
        fulfillmentPolicies: [{
          fulfillmentPolicyId: "f-existing",
          name: "US shipping",
          marketplaceId: "EBAY_US",
          categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        }],
      });
    }
    if (url.pathname === "/sell/account/v1/payment_policy") {
      return json({
        total: 1,
        paymentPolicies: [{
          paymentPolicyId: "p-existing",
          name: "Immediate payment",
          marketplaceId: "EBAY_US",
        }],
      });
    }
    if (url.pathname === "/sell/account/v1/return_policy") {
      return json({
        total: 1,
        returnPolicies: [{
          returnPolicyId: "r-existing",
          name: "30 day returns",
          marketplaceId: "EBAY_US",
        }],
      });
    }
    return undefined;
  });
  try {
    const result = await ensureEbayBusinessPolicies({
      payload,
      marketplaceId: "EBAY_US",
      terms: terms(),
    });
    assert.equal(result.fulfillmentPolicyId, "f-existing");
    assert.equal(result.paymentPolicyId, "p-existing");
    assert.equal(result.returnPolicyId, "r-existing");
    assert.deepEqual(result.created, {
      fulfillment: false,
      payment: false,
      return: false,
    });
    assert.equal(result.providerWrites, 0);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET"]);
    assert.deepEqual(
      calls.map((call) => new URL(call.url).pathname).sort(),
      [
        "/sell/account/v1/fulfillment_policy",
        "/sell/account/v1/payment_policy",
        "/sell/account/v1/return_policy",
      ],
    );
  } finally {
    restore();
  }
});

test("eBay policy bootstrap creates only the missing policy from operator terms", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname === "/sell/account/v1/fulfillment_policy" && call.method === "GET") {
      return json({ total: 0, fulfillmentPolicies: [] });
    }
    if (url.pathname === "/sell/account/v1/payment_policy") {
      return json({
        total: 1,
        paymentPolicies: [{ paymentPolicyId: "p-existing", marketplaceId: "EBAY_US" }],
      });
    }
    if (url.pathname === "/sell/account/v1/return_policy") {
      return json({
        total: 1,
        returnPolicies: [{ returnPolicyId: "r-existing", marketplaceId: "EBAY_US" }],
      });
    }
    if (url.pathname === "/sell/account/v1/fulfillment_policy" && call.method === "POST") {
      return json({
        fulfillmentPolicyId: "f-created",
        marketplaceId: "EBAY_US",
        name: "SellerPilot standard shipping",
      }, 201);
    }
    return undefined;
  });
  try {
    const result = await ensureEbayBusinessPolicies({
      payload,
      marketplaceId: "EBAY_US",
      terms: terms(),
    });
    assert.equal(result.fulfillmentPolicyId, "f-created");
    assert.equal(result.paymentPolicyId, "p-existing");
    assert.equal(result.returnPolicyId, "r-existing");
    assert.deepEqual(result.created, {
      fulfillment: true,
      payment: false,
      return: false,
    });
    assert.equal(result.providerWrites, 1);
    const writes = calls.filter((call) => call.method === "POST");
    assert.equal(writes.length, 1);
    assert.equal(new URL(writes[0].url).pathname, "/sell/account/v1/fulfillment_policy");
    assert.deepEqual(writes[0].body, {
      name: "SellerPilot standard shipping",
      marketplaceId: "EBAY_US",
      handlingTime: { value: 1, unit: "DAY" },
      shippingOptions: [{
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [{
          sortOrder: 1,
          shippingCarrierCode: "USPS",
          shippingServiceCode: "USPSPriority",
          shippingCost: { value: "12.50", currency: "USD" },
        }],
      }],
      categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
    });
    // Every read precedes the single write.
    assert.equal(calls.filter((call) => call.method === "GET").length, 3);
    assert.equal(calls.at(-1)?.method, "POST");
  } finally {
    restore();
  }
});

test("eBay policy bootstrap never auto-selects among several usable policies", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname === "/sell/account/v1/fulfillment_policy") {
      return json({
        total: 2,
        fulfillmentPolicies: [
          {
            fulfillmentPolicyId: "f-1",
            marketplaceId: "EBAY_US",
            name: "A",
            categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
          },
          {
            fulfillmentPolicyId: "f-2",
            marketplaceId: "EBAY_US",
            name: "B",
            categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
          },
        ],
      });
    }
    if (url.pathname === "/sell/account/v1/payment_policy") {
      return json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p-1", marketplaceId: "EBAY_US" }] });
    }
    if (url.pathname === "/sell/account/v1/return_policy") {
      return json({ total: 1, returnPolicies: [{ returnPolicyId: "r-1", marketplaceId: "EBAY_US" }] });
    }
    return undefined;
  });
  try {
    await assert.rejects(
      () => ensureEbayBusinessPolicies({ payload, marketplaceId: "EBAY_US", terms: terms() }),
      /EBAY_BUSINESS_POLICY_SELECTION_REQUIRED:FULFILLMENT:2/u,
    );
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    restore();
  }
});

test("eBay policy bootstrap honours an operator-asserted policy id", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname === "/sell/account/v1/fulfillment_policy") {
      return json({
        total: 2,
        fulfillmentPolicies: [
          { fulfillmentPolicyId: "f-1", marketplaceId: "EBAY_US", name: "A" },
          { fulfillmentPolicyId: "f-2", marketplaceId: "EBAY_US", name: "B" },
        ],
      });
    }
    if (url.pathname === "/sell/account/v1/payment_policy") {
      return json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p-1", marketplaceId: "EBAY_US" }] });
    }
    if (url.pathname === "/sell/account/v1/return_policy") {
      return json({ total: 1, returnPolicies: [{ returnPolicyId: "r-1", marketplaceId: "EBAY_US" }] });
    }
    return undefined;
  });
  try {
    const result = await ensureEbayBusinessPolicies({
      payload,
      marketplaceId: "EBAY_US",
      terms: terms(),
      expectedPolicyIds: { fulfillment: "f-2" },
    });
    assert.equal(result.fulfillmentPolicyId, "f-2");
    assert.equal(result.reusedPolicyIds.fulfillment, "f-2");
    assert.equal(result.providerWrites, 0);
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    restore();
  }
});

test("eBay policy bootstrap rejects malformed terms before any provider call", async () => {
  const { calls, restore } = withFetch(() => undefined);
  try {
    const badTerms = terms();
    badTerms.fulfillment.shippingOptions = [];
    await assert.rejects(
      () => ensureEbayBusinessPolicies({ payload, marketplaceId: "EBAY_US", terms: badTerms }),
      /EBAY_BUSINESS_POLICY_TERMS_INVALID:fulfillment\.shippingOptions/u,
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("eBay policy bootstrap fails closed when a create response carries no policy id", async () => {
  const { restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "GET") {
      if (url.pathname === "/sell/account/v1/fulfillment_policy") {
        return json({ total: 0, fulfillmentPolicies: [] });
      }
      if (url.pathname === "/sell/account/v1/payment_policy") {
        return json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p-1", marketplaceId: "EBAY_US" }] });
      }
      return json({ total: 1, returnPolicies: [{ returnPolicyId: "r-1", marketplaceId: "EBAY_US" }] });
    }
    return json({}, 201);
  });
  try {
    await assert.rejects(
      () => ensureEbayBusinessPolicies({ payload, marketplaceId: "EBAY_US", terms: terms() }),
      /EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED:FULFILLMENT/u,
    );
  } finally {
    restore();
  }
});

test("eBay policy bootstrap reports the provider rejection code without resaving", async () => {
  const { restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "GET") {
      if (url.pathname === "/sell/account/v1/fulfillment_policy") {
        return json({ total: 0, fulfillmentPolicies: [] });
      }
      if (url.pathname === "/sell/account/v1/payment_policy") {
        return json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p-1", marketplaceId: "EBAY_US" }] });
      }
      return json({ total: 1, returnPolicies: [{ returnPolicyId: "r-1", marketplaceId: "EBAY_US" }] });
    }
    return json({ errors: [{ errorId: 25002, message: "provider text" }] }, 400);
  });
  try {
    await assert.rejects(
      () => ensureEbayBusinessPolicies({ payload, marketplaceId: "EBAY_US", terms: terms() }),
      /EBAY_BUSINESS_POLICY_CREATE_FAILED:FULFILLMENT:HTTP_400:ERROR_25002/u,
    );
  } finally {
    restore();
  }
});

test("eBay policy bootstrap cannot create while the transport is read-only", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname === "/sell/account/v1/fulfillment_policy") {
      return json({ total: 0, fulfillmentPolicies: [] });
    }
    if (url.pathname === "/sell/account/v1/payment_policy") {
      return json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p-1", marketplaceId: "EBAY_US" }] });
    }
    return json({ total: 1, returnPolicies: [{ returnPolicyId: "r-1", marketplaceId: "EBAY_US" }] });
  });
  try {
    await assert.rejects(
      () => runWithProviderReadOnlyTransport(() => ensureEbayBusinessPolicies({
        payload,
        marketplaceId: "EBAY_US",
        terms: terms(),
      })),
      /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/u,
    );
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    restore();
  }
});

test("eBay inventory location bootstrap creates the operator supplied location once", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "GET") return json({ total: 0, locations: [] });
    assert.equal(url.pathname, "/sell/inventory/v1/location/sellerpilot-seoul-warehouse");
    return new Response(null, { status: 204 });
  });
  try {
    const result = await ensureEbayInventoryLocation({
      payload,
      terms: locationTerms(),
    });
    assert.equal(result.merchantLocationKey, "sellerpilot-seoul-warehouse");
    assert.equal(result.created, true);
    const write = calls.find((call) => call.method === "POST");
    assert.ok(write);
    assert.deepEqual(write.body, {
      name: "SellerPilot Seoul Warehouse",
      location: {
        address: {
          addressLine1: "12 Operator Supplied Street",
          city: "Seoul",
          stateOrProvince: "Seoul",
          postalCode: "04524",
          country: "KR",
        },
      },
      locationTypes: ["WAREHOUSE"],
    });
  } finally {
    restore();
  }
});

test("eBay inventory location bootstrap reuses an existing enabled location", async () => {
  const { calls, restore } = withFetch(() => json({
    total: 1,
    locations: [{
      merchantLocationKey: "sellerpilot-seoul-warehouse",
      merchantLocationStatus: "ENABLED",
      location: { address: { country: "KR" } },
    }],
  }));
  try {
    const result = await ensureEbayInventoryLocation({
      payload,
      terms: locationTerms(),
    });
    assert.equal(result.created, false);
    assert.equal(result.addressCountry, "KR");
    assert.deepEqual(result.existingLocationKeys, ["sellerpilot-seoul-warehouse"]);
    assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  } finally {
    restore();
  }
});

test("eBay inventory location bootstrap refuses to write on an unproven listing", async () => {
  const { calls, restore } = withFetch(() => json({
    total: 3,
    locations: [{
      merchantLocationKey: "other-warehouse",
      merchantLocationStatus: "ENABLED",
      location: { address: { country: "KR" } },
    }],
  }));
  try {
    await assert.rejects(
      () => ensureEbayInventoryLocation({ payload, terms: locationTerms() }),
      /EBAY_INVENTORY_LOCATION_GET_UNVERIFIED:PAGE_INCOMPLETE/u,
    );
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    restore();
  }
});

test("eBay inventory location bootstrap refuses a disabled requested key", async () => {
  const { calls, restore } = withFetch(() => json({
    total: 1,
    locations: [{
      merchantLocationKey: "sellerpilot-seoul-warehouse",
      merchantLocationStatus: "DISABLED",
      location: { address: { country: "KR" } },
    }],
  }));
  try {
    await assert.rejects(
      () => ensureEbayInventoryLocation({ payload, terms: locationTerms() }),
      /EBAY_INVENTORY_LOCATION_DISABLED:sellerpilot-seoul-warehouse/u,
    );
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    restore();
  }
});

test("eBay inventory location bootstrap validates the address before any provider call", async () => {
  const { calls, restore } = withFetch(() => undefined);
  try {
    const badLocation = locationTerms();
    (badLocation.address as { country: string }).country = "KOR";
    await assert.rejects(
      () => ensureEbayInventoryLocation({ payload, terms: badLocation }),
      /EBAY_INVENTORY_LOCATION_INPUT_INVALID:address\.country/u,
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("eBay policy bootstrap refuses an operator-asserted id eBay no longer returns", async () => {
  const { calls, restore } = withFetch((call) => {
    const url = new URL(call.url);
    if (url.pathname === "/sell/account/v1/fulfillment_policy") {
      return json({
        total: 1,
        fulfillmentPolicies: [{ fulfillmentPolicyId: "f-other", marketplaceId: "EBAY_US" }],
      });
    }
    if (url.pathname === "/sell/account/v1/payment_policy") {
      return json({ total: 1, paymentPolicies: [{ paymentPolicyId: "p-1", marketplaceId: "EBAY_US" }] });
    }
    return json({ total: 1, returnPolicies: [{ returnPolicyId: "r-1", marketplaceId: "EBAY_US" }] });
  });
  try {
    await assert.rejects(
      () => ensureEbayBusinessPolicies({
        payload,
        marketplaceId: "EBAY_US",
        terms: terms(),
        expectedPolicyIds: { fulfillment: "f-deleted" },
      }),
      /EBAY_BUSINESS_POLICY_EXPECTED_MISSING:FULFILLMENT/u,
    );
    assert.equal(calls.some((call) => call.method === "POST"), false);
  } finally {
    restore();
  }
});

test("the bootstrap admin route authenticates first and persists through the handoff RPC", async () => {
  const route = await readFile(
    new URL("../app/api/admin/ebay-account-bootstrap/route.ts", import.meta.url),
    "utf8",
  );
  const authenticate = route.indexOf("authenticateAdminRequest(request)");
  const policies = route.indexOf("ensureEbayBusinessPolicies({");
  const location = route.indexOf("ensureEbayInventoryLocation({");
  const persist = route.indexOf("rpc(LISTING_HANDOFF_PUT_RPC");

  assert.ok(authenticate > 0);
  assert.ok(policies > authenticate);
  assert.ok(location > authenticate);
  assert.ok(persist > policies && persist > location);
  assert.match(route, /export const runtime = "nodejs"/u);
  assert.match(route, /bootstrapSchema\.safeParse/u);
  // The route may only write through the bootstrap module, never directly.
  assert.doesNotMatch(route, /from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/channels\/protocols"/u);
  assert.doesNotMatch(route, /sell\/account\/v1|sell\/inventory\/v1/u);
  // No invented business value may live in the route.
  // A stored id that eBay no longer returns must not dead-lock the operator.
  assert.match(route, /EBAY_BUSINESS_POLICY_EXPECTED_MISSING/u);
  assert.match(route, /discardedStoredPolicyIds/u);
  assert.match(route, /ACTIVE_CREDENTIAL_RPC = "sellerpilot_get_active_credential_secret"/u);
  assert.doesNotMatch(route, /Teheran-ro|sellerpilot-seoul|USPSPriority|CREDIT_CARD|: "BUYER"/u);
});
