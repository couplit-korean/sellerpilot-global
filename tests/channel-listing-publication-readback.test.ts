import assert from "node:assert/strict";
import test from "node:test";
import {
  listingPublicationReadbackExpectation,
  readCoupangListingPublicationState,
  readEbayListingPublicationState,
  readSmartstoreListingPublicationState,
} from "../lib/channels/listing-publication-readback";
import { executeChannelOperation } from "../lib/channels/operations";
import type { RemoteResponse } from "../lib/channels/protocols";

const fingerprint = "a".repeat(64);

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return {
    response: Response.json(data, { status }),
    data,
    text: JSON.stringify(data),
  };
}

function coupangContents(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    contentsType: "IMAGE",
    contentDetails: [{ detailType: "IMAGE", content: `https://cdn.example.com/detail-${index + 1}.jpg` }],
  }));
}

function coupangSellerProduct(input: {
  requested: boolean;
  statusName: string;
  vendorItemId?: string;
  imageCount?: number;
}) {
  return {
    code: "SUCCESS",
    data: {
      sellerProductId: 987654321,
      requested: input.requested,
      statusName: input.statusName,
      items: [{
        ...(input.vendorItemId ? { vendorItemId: Number(input.vendorItemId) } : {}),
        contents: coupangContents(input.imageCount ?? 8),
      }],
    },
  };
}

function publicationArguments(intent: "safe_test" | "live", imageCount = 8) {
  return {
    publicationIntent: intent,
    publicationStateContract: "verified_remote_state_v1" as const,
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: imageCount,
  };
}

function detailHtml(count = 8) {
  return Array.from({ length: count }, (_, index) => (
    `<img src="https://cdn.example.com/detail-${index + 1}.jpg" alt="detail ${index + 1}" />`
  )).join("");
}

function smartstoreOriginProduct(input: {
  originStatus: string;
  channelStatus: string;
  imageCount?: number;
}) {
  return {
    originProductNo: 10000001,
    smartstoreChannelProductNo: 20000001,
    originProduct: {
      statusType: input.originStatus,
      detailContent: detailHtml(input.imageCount ?? 8),
    },
    smartstoreChannelProduct: {
      channelProductNo: 20000001,
      channelProductDisplayStatusType: input.channelStatus,
    },
  };
}

function ebayOffer(input: {
  status: "PUBLISHED" | "UNPUBLISHED";
  listingStatus?: string;
  marketplaceId?: string;
  imageCount?: number;
}) {
  return {
    offerId: "offer-123",
    sku: "SELLERPILOT-001",
    marketplaceId: input.marketplaceId ?? "EBAY_US",
    status: input.status,
    listingDescription: detailHtml(input.imageCount ?? 8),
    ...(input.status === "PUBLISHED"
      ? { listing: { listingId: "110000000001", listingStatus: input.listingStatus } }
      : {}),
  };
}

function ebayInventoryImages(count = 9) {
  return Array.from({ length: count }, (_, index) => `https://cdn.example.com/inventory-${index + 1}.jpg`);
}

function ebayCreateArguments(intent: "safe_test" | "live") {
  return {
    ...publicationArguments(intent),
    publicationExpectedLocale: "en-US",
    sku: "SELLERPILOT-001",
    inventoryItem: {
      availability: { shipToLocationAvailability: { quantity: 1 } },
      condition: "NEW",
      product: { title: "Verified item", imageUrls: ebayInventoryImages() },
    },
    offer: {
      sku: "SELLERPILOT-001",
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      listingDescription: detailHtml(),
      listingPolicies: {
        fulfillmentPolicyId: "fulfillment-1",
        paymentPolicyId: "payment-1",
        returnPolicyId: "return-1",
      },
      merchantLocationKey: "seoul-warehouse",
    },
  };
}

