import assert from "node:assert/strict";
import test from "node:test";

import { executeChannelOperation } from "../lib/channels/operations";
import { externalDetailApprovalBindingFromPublishContext } from "../lib/channels/local-channel-executor";

const sku = "sellerpilot-ebay-resume-fixture";
const listingId = "110000000001";

function createArguments() {
  return {
    sku,
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
        title: "Verified item",
        description: "Product description",
        imageUrls: ["https://cdn.example.com/item.jpg"],
        aspects: { Color: ["Blue"] },
      },
    },
    offer: {
      sku: "ignored-and-rebound-by-adapter",
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      categoryId: "1234",
      listingDescription: "Product description",
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

function configResponse(url: URL, returnPolicy: Record<string, unknown>) {
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
    return Response.json({ total: 1, returnPolicies: [returnPolicy] });
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
  return null;
}

async function execute() {
  return executeChannelOperation({
    channel: "ebay",
    operation: "listing.create",
    payload: { access_token: "fixture-current-credential", marketplace_id: "EBAY_US" },
    arguments: createArguments(),
    environment: "sandbox",
  });
}

for (const [name, returnPolicy] of [
  ["another account", {
    returnPolicyId: "r-other-account",
    name: "Other account return policy",
    marketplaceId: "EBAY_US",
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    returnShippingCostPayer: "BUYER",
  }],
  ["another marketplace", {
    returnPolicyId: "r1",
    name: "GB return policy",
    marketplaceId: "EBAY_GB",
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    returnShippingCostPayer: "BUYER",
  }],
] as const) {
  test(`eBay rejects a selected return policy returned for ${name} before mutation`, async () => {
    const original = globalThis.fetch;
    const writes: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      const configured = configResponse(url, returnPolicy);
      if (configured) return configured;
      if (url.pathname.includes("/inventory_item/")) {
        return Response.json({ errors: [{ errorId: 25710, domain: "API_INVENTORY" }] }, { status: 400 });
      }
      if (url.pathname.endsWith("/offer")) return Response.json({ total: 0, offers: [] });
      throw new Error(`Unexpected ${method} ${url.pathname}`);
    };
    try {
      const result = await execute();
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /EBAY_RETURN_POLICY_UNVERIFIED/u);
      assert.deepEqual(writes, []);
    } finally {
      globalThis.fetch = original;
    }
  });
}

test("eBay claim preparation rejects a stale external-detail approval revision", () => {
  const digest = "b".repeat(64);
  assert.throws(
    () => externalDetailApprovalBindingFromPublishContext({
      externalDetailChannel: "ebay",
      externalDetailImport: { approvalRevision: 8, contentSha256: digest },
      externalDetailSnapshot: { approvalRevision: 7, contentSha256: digest },
    }),
    /EXTERNAL_DETAIL_APPROVAL_REVISION_INVALID/u,
  );
});

type DropPhase = "inventory" | "offer" | "publish";

function installStatefulProvider(dropPhase: DropPhase) {
  const state: {
    inventory?: Record<string, unknown>;
    offer?: Record<string, unknown>;
    offerId?: string;
    published: boolean;
    dropped: boolean;
    writes: string[];
    offerCollectionReads: number;
  } = {
    published: false,
    dropped: false,
    writes: [],
    offerCollectionReads: 0,
  };
  const returnPolicy = {
    returnPolicyId: "r1",
    name: "Return",
    marketplaceId: "EBAY_US",
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    returnShippingCostPayer: "BUYER",
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const configured = configResponse(url, returnPolicy);
    if (configured) return configured;
    if (method !== "GET") state.writes.push(`${method} ${url.pathname}`);

    if (url.pathname.endsWith(`/inventory_item/${encodeURIComponent(sku)}`)) {
      if (method === "PUT") {
        state.inventory = JSON.parse(String(init?.body));
        if (dropPhase === "inventory" && !state.dropped) {
          state.dropped = true;
          throw new TypeError("inventory response dropped after remote acceptance");
        }
        return new Response(null, { status: 204 });
      }
      if (!state.inventory) {
        return Response.json({ errors: [{ errorId: 25710, domain: "API_INVENTORY" }] }, { status: 400 });
      }
      return Response.json(state.inventory);
    }

    if (url.pathname.endsWith("/offer") && method === "GET") {
      state.offerCollectionReads += 1;
      if (!state.offerId) return Response.json({ total: 0, offers: [] });
      if (dropPhase === "offer" && state.dropped && state.offerCollectionReads === 2) {
        return Response.json({ total: 0, offers: [] });
      }
      return Response.json({
        total: 1,
        offers: [{ offerId: state.offerId, sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE" }],
      });
    }
    if (url.pathname.endsWith("/offer") && method === "POST") {
      state.offer = JSON.parse(String(init?.body));
      state.offerId = "offer-1";
      if (dropPhase === "offer" && !state.dropped) {
        state.dropped = true;
        throw new TypeError("offer response dropped after remote acceptance");
      }
      return Response.json({ offerId: state.offerId }, { status: 201 });
    }
    if (url.pathname.endsWith("/offer/offer-1") && method === "GET") {
      return Response.json({
        ...state.offer,
        offerId: state.offerId,
        status: state.published ? "PUBLISHED" : "UNPUBLISHED",
        ...(state.published ? { listing: { listingId, listingStatus: "ACTIVE" } } : {}),
      });
    }
    if (url.pathname.endsWith("/offer/offer-1/publish") && method === "POST") {
      state.published = true;
      if (dropPhase === "publish" && !state.dropped) {
        state.dropped = true;
        throw new TypeError("publish response dropped after remote acceptance");
      }
      return Response.json({ listingId });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
  return { state, restore: () => { globalThis.fetch = original; } };
}

for (const dropPhase of ["inventory", "offer", "publish"] as const) {
  test(`eBay retry after accepted ${dropPhase} response loss reuses remote lineage`, async () => {
    const provider = installStatefulProvider(dropPhase);
    try {
      if (dropPhase === "offer") {
        const first = await execute();
        assert.equal(first.ok, false);
        assert.match(JSON.stringify(first), /EBAY_OFFER_RECONCILE_MISSING/u);
      } else {
        await assert.rejects(() => execute(), /response dropped after remote acceptance/u);
      }

      const second = await execute();
      assert.equal(second.ok, true);
      assert.equal(second.remoteId, listingId);
      assert.equal(second.steps.some((step) => step.name === "listing-create-content-readback" && step.ok), true);
      assert.equal(provider.state.writes.filter((value) => value.startsWith("PUT ")).length, 1);
      assert.equal(provider.state.writes.filter((value) => value === "POST /sell/inventory/v1/offer").length, 1);
      assert.equal(provider.state.writes.filter((value) => value.endsWith("/offer/offer-1/publish")).length, 1);
    } finally {
      provider.restore();
    }
  });
}
