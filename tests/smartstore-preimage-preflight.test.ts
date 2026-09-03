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
const {
  bindSmartstoreExactQaRecoveryArguments,
  smartstoreExactQaRecoveryArgument,
  smartstoreExactQaRecoveryIdentity,
} = await import("../lib/channels/smartstore-exact-qa-recovery");

const detailUrls = Array.from(
  { length: 8 },
  (_, index) => `https://images.example.com/detail-${index + 1}.jpg`,
);
const representativeUrl = "https://images.example.com/representative.jpg";
const sellerManagementCode = "SELLERPILOT-QA-001";
const missingFixtureField = Symbol("missing-fixture-field");

function setFixtureField(
  root: Record<string, unknown>,
  path: string[],
  value: unknown | typeof missingFixtureField,
) {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    assert.ok(next && typeof next === "object" && !Array.isArray(next));
    current = next as Record<string, unknown>;
  }
  const key = path.at(-1);
  assert.ok(key);
  if (value === missingFixtureField) delete current[key];
  else current[key] = value;
}

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
      assertLeaseHealthy: async () => {},
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
      return Response.json({ id: "50001578", name: "케이블 정리", last: true });
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
        "/external/v2/products/origin-products/13671684696",
        "/external/v2/products/channel-products/13732202182",
      ],
    );
    assert.equal(calls.some((url) => url.endsWith("/v1/product-images/upload")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore rejects a client-forged exact marker before any read or image mutation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const input = runtimeInput("listing.update", mutations);
  input.arguments[smartstoreExactQaRecoveryArgument] = {
    contract: "smartstore_exact_qa_recovery_v1",
    channelProductNo: "99999999999",
  };
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(input),
      /SMARTSTORE_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED/,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(mutations, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore exact recovery rejects a price or SKU contract mismatch before provider reads", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const input = runtimeInput("listing.update", mutations);
  input.arguments = bindSmartstoreExactQaRecoveryArguments({
    ...input.arguments,
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    body: {
      ...input.arguments.body,
      originProduct: {
        ...input.arguments.body.originProduct,
        salePrice: smartstoreExactQaRecoveryIdentity.priceKrw + 10,
        detailAttribute: {
          sellerCodeInfo: {
            sellerManagementCode: smartstoreExactQaRecoveryIdentity.centralSku,
          },
        },
      },
    },
  });
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(input),
      /SMARTSTORE_EXACT_QA_PATCH_CONTRACT_MISMATCH/,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(mutations, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore exact recovery rejects stock above one before provider reads", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const input = runtimeInput("listing.update", mutations);
  input.arguments = bindSmartstoreExactQaRecoveryArguments({
    ...input.arguments,
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    body: {
      ...input.arguments.body,
      originProduct: {
        ...input.arguments.body.originProduct,
        salePrice: smartstoreExactQaRecoveryIdentity.priceKrw,
        stockQuantity: smartstoreExactQaRecoveryIdentity.stock + 1,
        detailAttribute: {
          sellerCodeInfo: {
            sellerManagementCode: smartstoreExactQaRecoveryIdentity.centralSku,
          },
        },
      },
    },
  });
  try {
    await assert.rejects(
      prepareMarketplaceListingArguments(input),
      /SMARTSTORE_EXACT_QA_PATCH_CONTRACT_MISMATCH/,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(mutations, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore exact recovery rejects missing or null provider fields before any request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const mutations: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected request: ${String(input)}`);
  };
  const baseInput = runtimeInput("listing.update", mutations);
  const originProduct = baseInput.arguments.body.originProduct;
  const validArguments = bindSmartstoreExactQaRecoveryArguments({
    ...baseInput.arguments,
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    body: {
      ...baseInput.arguments.body,
      originProduct: {
        ...originProduct,
        salePrice: smartstoreExactQaRecoveryIdentity.priceKrw,
        stockQuantity: 1,
        detailAttribute: {
          ...originProduct.detailAttribute,
          sellerCodeInfo: {
            sellerManagementCode: smartstoreExactQaRecoveryIdentity.centralSku,
          },
        },
      },
    },
  });
  const requiredFields = [
    ["originProductNo", ["originProductNo"]],
    ["sellerManagementCode", ["body", "originProduct", "detailAttribute", "sellerCodeInfo", "sellerManagementCode"]],
    ["salePrice", ["body", "originProduct", "salePrice"]],
    ["stockQuantity", ["body", "originProduct", "stockQuantity"]],
    ["publicationIntent", ["publicationIntent"]],
    ["publicationExpectedLocale", ["publicationExpectedLocale"]],
    ["publicationExpectedImageCount", ["publicationExpectedImageCount"]],
  ] as const;
  try {
    for (const [field, path] of requiredFields) {
      for (const [variant, value] of [
        ["missing", missingFixtureField],
        ["null", null],
      ] as const) {
        const argumentsValue = structuredClone(validArguments);
        setFixtureField(argumentsValue, [...path], value);
        await assert.rejects(
          prepareMarketplaceListingArguments({ ...baseInput, arguments: argumentsValue }),
          /NAVER_ORIGIN_PRODUCT_ID_MISSING|NAVER_SELLER_MANAGEMENT_CODE_MISSING|SMARTSTORE_EXACT_QA_PATCH_CONTRACT_MISMATCH/,
          `${field}:${variant}`,
        );
        assert.deepEqual(calls, [], `${field}:${variant}`);
        assert.deepEqual(mutations, [], `${field}:${variant}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
