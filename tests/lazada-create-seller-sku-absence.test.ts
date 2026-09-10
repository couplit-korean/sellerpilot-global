import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLazadaCreateSellerSkuAbsence,
  lazadaCreateSellerSkus,
  lazadaCreateSkuChecks,
} from "../lib/channels/lazada-create-preflight";
import { assertLazadaActiveSellerLineage } from "../lib/channels/lazada-seller-lineage";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import { executeLazada } from "../lib/product-registration/channels/lazada";

function strictCreateArguments() {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 0,
    country: "my",
    sellerpilotExpectedSellerId: "200100300",
    sellerpilotExpectedPrimaryCategory: "10100205",
    sellerpilotLazadaMyCreateContext: {
      contract: "lazada_my_listing_create_context_v1",
      productId: "20000000-0000-4000-8000-000000000001",
      sellerSku: "NEW-MY-SKU-001",
      sourceCurrency: "KRW",
      sourcePriceKrw: 5000,
      market: "MY",
      locale: "ms-MY",
      sellerId: "200100300",
      targetCurrency: "MYR",
      targetPriceMyr: 20,
      quantity: 1,
      categoryId: "10100205",
      categoryConfirmedAt: "2026-09-09T00:00:00.000Z",
      sellerMode: "standard",
      sellerModeVerifiedAt: "2026-09-09T00:00:00.000Z",
      sellerModeEvidenceSource: "lazada-seller-center",
    },
    request: {
      Request: {
        Product: {
          PrimaryCategory: "10100205",
          Attributes: { name: "Produk ujian", brand: "No Brand" },
          Skus: {
            Sku: [{
              SellerSku: "NEW-MY-SKU-001",
              price: "20.00",
              quantity: "1",
              package_content: "One item",
              package_weight: "0.2",
              package_length: "10",
              package_width: "8",
              package_height: "3",
            }],
          },
        },
      },
    },
  };
}

test("Lazada SKU price checks distinguish standard and Marketplace Ease", () => {
  const standard = strictCreateArguments();
  assert.equal(lazadaCreateSkuChecks(standard, "standard").price, true);
  assert.equal(lazadaCreateSkuChecks(standard, "marketplace_ease").price, false);

  const marketplaceEase = strictCreateArguments();
  const sku = marketplaceEase.request.Request.Product.Skus.Sku[0];
  delete (sku as Partial<typeof sku>).price;
  Object.assign(sku, { supply_price: "20.000" });
  assert.equal(
    lazadaCreateSkuChecks(marketplaceEase, "marketplace_ease").price,
    true,
  );
  assert.equal(lazadaCreateSkuChecks(marketplaceEase, "standard").price, false);
});

function credential() {
  return withLazadaProviderAccountIdentity({
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
    country: "my",
  }, {
    account_platform: "seller_center",
    country_user_info: [{
      country: "my",
      seller_id: "200100300",
      user_id: "300100200",
    }],
  }).payload;
}

function remote(status: number, data: Record<string, unknown>) {
  return {
    response: new Response(JSON.stringify(data), { status }),
    data,
    text: JSON.stringify(data),
  };
}

test("Lazada strict create extracts every unique SellerSku for one exact absence query", () => {
  const argumentsValue = strictCreateArguments();
  const product = argumentsValue.request.Request.Product;
  product.Skus.Sku.push({
    ...product.Skus.Sku[0],
    SellerSku: "NEW-MY-SKU-002",
  });
  assert.deepEqual(lazadaCreateSellerSkus(argumentsValue), [
    "NEW-MY-SKU-001",
    "NEW-MY-SKU-002",
  ]);
});

test("Lazada accepts only an explicit internally consistent zero-product response", () => {
  assert.deepEqual(assertLazadaCreateSellerSkuAbsence(
    remote(200, { code: "0", data: { total_products: 0, products: [] } }),
    ["NEW-MY-SKU-001"],
  ), {
    contract: "lazada_create_seller_sku_absence_v1",
    requestedSellerSkuCount: 1,
    matchedProductCount: 0,
  });
  for (const response of [
    remote(503, { code: "0", data: { total_products: 0, products: [] } }),
    remote(200, { code: "IllegalAccessToken", data: { total_products: 0, products: [] } }),
    remote(200, { code: "0", data: { products: [] } }),
    remote(200, { code: "0", data: { total_products: null, products: [] } }),
    remote(200, { code: "0", data: { total_products: 1, products: [] } }),
  ]) {
    assert.throws(
      () => assertLazadaCreateSellerSkuAbsence(response, ["NEW-MY-SKU-001"]),
      /LAZADA_CREATE_SELLER_SKU_PREFLIGHT_FAILED/u,
    );
  }
  assert.throws(() => assertLazadaCreateSellerSkuAbsence(
    remote(200, { code: "0", data: { total_products: 0, products: [] } }),
    ["NEW-MY-SKU-001", "NEW-MY-SKU-001"],
  ), /LAZADA_CREATE_SELLER_SKU_INVALID/u);
});