test("Coupang read-only publication boundary combines seller-product and vendor-item state", async () => {
  const calls: string[] = [];
  const expected = listingPublicationReadbackExpectation(publicationArguments("live"));
  assert.ok(expected);
  const readback = await readCoupangListingPublicationState({
    operation: "listing.create",
    intent: "live",
    remoteId: "987654321",
    expected,
    verifiedAt: "2026-08-29T22:00:00.000Z",
    readSellerProduct: async (sellerProductId) => {
      calls.push(`seller:${sellerProductId}`);
      return remote(coupangSellerProduct({ requested: true, statusName: "승인완료", vendorItemId: "4444" }));
    },
    readVendorItem: async (vendorItemId) => {
      calls.push(`vendor:${vendorItemId}`);
      return remote({ code: "SUCCESS", data: { sellerItemId: 3333, onSale: true } });
    },
  });
  assert.deepEqual(calls, ["seller:987654321", "vendor:4444"]);
  assert.equal(readback.failureCode, undefined);
  assert.equal(readback.state?.visibility, "live");
  assert.equal(readback.state?.providerStatus, "승인완료|requested=true|onSale=true");
  assert.deepEqual(readback.state?.resources, {
    sellerProductId: "987654321",
    vendorItemIds: ["4444"],
  });
  assert.equal(readback.state?.locale, "ko-KR");
  assert.equal(readback.state?.fingerprint, fingerprint);
  assert.equal(readback.state?.imageCount, 8);
  assert.equal(readback.state?.evidence.identityVerified, true);
  assert.equal(readback.state?.evidence.statusVerified, true);
  assert.equal(readback.state?.evidence.localeVerified, true);
  assert.equal(readback.state?.evidence.fingerprintVerified, true);
  assert.equal(readback.state?.evidence.imageCountVerified, true);
});

