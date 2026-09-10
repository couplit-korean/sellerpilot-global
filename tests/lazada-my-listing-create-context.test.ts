import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLazadaMyListingCreateContext,
  bindLazadaMyListingCreateContext,
  buildLazadaMyListingCreateContext,
  lazadaMySellerModeEvidenceFromProfile,
  lazadaMySellerModeEvidenceFromGatewayResult,
  lazadaMySellerModeEvidenceContract,
  lazadaSellerProfileFromGatewayResult,
} from "../lib/product-registration/lazada/listing-create-context";

const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";

function inputs(mode: "standard" | "marketplace_ease" = "standard") {
  return {
    productId: PRODUCT_ID,
    product: { id: PRODUCT_ID, sku: "NEW-MY-SKU-001", onHand: 3 },
    manualFields: {
      sellerSku: "NEW-MY-SKU-001",
      currency: "KRW",
      sellingPrice: 5_000,
      stock: 3,
    },
    assignments: [{
      channel: "lazada",
      environment: "production",
      market: "MY",
      categoryId: "10100205",
      categoryPath: ["Home", "Storage"],
      providedAttributes: {},
      requiredAttributes: [],
      officialMetadata: {
        sellerMode: mode,
        sellerModeVerifiedAt: "2026-09-09T00:00:00.000Z",
        sellerModeEvidenceSource: "lazada-seller-center",
      },
      status: "confirmed",
      confirmedAt: "2026-09-09T00:00:00.000Z",
    }],
    market: "MY",
    sellerId: "200100300",
    currency: "MYR",
    price: mode === "standard" ? 19.9 : 19.9,
    sellerModeEvidence: {
      contract: lazadaMySellerModeEvidenceContract,
      market: "MY" as const,
      sellerId: "200100300",
      sellerMode: mode,
      verifiedAt: "2026-09-09T00:00:00.000Z",
      evidenceSource: "lazada-open-platform-seller-get" as const,
    },
  };
}

function argumentsValue() {
  return {
    country: "sg",
    sellerpilotExpectedSellerId: "attacker-seller",
    request: {
      Request: {
        Product: {
          PrimaryCategory: "999",
          Attributes: { name: "Produk" },
          Skus: {
            Sku: [{
              SellerSku: "ATTACKER-SKU",
              price: "999.99",
              supply_price: "999.999",
              quantity: "99",
              special_price: "1",
            }],
          },
        },
      },
    },
  };
}

for (const mode of ["standard", "marketplace_ease"] as const) {
  test(`server context overwrites client Lazada ${mode} identity and commerce values`, () => {
    const context = buildLazadaMyListingCreateContext(inputs(mode));
    assert.ok(context);
    const bound = bindLazadaMyListingCreateContext(argumentsValue(), context);
    assert.deepEqual(assertLazadaMyListingCreateContext(bound), context);
    const product = bound.request.Request.Product;
    const sku = product.Skus.Sku[0];
    assert.equal(bound.country, "my");
    assert.equal(bound.sellerpilotExpectedSellerId, "200100300");
    assert.equal(product.PrimaryCategory, "10100205");
    assert.equal(sku.SellerSku, "NEW-MY-SKU-001");
    assert.equal(sku.quantity, "3");
    assert.equal(sku.special_price, undefined);
    if (mode === "standard") {
      assert.equal(sku.price, "19.9");
      assert.equal(sku.supply_price, undefined);
    } else {
      assert.equal(sku.supply_price, "19.9");
      assert.equal(sku.price, undefined);
    }
  });
}

test("server context rejects unconfirmed identity, inventory, market and seller mode evidence", () => {
  const cases = [
    (value: ReturnType<typeof inputs>) => { value.manualFields.stock = 4; },
    (value: ReturnType<typeof inputs>) => { value.market = "SG"; },
    (value: ReturnType<typeof inputs>) => { value.sellerId = "not-numeric"; },
    (value: ReturnType<typeof inputs>) => { value.assignments[0].status = "pending"; },
    (value: ReturnType<typeof inputs>) => { value.assignments[0].officialMetadata.sellerMode = "unknown" as "standard"; },
    (value: ReturnType<typeof inputs>) => { value.sellerModeEvidence.sellerId = "999"; },
    (value: ReturnType<typeof inputs>) => { value.sellerModeEvidence.sellerMode = "unknown" as "standard"; },
  ];
  for (const mutate of cases) {
    const value = inputs();
    mutate(value);
    assert.equal(buildLazadaMyListingCreateContext(value), null);
  }
});

test("assignment JSON alone never authorizes a Lazada MY seller mode", () => {
  const value = inputs();
  value.sellerModeEvidence = null as unknown as ReturnType<typeof inputs>["sellerModeEvidence"];
  assert.equal(buildLazadaMyListingCreateContext(value), null);
});

