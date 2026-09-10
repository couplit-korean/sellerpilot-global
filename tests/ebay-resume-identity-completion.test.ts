import assert from "node:assert/strict";
import test from "node:test";

import { executeChannelOperation } from "../lib/channels/operations";
import { processCommerceGatewayJob } from "../scripts/commerce-gateway-job.mjs";
import { requestWithTransientRetry } from "../scripts/worker-lifecycle-retry.mjs";

const sku = "sellerpilot-ebay-008";
const offerId = "offer-current";
const listingId = "110000000008";
const storedEias = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const otherEias = "WlRYV1ZVVFNSUVBPTk1MS0pJSEdGRURDQUE=";

function createArguments(savedOfferId?: string) {
  return {
    sku,
    ...(savedOfferId ? { offerId: savedOfferId } : {}),
    publish: true,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 0,
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 2 } },
      product: {
        title: "Verified eBay item",
        description: "Verified product description",
        imageUrls: ["https://cdn.example.com/item.jpg"],
        aspects: { Color: ["Blue"] },
      },
    },
    offer: {
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      categoryId: "1234",
      listingDescription: "Verified product description",
      availableQuantity: 2,
      pricingSummary: { price: { value: "29.50", currency: "USD" } },
      merchantLocationKey: "warehouse",
      listingPolicies: {
        fulfillmentPolicyId: "f1",
        paymentPolicyId: "p1",
        returnPolicyId: "r1",
      },
    },
  };
}

function credential(eias = storedEias) {
  return {
    access_token: "fixture-current-access-token",
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    marketplace_id: "EBAY_US",
    provider_account_identity_version: "v1",
    provider_account_subject: `ebay:eias:${eias}`,
  };
}