test("Coupang safe-test create forces requested false and verifies a non-public draft", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: String(init?.body ?? "") });
    if (method === "POST") return Response.json({ code: "SUCCESS", data: 987654321 });
    return Response.json(coupangSellerProduct({ requested: false, statusName: "임시저장" }));
  };
  try {
    const operation = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret", requested_by: "wing-user" },
      arguments: {
        ...publicationArguments("safe_test"),
        body: {
          sellerProductName: "안전 초안",
          requested: true,
          items: [{ contents: coupangContents() }],
        },
      },
      environment: "production",
    });
    assert.equal(JSON.parse(calls[0].body).requested, false);
    assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), [
      "POST /v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
      "GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/987654321",
      "GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/987654321",
    ]);
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "non_public");
    assert.equal(operation.remoteState?.imageCount, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang live create is not published until vendor-item onSale is read back", async () => {
  const originalFetch = globalThis.fetch;
  let sellerReadCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") return Response.json({ code: "SUCCESS", data: 987654321 });
    if (url.endsWith("/vendor-items/4444/inventories")) {
      return Response.json({ code: "SUCCESS", data: { sellerItemId: 3333, onSale: true } });
    }
    sellerReadCount += 1;
    return Response.json(coupangSellerProduct({ requested: true, statusName: "승인완료", vendorItemId: "4444" }));
  };
  try {
    const operation = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret", requested_by: "wing-user" },
      arguments: {
        ...publicationArguments("live"),
        body: { sellerProductName: "판매 상품", requested: false, items: [{ contents: coupangContents() }] },
      },
      environment: "production",
    });
    assert.equal(sellerReadCount, 2);
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "live");
    assert.deepEqual(operation.remoteState?.resources, {
      sellerProductId: "987654321",
      vendorItemIds: ["4444"],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang approval acceptance without a vendor item remains pending review", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => init?.method === "POST"
    ? Response.json({ code: "SUCCESS", data: 987654321 })
    : Response.json(coupangSellerProduct({ requested: true, statusName: "승인대기중" }));
  try {
    const operation = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret", requested_by: "wing-user" },
      arguments: {
        ...publicationArguments("live"),
        body: { sellerProductName: "심사 상품", requested: true, items: [{ contents: coupangContents() }] },
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, false);
    assert.equal(operation.remoteState?.visibility, "pending_review");
    assert.equal(operation.remoteState?.resources.sellerProductId, "987654321");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang listing stop requires an authoritative onSale false readback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => init?.method === "PUT"
    ? Response.json({ code: "SUCCESS" })
    : Response.json({ code: "SUCCESS", data: { sellerItemId: 3333, onSale: false } });
  try {
    const operation = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.stop",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: {
        vendorItemId: "4444",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedFingerprint: fingerprint,
        publicationExpectedImageCount: 0,
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "withdrawn");
    assert.deepEqual(operation.remoteState?.resources, { vendorItemId: "4444" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang refuses verified success when the detail readback is not exactly eight images", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => init?.method === "POST"
    ? Response.json({ code: "SUCCESS", data: 987654321 })
    : Response.json(coupangSellerProduct({ requested: false, statusName: "임시저장", imageCount: 7 }));
  try {
    const operation = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: "A00012345", access_key: "access", secret_key: "secret" },
      arguments: {
        ...publicationArguments("safe_test"),
        body: { sellerProductName: "이미지 불일치", items: [{ contents: coupangContents(7) }] },
      },
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.remoteState, undefined);
    assert.equal(operation.steps.at(-1)?.data.code, "COUPANG_PUBLICATION_READBACK_UNVERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore read-only publication boundary requires SALE and ON for live", async () => {
  const expected = listingPublicationReadbackExpectation(publicationArguments("live"));
  assert.ok(expected);
  let requestedId = "";
  const readback = await readSmartstoreListingPublicationState({
    operation: "listing.create",
    intent: "live",
    remoteId: "10000001",
    expected,
    verifiedAt: "2026-08-29T22:00:00.000Z",
    readOriginProduct: async (originProductNo) => {
      requestedId = originProductNo;
      return remote(smartstoreOriginProduct({ originStatus: "SALE", channelStatus: "ON" }));
    },
  });
  assert.equal(requestedId, "10000001");
  assert.equal(readback.failureCode, undefined);
  assert.equal(readback.state?.visibility, "live");
  assert.equal(readback.state?.providerStatus, "SALE|ON");
  assert.deepEqual(readback.state?.resources, {
    originProductNo: "10000001",
    smartstoreChannelProductNo: "20000001",
  });
  assert.equal(readback.state?.imageCount, 8);
});

test("SmartStore safe-test create writes SUSPENSION and verifies it after origin-product GET", async () => {
  const originalFetch = globalThis.fetch;
  let createBody: Record<string, unknown> = {};
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    if (url.endsWith("/v1/oauth2/token")) {
      return Response.json({ access_token: "naver-token", expires_in: 10_800 });
    }
    if (url.endsWith("/v2/products") && init?.method === "POST") {
      createBody = JSON.parse(String(init.body));
      return Response.json({ originProductNo: 10000001, smartstoreChannelProductNo: 20000001 });
    }
    return Response.json(smartstoreOriginProduct({ originStatus: "SUSPENSION", channelStatus: "SUSPENSION" }));
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: {
        ...publicationArguments("safe_test"),
        body: {
          originProduct: { statusType: "SALE", detailContent: detailHtml() },
          smartstoreChannelProduct: { channelProductDisplayStatusType: "ON" },
        },
      },
      environment: "production",
    });
    assert.equal((createBody.originProduct as Record<string, unknown>).statusType, "SUSPENSION");
    assert.equal(
      (createBody.smartstoreChannelProduct as Record<string, unknown>).channelProductDisplayStatusType,
      "SUSPENSION",
    );
    assert.equal(calls.filter((call) => call === "GET /external/v2/products/origin-products/10000001").length, 2);
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "non_public");
    assert.equal(operation.remoteState?.locale, "ko-KR");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore WAIT readback remains pending_review and is never counted as published", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "naver-token", expires_in: 10_800 });
    if (url.endsWith("/v2/products") && init?.method === "POST") {
      return Response.json({ originProductNo: 10000001, smartstoreChannelProductNo: 20000001 });
    }
    return Response.json(smartstoreOriginProduct({ originStatus: "WAIT", channelStatus: "WAIT" }));
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.create",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: {
        ...publicationArguments("live"),
        body: {
          originProduct: { detailContent: detailHtml() },
          smartstoreChannelProduct: {},
        },
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, false);
    assert.equal(operation.remoteState?.visibility, "pending_review");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore stop requires origin status SUSPENSION in the final GET", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "naver-token", expires_in: 10_800 });
    if (url.includes("/change-status")) return Response.json({});
    return Response.json(smartstoreOriginProduct({ originStatus: "SUSPENSION", channelStatus: "SUSPENSION" }));
  };
  try {
    const operation = await executeChannelOperation({
      channel: "smartstore",
      operation: "listing.stop",
      payload: { client_id: "client", client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze", token_type: "SELLER", account_id: "seller-uid" },
      arguments: {
        originProductNo: "10000001",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedFingerprint: fingerprint,
        publicationExpectedImageCount: 0,
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "withdrawn");
    assert.equal(operation.remoteState?.imageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore does not issue verified state when final detail HTML has seven unique images", async () => {
  const expected = listingPublicationReadbackExpectation(publicationArguments("live"));
  assert.ok(expected);
  const readback = await readSmartstoreListingPublicationState({
    operation: "listing.update",
    intent: "live",
    remoteId: "10000001",
    expected,
    readOriginProduct: async () => remote(smartstoreOriginProduct({
      originStatus: "SALE",
      channelStatus: "ON",
      imageCount: 7,
    })),
  });
  assert.equal(readback.state, undefined);
  assert.equal(readback.failureCode, "SMARTSTORE_PUBLICATION_READBACK_UNVERIFIED");
});

test("eBay read-only publication boundary binds getOffer to getInventoryItem", async () => {
  const expected = {
    locale: "de-DE",
    fingerprint,
    imageCount: 8,
  };
  const calls: string[] = [];
  const readback = await readEbayListingPublicationState({
    operation: "listing.create",
    intent: "live",
    remoteId: "110000000001",
    offerId: "offer-123",
    expected,
    verifiedAt: "2026-08-29T22:00:00.000Z",
    readOffer: async (offerId) => {
      calls.push(`offer:${offerId}`);
      return remote(ebayOffer({ status: "PUBLISHED", listingStatus: "ACTIVE", marketplaceId: "EBAY_DE" }));
    },
    readInventoryItem: async (sku) => {
      calls.push(`inventory:${sku}`);
      return remote({ product: { imageUrls: ebayInventoryImages() } });
    },
  });
  assert.deepEqual(calls, ["offer:offer-123", "inventory:SELLERPILOT-001"]);
  assert.equal(readback.failureCode, undefined);
  assert.equal(readback.resolvedRemoteId, "110000000001");
  assert.equal(readback.state?.visibility, "live");
  assert.equal(readback.state?.providerStatus, "PUBLISHED|ACTIVE");
  assert.equal(readback.state?.locale, "de-DE");
  assert.deepEqual(readback.state?.resources, {
    offerId: "offer-123",
    sku: "SELLERPILOT-001",
    marketplaceId: "EBAY_DE",
    listingId: "110000000001",
  });
});

test("eBay safe-test create keeps an unpublished offer even when legacy publish=true is supplied", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/inventory_item/") && method === "GET") {
      return Response.json({ product: { imageUrls: ebayInventoryImages() } });
    }
    if (url.endsWith("/offer") && method === "POST") return Response.json({ offerId: "offer-123" }, { status: 201 });
    if (url.endsWith("/offer/offer-123") && method === "GET") {
      return Response.json(ebayOffer({ status: "UNPUBLISHED" }));
    }
    return new Response(null, { status: 204 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: { ...ebayCreateArguments("safe_test"), publish: true },
      environment: "production",
    });
    assert.equal(calls.some((call) => call.url.endsWith("/publish")), false);
    assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), [
      "PUT /sell/inventory/v1/inventory_item/SELLERPILOT-001",
      "GET /sell/inventory/v1/inventory_item/SELLERPILOT-001",
      "POST /sell/inventory/v1/offer",
      "GET /sell/inventory/v1/offer/offer-123",
      "GET /sell/inventory/v1/offer/offer-123",
      "GET /sell/inventory/v1/inventory_item/SELLERPILOT-001",
    ]);
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteId, "offer-123");
    assert.equal(operation.remoteState?.visibility, "non_public");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay live create requires final PUBLISHED ACTIVE readback after publishOffer", async () => {
  const originalFetch = globalThis.fetch;
  let published = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/inventory_item/") && method === "GET") {
      return Response.json({ product: { imageUrls: ebayInventoryImages() } });
    }
    if (url.endsWith("/offer") && method === "POST") return Response.json({ offerId: "offer-123" }, { status: 201 });
    if (url.endsWith("/offer/offer-123") && method === "GET") {
      return Response.json(published
        ? ebayOffer({ status: "PUBLISHED", listingStatus: "ACTIVE" })
        : ebayOffer({ status: "UNPUBLISHED" }));
    }
    if (url.endsWith("/offer/offer-123/publish") && method === "POST") {
      published = true;
      return Response.json({ listingId: "110000000001" });
    }
    return new Response(null, { status: 204 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.create",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: { ...ebayCreateArguments("live"), publish: false },
      environment: "production",
    });
    assert.equal(published, true);
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteId, "110000000001");
    assert.equal(operation.remoteState?.visibility, "live");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay published acceptance without ACTIVE listing readback remains pending review", async () => {
  const readback = await readEbayListingPublicationState({
    operation: "listing.create",
    intent: "live",
    remoteId: "110000000001",
    offerId: "offer-123",
    expected: { locale: "en-US", fingerprint, imageCount: 8 },
    readOffer: async () => remote(ebayOffer({ status: "PUBLISHED" })),
    readInventoryItem: async () => remote({ product: { imageUrls: ebayInventoryImages() } }),
  });
  assert.equal(readback.state?.visibility, "pending_review");
  assert.equal(readback.state?.providerStatus, "PUBLISHED|NONE");
});

