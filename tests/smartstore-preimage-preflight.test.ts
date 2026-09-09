import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { prepareMarketplaceListingArguments } = await import(
  "../lib/channels/provider-listing-runtime"
);


const detailUrls = Array.from(
  { length: 8 },
  (_, index) => `https://images.example.com/detail-${index + 1}.jpg`,
);
const representativeUrl = "https://images.example.com/representative.jpg";
const sellerManagementCode = "SELLERPILOT-QA-001";

function listingArguments(operation: "listing.create" | "listing.update") {
  return {
    ...(operation === "listing.update" ? { originProductNo: "13671684696" } : {}),
    publicationIntent: "live",
    imageUrls: [representativeUrl, ...detailUrls],
    body: {
      originProduct: {
        leafCategoryId: "50001578",
        name: "부착형 케이블 정리 클립 6개 세트",
        detailContent: detailUrls.map((url) => `<img src="${url}" />`).join(""),
        salePrice: 5_000,
        stockQuantity: 1,
        ...(operation === "listing.create" ? {
          deliveryInfo: {
            deliveryType: "DELIVERY",
            deliveryCompany: "CJGLS",
            deliveryFee: { deliveryFeeType: "PAID", baseFee: 3_500, deliveryFeePayType: "PREPAID" },
            claimDeliveryInfo: { returnDeliveryCompanyPriorityType: "PRIMARY", returnDeliveryFee: 3_500, exchangeDeliveryFee: 7_000, shippingAddressId: 123, returnAddressId: 456 },
          }
        } : {}),
        detailAttribute: {
          sellerCodeInfo: { sellerManagementCode },
        },
      },
      smartstoreChannelProduct: {
        channelProductName: "부착형 케이블 정리 클립 6개 세트",
      },
    },
  };
}

const credential = {
  access_token: "stored-naver-access-token",
  access_token_expires_at: "2099-01-01T00:00:00.000Z",
  after_service_phone: "02-1234-5678",
};

test("Smartstore create rejects absent or contradictory shipping before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); throw new Error("unexpected provider request"); };
  try {
    for (const deliveryInfo of [undefined, { deliveryType: "DELIVERY", deliveryFee: { deliveryFeeType: "FREE", baseFee: 3_500 } }]) {
      const input = runtimeInput("listing.create", []);
      const product = input.arguments.body.originProduct as Record<string, unknown>;
      product.deliveryInfo = deliveryInfo;
      await assert.rejects(prepareMarketplaceListingArguments(input), /SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED/);
    }
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function runtimeInput(
  operation: "listing.create" | "listing.update",
  mutationEvents: string[],
) {
  return {
    channel: "smartstore" as const,
    operation,
    credential,
    arguments: listingArguments(operation),
    environment: "production" as const,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { },
      beginProviderMutation: async () => { mutationEvents.push("provider-image-mutation"); },
    },
  };
}

test("Smartstore create rejects a non-leaf category before image mutation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/categories/50001578")) {
      return Response.json({ id: "50001578", name: "생활용품", last: false });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(runtimeInput("listing.create", mutations)),
      /NAVER_LEAF_CATEGORY_PREFLIGHT_FAILED/,
    );
    assert.deepEqual(mutations, []);
    assert.equal(calls.some((url) => url.endsWith("/v1/products/search")), false);
    assert.equal(calls.some((url) => url.endsWith("/v1/product-images/upload")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore create rejects an unavailable duplicate search before image mutation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/categories/50001578")) {
      return Response.json({ id: "50001578", name: "케이블 정리", last: true, exceptionalCategories: [] });
    }
    if (url.endsWith("/v1/products/search")) {
      return Response.json({ code: "TEMPORARY_UNAVAILABLE" }, { status: 503 });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(runtimeInput("listing.create", mutations)),
      /NAVER_DUPLICATE_PREFLIGHT_FAILED/,
    );
    assert.deepEqual(mutations, []);
    assert.deepEqual(
      calls.map((url) => new URL(url).pathname),
      [
        "/external/v1/categories/50001578",
        "/external/v1/products/search",
      ],
    );
    assert.equal(calls.some((url) => url.endsWith("/v1/product-images/upload")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore update rejects an origin or seller-code mismatch before image mutation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/products/search")) return Response.json({
      page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
      contents: [{ originProductNo: "13671684696", channelProducts: [{ channelProductNo: "13732202182", sellerManagementCode }] }],
    });
    if (url.endsWith("/v2/products/origin-products/13671684696")) {
      return Response.json({
        originProductNo: 13671684696,
        smartstoreChannelProductNo: 13732202182,
        originProduct: {
          name: "기존 원격 상품",
          detailAttribute: {
            sellerCodeInfo: { sellerManagementCode: "DIFFERENT-SKU" },
          },
        },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(runtimeInput("listing.update", mutations)),
      /NAVER_UPDATE_ORIGIN_PREFLIGHT_FAILED/,
    );
    assert.deepEqual(mutations, []);
    assert.equal(calls.some((url) => url.includes("/v2/products/channel-products/")), false);
    assert.equal(calls.some((url) => url.endsWith("/v1/product-images/upload")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore update rejects a channel-to-origin mismatch before image mutation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/products/search")) return Response.json({
      page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
      contents: [{ originProductNo: "13671684696", channelProducts: [{ channelProductNo: "13732202182", sellerManagementCode }] }],
    });
    if (url.endsWith("/v2/products/origin-products/13671684696")) {
      return Response.json({
        originProductNo: 13671684696,
        smartstoreChannelProductNo: 13732202182,
        originProduct: {
          name: "기존 원격 상품",
          detailAttribute: {
            sellerCodeInfo: { sellerManagementCode },
          },
        },
      });
    }
    if (url.endsWith("/v2/products/channel-products/13732202182")) {
      return Response.json({
        smartstoreChannelProduct: {
          channelProductNo: 13732202182,
          originProductNo: 99999999999,
          sellerManagementCode,
        },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(runtimeInput("listing.update", mutations)),
      /NAVER_UPDATE_CHANNEL_PREFLIGHT_FAILED/,
    );
    assert.deepEqual(mutations, []);
    assert.deepEqual(
      calls.map((url) => new URL(url).pathname),
      [
        "/external/v1/products/search",
        "/external/v2/products/origin-products/13671684696",
        "/external/v2/products/channel-products/13732202182",
      ],
    );
    assert.equal(calls.some((url) => url.endsWith("/v1/product-images/upload")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore existing seller code is rejected before uploading images", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: string[] = [], calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/v1/categories/50001578")) return Response.json({ id: "50001578", name: "케이블 정리", last: true, exceptionalCategories: [] });
    if (url.endsWith("/v1/products/search")) return Response.json({
      page: 1, size: 50, first: true, last: true, totalElements: 1, totalPages: 1,
      contents: [{ originProductNo: 10000001, channelProducts: [{ sellerManagementCode, channelProductNo: 20000001 }] }],
    });
    throw new Error("Unexpected provider request");
  };
  try {
    await assert.rejects(prepareMarketplaceListingArguments(runtimeInput("listing.create", mutations)), /NAVER_EXISTING_PRODUCT_REQUIRES_UPDATE/);
    assert.deepEqual(mutations, []);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});