function getUserXml(eias: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>seller-fixture</UserID><EIASToken>${eias}</EIASToken></User></GetUserResponse>`;
}

type ProviderFixture = {
  savedOfferId?: string;
  remoteOfferId?: string;
  remoteSku?: string;
  remoteMarketplaceId?: string;
  currentEias?: string;
  inventoryInitiallyPresent?: boolean;
};

function installProvider(fixture: ProviderFixture = {}) {
  const state: {
    inventory?: Record<string, unknown>;
    offer?: Record<string, unknown>;
    published: boolean;
    writes: string[];
    calls: string[];
  } = {
    inventory: fixture.inventoryInitiallyPresent === false
      ? undefined
      : createArguments().inventoryItem,
    offer: fixture.remoteOfferId === undefined
      ? createArguments().offer
      : fixture.remoteOfferId
        ? createArguments().offer
        : undefined,
    published: false,
    writes: [],
    calls: [],
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}`);
    if (method !== "GET" && url.pathname !== "/ws/api.dll") {
      state.writes.push(`${method} ${url.pathname}`);
    }
    if (url.pathname === "/ws/api.dll") {
      return new Response(getUserXml(fixture.currentEias ?? storedEias), {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    if (url.pathname.endsWith("/get_default_category_tree_id")) {
      return Response.json({ categoryTreeId: "0" });
    }
    if (url.pathname.includes("get_item_aspects_for_category")) {
      return Response.json({
        aspects: [{
          localizedAspectName: "Color",
          aspectConstraint: {
            aspectRequired: true,
            aspectMode: "SELECTION_ONLY",
            itemToAspectCardinality: "SINGLE",
          },
          aspectValues: [{ localizedValue: "Blue" }],
        }],
      });
    }
    if (url.pathname.includes("get_item_condition_policies")) {
      return Response.json({
        itemConditionPolicies: [{
          categoryId: "1234",
          categoryTreeId: "0",
          itemConditionRequired: true,
          itemConditions: [{ conditionId: "1000" }],
        }],
      });
    }
    if (url.pathname.endsWith("/fulfillment_policy")) {
      return Response.json({
        total: 1,
        fulfillmentPolicies: [{ fulfillmentPolicyId: "f1", name: "Ship", marketplaceId: "EBAY_US" }],
      });
    }
    if (url.pathname.endsWith("/payment_policy")) {
      return Response.json({
        total: 1,
        paymentPolicies: [{ paymentPolicyId: "p1", name: "Pay", marketplaceId: "EBAY_US" }],
      });
    }
    if (url.pathname.endsWith("/return_policy")) {
      return Response.json({
        total: 1,
        returnPolicies: [{
          returnPolicyId: "r1",
          name: "Return",
          marketplaceId: "EBAY_US",
          returnsAccepted: true,
          returnPeriod: { value: 30, unit: "DAY" },
          returnShippingCostPayer: "BUYER",
        }],
      });
    }
    if (url.pathname.endsWith("/location")) {
      return Response.json({
        total: 1,
        locations: [{
          merchantLocationKey: "warehouse",
          merchantLocationStatus: "ENABLED",
          location: { address: { country: "KR" } },
        }],
      });
    }
    if (url.pathname.endsWith(`/inventory_item/${encodeURIComponent(sku)}`)) {
      if (method === "PUT") {
        state.inventory = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      }
      if (!state.inventory) {
        return Response.json({ errors: [{ errorId: 25710, domain: "API_INVENTORY" }] }, { status: 400 });
      }
      return Response.json(state.inventory);
    }
    if (url.pathname.endsWith("/offer") && method === "GET") {
      const remoteOfferId = fixture.remoteOfferId ?? offerId;
      if (!remoteOfferId || !state.offer) return Response.json({ total: 0, offers: [] });
      return Response.json({
        total: 1,
        offers: [{
          offerId: remoteOfferId,
          sku: fixture.remoteSku ?? sku,
          marketplaceId: fixture.remoteMarketplaceId ?? "EBAY_US",
          format: "FIXED_PRICE",
        }],
      });
    }
    if (url.pathname.endsWith("/offer") && method === "POST") {
      state.offer = JSON.parse(String(init?.body));
      return Response.json({ offerId }, { status: 201 });
    }
    if (url.pathname.endsWith(`/offer/${offerId}`) && method === "GET") {
      return Response.json({
        ...state.offer,
        offerId,
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        status: state.published ? "PUBLISHED" : "UNPUBLISHED",
        ...(state.published ? { listing: { listingId, listingStatus: "ACTIVE" } } : {}),
      });
    }
    if (url.pathname.endsWith(`/offer/${offerId}/publish`) && method === "POST") {
      state.published = true;
      return Response.json({ listingId });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
  return { state, restore: () => { globalThis.fetch = original; } };
}

async function execute(arguments_ = createArguments()) {
  return executeChannelOperation({
    channel: "ebay",
    operation: "listing.create",
    payload: credential(),
    arguments: arguments_,
    environment: "sandbox",
  });
}

test("eBay create resume rejects a stored offerId that differs from the current exact SKU and marketplace offer", async () => {
  const provider = installProvider({ remoteOfferId: offerId });
  try {
    const result = await execute(createArguments("offer-stored-other"));
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /EBAY_SAVED_OFFER_ID_MISMATCH/u);
    assert.deepEqual(provider.state.writes, []);
  } finally {
    provider.restore();
  }
});

for (const [name, fixture] of [
  ["SKU", { remoteOfferId: offerId, remoteSku: "other-sku" }],
  ["marketplace", { remoteOfferId: offerId, remoteMarketplaceId: "EBAY_GB" }],
] as const) {
  test(`eBay create resume rejects a stored offer whose ${name} differs`, async () => {
    const provider = installProvider(fixture);
    try {
      const result = await execute(createArguments(offerId));
      assert.equal(result.ok, false);
      assert.deepEqual(provider.state.writes, []);
    } finally {
      provider.restore();
    }
  });
}

test("eBay create resume rejects a current provider seller that differs from the stored credential identity", async () => {
  const provider = installProvider({ remoteOfferId: offerId, currentEias: otherEias });
  try {
    await assert.rejects(
      () => execute(createArguments(offerId)),
      /PROVIDER_ACCOUNT_IDENTITY_MISMATCH/u,
    );
    assert.deepEqual(provider.state.writes, []);
  } finally {
    provider.restore();
  }
});

test("eBay create resume publishes the matching stored offer without recreating inventory or offer", async () => {
  const provider = installProvider({ remoteOfferId: offerId });
  try {
    const result = await execute(createArguments(offerId));
    assert.equal(result.ok, true);
    assert.deepEqual(provider.state.writes, [`POST /sell/inventory/v1/offer/${offerId}/publish`]);
    assert.equal(provider.state.published, true);
  } finally {
    provider.restore();
  }
});

test("eBay create resume cannot recreate a saved offer that is now absent", async () => {
  const provider = installProvider({ remoteOfferId: "", inventoryInitiallyPresent: false });
  try {
    const result = await execute(createArguments(offerId));
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /EBAY_SAVED_OFFER_ID_MISMATCH/u);
    assert.deepEqual(provider.state.writes, []);
  } finally {
    provider.restore();
  }
});

test("eBay worker retries one lost internal completion response with the same official readback and never republishes", async () => {
  const provider = installProvider({ remoteOfferId: "", inventoryInitiallyPresent: false });
  const jobId = "00000000-0000-4000-8000-000000000801";
  const claimToken = "00000000-0000-4000-8000-000000000802";
  const completionBodies: string[] = [];
  let completionRequests = 0;
  const persistWorkerCompletion = async (path: string, payload: unknown) => {
    if (path === "/api/channel-gateway/worker/begin-mutation") {
      return Response.json({ status: "running" });
    }
    assert.equal(path, "/api/channel-gateway/worker/complete");
    return requestWithTransientRetry({
      request: async () => {
        completionRequests += 1;
        completionBodies.push(JSON.stringify(payload));
        if (completionRequests === 1) throw new TypeError("internal completion response lost");
        return Response.json({ status: "completed_replay" });
      },
      delay: async () => {},
      graceMs: 10_000,
      terminalStatuses: [401, 409],
      label: "fixture completion",
      now: () => completionRequests * 10,
    });
  };
  try {
    await processCommerceGatewayJob({
      id: jobId,
      claim_token: claimToken,
      attempt_id: "00000000-0000-4000-8000-000000000803",
      credential_id: "00000000-0000-4000-8000-000000000804",
      credential_version: 1,
      credential_fingerprint: "aa".repeat(16),
      channel: "ebay",
      operation: "listing.create",
      environment: "sandbox",
      credential: credential(),
      request: { arguments: createArguments() },
    }, {
      createGatewayHeartbeat: () => ({
        start: async () => {},
        assertHealthy: async () => {},
        stop: async () => {},
      }),
      persistWorkerCompletion,
    });

    assert.equal(completionRequests, 2);
    assert.equal(completionBodies[0], completionBodies[1]);
    const completion = JSON.parse(completionBodies[1]) as Record<string, unknown>;
    assert.equal(completion.status, "succeeded");
    assert.deepEqual((completion.result as Record<string, unknown>).remoteState
      && ((completion.result as Record<string, unknown>).remoteState as Record<string, unknown>).resources, {
      offerId,
      sku,
      marketplaceId: "EBAY_US",
      listingId,
    });
    assert.equal(provider.state.writes.filter((value) => value.startsWith("PUT ")).length, 1);
    assert.equal(provider.state.writes.filter((value) => value === "POST /sell/inventory/v1/offer").length, 1);
    assert.equal(provider.state.writes.filter((value) => value.endsWith(`/offer/${offerId}/publish`)).length, 1);
  } finally {
    provider.restore();
  }
});