test("eBay listing update verifies the exact offer, SKU, locale, and live status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/inventory_item/") && method === "GET") {
      return Response.json({ product: { imageUrls: ebayInventoryImages() } });
    }
    if (url.endsWith("/offer/offer-123") && method === "GET") {
      return Response.json(ebayOffer({ status: "PUBLISHED", listingStatus: "ACTIVE" }));
    }
    return new Response(null, { status: 204 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.update",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        ...publicationArguments("live"),
        publicationExpectedLocale: "en-US",
        offerId: "offer-123",
        body: {
          sku: "SELLERPILOT-001",
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          listingDescription: detailHtml(),
          listingPolicies: {
            fulfillmentPolicyId: "fulfillment-1",
            paymentPolicyId: "payment-1",
            returnPolicyId: "return-1",
          },
          merchantLocationKey: "seoul-warehouse",
        },
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteId, "offer-123");
    assert.equal(operation.remoteState?.visibility, "live");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay withdraw is complete only after getOffer is UNPUBLISHED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/inventory_item/") && method === "GET") {
      return Response.json({ product: { imageUrls: ebayInventoryImages() } });
    }
    if (url.endsWith("/offer/offer-123") && method === "GET") {
      return Response.json(ebayOffer({ status: "UNPUBLISHED" }));
    }
    return new Response(null, { status: 204 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "ebay",
      operation: "listing.stop",
      payload: { access_token: "token", marketplace_id: "EBAY_US" },
      arguments: {
        offerId: "offer-123",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "en-US",
        publicationExpectedFingerprint: fingerprint,
        publicationExpectedImageCount: 0,
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "withdrawn");
    assert.equal(operation.remoteState?.imageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay refuses verified success when getOffer returns only seven detail images", async () => {
  const readback = await readEbayListingPublicationState({
    operation: "listing.update",
    intent: "live",
    remoteId: "offer-123",
    offerId: "offer-123",
    expected: { locale: "en-US", fingerprint, imageCount: 8 },
    readOffer: async () => remote(ebayOffer({ status: "PUBLISHED", listingStatus: "ACTIVE", imageCount: 7 })),
    readInventoryItem: async () => remote({ product: { imageUrls: ebayInventoryImages() } }),
  });
  assert.equal(readback.state, undefined);
  assert.equal(readback.failureCode, "EBAY_PUBLICATION_IMAGE_COUNT_UNVERIFIED");
});
