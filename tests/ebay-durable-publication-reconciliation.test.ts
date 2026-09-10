import assert from "node:assert/strict";
import test from "node:test";

import {
  EBAY_PUBLICATION_RECONCILIATION_CONTRACT,
  executeEbayPublicationReconciliation,
  type EbayPublicationReconciliationBinding,
} from "../lib/channels/ebay-publication-reconciliation";
import type { ExecuteInput } from "../lib/product-registration/execution-shared";

const sku = "sellerpilot-ebay-009";
const offerId = "offer-009";
const listingId = "110000000009";
const credentialId = "00000000-0000-4000-8000-000000000903";
const attemptId = "00000000-0000-4000-8000-000000000902";
const sourceJobId = "00000000-0000-4000-8000-000000000901";
const fingerprint = "9".repeat(64);
const storedEias = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const otherEias = "WlRYV1ZVVFNSUVBPTk1MS0pJSEdGRURDQUE=";

function arguments_() {
  return {
    sku,
    offerId,
    marketplaceId: "EBAY_US",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "en-US",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 1,
    inventoryItem: {
      condition: "NEW",
      availability: { shipToLocationAvailability: { quantity: 2 } },
      product: {
        title: "Durably reconciled eBay item",
        description: "Approved inventory description",
        imageUrls: ["https://cdn.example.com/ebay-009.jpg"],
        aspects: { Color: ["Blue"] },
      },
    },
    offer: {
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      categoryId: "1234",
      listingDescription:
        '<p>Approved offer description</p><img src="https://cdn.example.com/ebay-009.jpg">',
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

function input(): ExecuteInput {
  return {
    channel: "ebay",
    operation: "listing.create",
    payload: {
      access_token: "current-access-token",
      marketplace_id: "EBAY_US",
      provider_account_identity_version: "v1",
      provider_account_subject: `ebay:eias:${storedEias}`,
    },
    arguments: arguments_(),
    environment: "production",
  };
}

function binding(overrides: Partial<EbayPublicationReconciliationBinding> = {}) {
  return {
    contract: EBAY_PUBLICATION_RECONCILIATION_CONTRACT,
    sourceJobId,
    attemptId,
    credentialId,
    sku,
    marketplaceId: "EBAY_US",
    offerId,
    lastStage: "publish",
    requestFingerprint: fingerprint,
    ...overrides,
  } as EbayPublicationReconciliationBinding;
}

function getUserXml(eias: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>seller-fixture</UserID><EIASToken>${eias}</EIASToken></User></GetUserResponse>`;
}

function installProvider(options: { currentEias?: string; returnedOfferId?: string } = {}) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/ws/api.dll") {
      return new Response(getUserXml(options.currentEias ?? storedEias), {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    if (url.pathname.endsWith("/offer") && method === "GET" && !url.pathname.endsWith(`/offer/${offerId}`)) {
      return Response.json({
        total: 1,
        offers: [{
          offerId: options.returnedOfferId ?? offerId,
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
        }],
      });
    }
    if (url.pathname.endsWith(`/offer/${offerId}`) && method === "GET") {
      return Response.json({
        ...arguments_().offer,
        offerId: options.returnedOfferId ?? offerId,
        status: "PUBLISHED",
        listing: { listingId, listingStatus: "ACTIVE" },
      });
    }
    if (url.pathname.endsWith(`/inventory_item/${sku}`) && method === "GET") {
      return Response.json(arguments_().inventoryItem);
    }
    throw new Error(`Unexpected provider call: ${method} ${url.pathname}`);
  };
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

test("durable eBay recovery retries the same official GET lineage and never republishes", async () => {
  const provider = installProvider();
  try {
    const first = await executeEbayPublicationReconciliation(input(), binding());
    const second = await executeEbayPublicationReconciliation(input(), binding());
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.remoteId, listingId);
    assert.equal(second.remoteId, listingId);
    assert.deepEqual(first.remoteState?.resources, {
      offerId,
      sku,
      marketplaceId: "EBAY_US",
      listingId,
    });
    assert.deepEqual(provider.calls, [
      "POST /ws/api.dll",
      `GET /sell/inventory/v1/offer/${offerId}`,
      `GET /sell/inventory/v1/inventory_item/${sku}`,
      "POST /ws/api.dll",
      `GET /sell/inventory/v1/offer/${offerId}`,
      `GET /sell/inventory/v1/inventory_item/${sku}`,
    ]);
    assert.equal(provider.calls.some((call) => /\/publish$/u.test(call)), false);
    assert.equal(provider.calls.some((call) => call === "POST /sell/inventory/v1/offer"), false);
    assert.equal(provider.calls.some((call) => call.startsWith("PUT ")), false);
  } finally {
    provider.restore();
  }
});

test("durable eBay recovery blocks a different current seller before offer lookup", async () => {
  const provider = installProvider({ currentEias: otherEias });
  try {
    await assert.rejects(
      () => executeEbayPublicationReconciliation(input(), binding()),
      /PROVIDER_ACCOUNT_IDENTITY_MISMATCH/u,
    );
    assert.deepEqual(provider.calls, ["POST /ws/api.dll"]);
  } finally {
    provider.restore();
  }
});

test("durable eBay recovery blocks a different returned offer identity", async () => {
  const provider = installProvider({ returnedOfferId: "offer-other" });
  try {
    const recovered = await executeEbayPublicationReconciliation(input(), binding());
    assert.equal(recovered.ok, false);
    assert.match(JSON.stringify(recovered), /EBAY_PUBLICATION_IDENTITY_UNVERIFIED/u);
    assert.equal(provider.calls.some((call) => /\/publish$/u.test(call)), false);
  } finally {
    provider.restore();
  }
});

test("durable eBay recovery finds the exact offer after CREATE response loss without offerId", async () => {
  const provider = installProvider();
  try {
    const lost = input();
    delete lost.arguments.offerId;
    const recovered = await executeEbayPublicationReconciliation(
      lost,
      binding({ offerId: null, lastStage: "offer" }),
    );
    assert.equal(recovered.ok, true);
    assert.equal(recovered.remoteId, listingId);
    assert.equal(provider.calls.some((call) => call === "GET /sell/inventory/v1/offer"), true);
    assert.equal(provider.calls.some((call) => /\/publish$/u.test(call)), false);
    assert.equal(provider.calls.some((call) => call === "POST /sell/inventory/v1/offer"), false);
  } finally {
    provider.restore();
  }
});

test("durable eBay recovery rejects a DB binding that does not match the immutable request", async () => {
  const provider = installProvider();
  try {
    await assert.rejects(
      () => executeEbayPublicationReconciliation(
        input(),
        binding({ offerId: "offer-other" }),
      ),
      /EBAY_PUBLICATION_RECONCILIATION_BINDING_INVALID/u,
    );
    assert.deepEqual(provider.calls, []);
  } finally {
    provider.restore();
  }
});