test("Lazada MY create seller binding requires an active seller-center identity", () => {
  const sellerId = "200100300";
  const credential = withLazadaProviderAccountIdentity({
    country: "my",
  }, {
    account_platform: "seller_center",
    country_user_info: [{
      country: "my",
      seller_id: sellerId,
      user_id: "300100200",
    }],
  }).payload;
  assert.deepEqual(assertLazadaActiveSellerLineage({
    credential,
    remoteData: {
      code: "0",
      data: { seller_id: sellerId, is_active: true, status: "active" },
    },
    country: "my",
    expectedSellerId: sellerId,
  }), { sellerId, status: "ACTIVE" });
  assert.throws(() => assertLazadaActiveSellerLineage({
    credential: { ...credential, account_platform: "buyer_portal" },
    remoteData: {
      code: "0",
      data: { seller_id: sellerId, is_active: true, status: "active" },
    },
    country: "my",
    expectedSellerId: sellerId,
  }), /LAZADA_SELLER_ACCOUNT_PLATFORM_MISMATCH/u);
});

test("Lazada duplicate SellerSku stops before CreateProduct", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/seller/get")) {
      return Response.json({
        code: "0",
        data: { seller_id: "200100300", is_active: true, status: "active" },
      });
    }
    if (url.includes("/products/get")) {
      return Response.json({
        code: "0",
        data: {
          total_products: 1,
          products: [{
            item_id: 123456789,
            skus: [{ SellerSku: "NEW-MY-SKU-001", SkuId: 987654321 }],
          }],
        },
      });
    }
    throw new Error("unexpected provider mutation");
  };
  try {
    const execution = await executeLazada({
      channel: "lazada",
      operation: "listing.create",
      environment: "production",
      payload: credential(),
      arguments: strictCreateArguments(),
    });
    assert.equal(execution.ok, false);
    assert.equal(execution.steps[0]?.status, 409);
    assert.equal(
      execution.steps[0]?.data.error,
      "LAZADA_CREATE_SELLER_SKU_ALREADY_EXISTS",
    );
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/seller\/get/u);
    assert.match(calls[1], /\/products\/get/u);
    assert.equal(calls.some((url) => /\/product\/create/u.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada ambiguous absence response stops before CreateProduct", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/seller/get")) {
      return Response.json({
        code: "0",
        data: { seller_id: "200100300", is_active: true, status: "active" },
      });
    }
    return Response.json({ code: "0", data: { products: [] } });
  };
  try {
    const execution = await executeLazada({
      channel: "lazada",
      operation: "listing.create",
      environment: "production",
      payload: credential(),
      arguments: strictCreateArguments(),
    });
    assert.equal(execution.ok, false);
    assert.equal(execution.steps[0]?.status, 502);
    assert.equal(
      execution.steps[0]?.data.error,
      "LAZADA_CREATE_SELLER_SKU_PREFLIGHT_FAILED",
    );
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada seller lineage mismatch stops before SellerSku lookup and CreateProduct", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return Response.json({
      code: "0",
      data: { seller_id: "999999999", is_active: true, status: "active" },
    });
  };
  try {
    const execution = await executeLazada({
      channel: "lazada",
      operation: "listing.create",
      environment: "production",
      payload: credential(),
      arguments: strictCreateArguments(),
    });
    assert.equal(execution.ok, false);
    assert.equal(execution.steps[0]?.status, 409);
    assert.equal(
      execution.steps[0]?.data.error,
      "LAZADA_SELLER_READBACK_MISMATCH",
    );
    assert.deepEqual(calls.map((url) => new URL(url).pathname), ["/rest/seller/get"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada direct create rejects missing publication marker or MY context before any provider or media call", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new Error("unexpected provider or media call");
  };
  try {
    const withoutPublicationMarker = strictCreateArguments();
    delete (withoutPublicationMarker as Partial<typeof withoutPublicationMarker>)
      .publicationStateContract;
    const missingMarker = await executeLazada({
      channel: "lazada",
      operation: "listing.create",
      environment: "production",
      payload: credential(),
      arguments: withoutPublicationMarker,
    });
    assert.equal(missingMarker.ok, false);
    assert.equal(missingMarker.steps[0]?.status, 422);
    assert.equal(
      missingMarker.steps[0]?.data.error,
      "LAZADA_CREATE_PUBLICATION_CONTRACT_REQUIRED",
    );
    assert.equal(missingMarker.steps[0]?.data.sellerpilotNoWriteConfirmed, true);

    const withoutCreateContext = strictCreateArguments();
    delete (withoutCreateContext as Partial<typeof withoutCreateContext>)
      .sellerpilotLazadaMyCreateContext;
    const missingContext = await executeLazada({
      channel: "lazada",
      operation: "listing.create",
      environment: "production",
      payload: credential(),
      arguments: withoutCreateContext,
    });
    assert.equal(missingContext.ok, false);
    assert.equal(missingContext.steps[0]?.status, 422);
    assert.equal(
      missingContext.steps[0]?.data.error,
      "LAZADA_MY_CREATE_CONTEXT_INVALID",
    );
    assert.equal(missingContext.steps[0]?.data.sellerpilotNoWriteConfirmed, true);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