test("server seller profile evidence is exact seller-bound and fail-closed", () => {
  const profile = lazadaSellerProfileFromGatewayResult({
    ok: true,
    channel: "lazada",
    operation: "shops.get",
    steps: [{ name: "seller-info", ok: true, status: 200, data: { code: "0", data: {
      seller_id: "200100300",
      marketplaceEaseMode: "true",
    } } }],
  });
  assert.deepEqual(lazadaMySellerModeEvidenceFromProfile({
    profile,
    expectedSellerId: "200100300",
    verifiedAt: "2026-09-09T00:00:00.000Z",
  }), {
    contract: lazadaMySellerModeEvidenceContract,
    market: "MY",
    sellerId: "200100300",
    sellerMode: "marketplace_ease",
    verifiedAt: "2026-09-09T00:00:00.000Z",
    evidenceSource: "lazada-open-platform-seller-get",
  });
  assert.equal(lazadaMySellerModeEvidenceFromGatewayResult({
    result: {
      ok: true,
      channel: "lazada",
      operation: "shops.get",
      steps: [{ name: "seller-info", ok: true, status: 200, data: {
        code: "0",
        data: { seller_id: "200100300", marketplaceEaseMode: "true" },
      } }],
    },
    expectedSellerId: "200100300",
    verifiedAt: "2026-09-09T00:00:00.000Z",
  })?.sellerMode, "marketplace_ease");
  for (const profile of [
    { seller_id: "200100300" },
    { seller_id: "999", marketplaceEaseMode: false },
    { seller_id: "200100300", marketplaceEaseMode: "unverified" },
    { seller_id: "200100300", seller_type: "standard" },
    { seller_id: "200100300", account_type: "marketplace_ease" },
  ]) {
    assert.equal(lazadaMySellerModeEvidenceFromProfile({
      profile,
      expectedSellerId: "200100300",
      verifiedAt: "2026-09-09T00:00:00.000Z",
    }), null);
  }
  assert.equal(lazadaMySellerModeEvidenceFromProfile({
    profile: { seller_id: "200100300", marketplaceEaseMode: false },
    expectedSellerId: "200100300",
    verifiedAt: "2026-09-09T00:00:00.000Z",
  })?.sellerMode, "standard");
});

test("failed Lazada gateway results never expose a seller-shaped profile", () => {
  const valid = {
    ok: true,
    channel: "lazada",
    operation: "shops.get",
    steps: [{
      name: "seller-info",
      ok: true,
      status: 200,
      data: {
        code: "0",
        data: { seller_id: "200100300", marketplaceEaseMode: true },
      },
    }],
  };
  for (const mutate of [
    (value: typeof valid) => { value.ok = false; },
    (value: typeof valid) => { value.steps[0].ok = false; },
    (value: typeof valid) => { value.steps[0].status = 500; },
    (value: typeof valid) => { value.steps[0].status = Number.NaN; },
    (value: typeof valid) => { value.steps[0].data.code = "IllegalAccessToken"; },
    (value: typeof valid) => { Object.assign(value.steps[0].data, { error: "failed" }); },
    (value: typeof valid) => { Object.assign(value.steps[0].data, { error: { message: "failed" } }); },
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.equal(lazadaSellerProfileFromGatewayResult(value), null);
  }
});

test("v1 blocks multiple client SKUs until the server publishes canonical variants", () => {
  const context = buildLazadaMyListingCreateContext(inputs());
  assert.ok(context);
  const value = argumentsValue();
  value.request.Request.Product.Skus.Sku.push({
    ...value.request.Request.Product.Skus.Sku[0],
    SellerSku: "SECOND-SKU",
  });
  assert.throws(
    () => bindLazadaMyListingCreateContext(value, context),
    /LAZADA_MY_CREATE_SINGLE_CANONICAL_SKU_REQUIRED/u,
  );
});

test("post-bind tampering with seller, category, SKU, quantity or mode price is rejected", () => {
  const context = buildLazadaMyListingCreateContext(inputs());
  assert.ok(context);
  const bound = bindLazadaMyListingCreateContext(argumentsValue(), context);
  for (const mutate of [
    (value: typeof bound) => { value.sellerpilotExpectedSellerId = "999"; },
    (value: typeof bound) => { value.request.Request.Product.PrimaryCategory = "999"; },
    (value: typeof bound) => { value.request.Request.Product.Skus.Sku[0].SellerSku = "OTHER"; },
    (value: typeof bound) => { value.request.Request.Product.Skus.Sku[0].quantity = "4"; },
    (value: typeof bound) => { value.request.Request.Product.Skus.Sku[0].price = "20"; },
  ]) {
    const value = structuredClone(bound);
    mutate(value);
    assert.throws(
      () => assertLazadaMyListingCreateContext(value),
      /LAZADA_MY_CREATE_CONTEXT_(?:INVALID|MISMATCH)/u,
    );
  }
});
