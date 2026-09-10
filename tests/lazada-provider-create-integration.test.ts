import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import {
  prepareLazadaListing,
  type LazadaListingRuntimeDependencies,
  type PrepareProviderListingInput,
} from "../lib/channels/provider-listing-runtime";

type SellerMode = "standard" | "marketplace_ease";
type UnknownRecord = Record<string, unknown>;

const CATEGORY_ID = "10100205";
const SELLER_ID = "200100300";
const SELLER_SKU = "NEW-MY-SKU-001";
const SOURCE_PRICE_KRW = 5_000;
const TARGET_PRICE_MYR = 14.29;
const KRW_PER_MYR = 350;
const REPRESENTATIVE =
  "https://sellerpilot.supabase.co/storage/v1/object/public/normalized/representative.jpg";
const DETAILS = Array.from(
  { length: 8 },
  (_, index) =>
    `https://sellerpilot.supabase.co/storage/v1/object/public/normalized/detail-${index + 1}.jpg`,
);
const SIZE_CHART =
  "https://sellerpilot.supabase.co/storage/v1/object/public/normalized/size-chart.jpg";

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

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
      seller_id: SELLER_ID,
      user_id: "300100200",
    }],
  }).payload;
}

function argumentsValue(mode: SellerMode) {
  const timestamp = new Date().toISOString();
  const packageAmount = mode === "marketplace_ease" ? "0.200" : "0.20";
  const dimension = mode === "marketplace_ease" ? "10.000" : "10.00";
  const price = mode === "marketplace_ease"
    ? { supply_price: String(TARGET_PRICE_MYR) }
    : { price: String(TARGET_PRICE_MYR) };
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    country: "my",
    sellerpilotExpectedSellerId: SELLER_ID,
    sellerpilotExpectedPrimaryCategory: CATEGORY_ID,
    sellerpilotLazadaMyCreateContext: {
      contract: "lazada_my_listing_create_context_v1",
      productId: "20000000-0000-4000-8000-000000000004",
      sellerSku: SELLER_SKU,
      sourceCurrency: "KRW",
      sourcePriceKrw: SOURCE_PRICE_KRW,
      market: "MY",
      locale: "ms-MY",
      sellerId: SELLER_ID,
      targetCurrency: "MYR",
      targetPriceMyr: TARGET_PRICE_MYR,
      quantity: 1,
      categoryId: CATEGORY_ID,
      categoryConfirmedAt: timestamp,
      sellerMode: mode,
      sellerModeVerifiedAt: timestamp,
      sellerModeEvidenceSource: "lazada-seller-center",
    },
    sellerpilotLazadaPricePolicy: {
      contract: "lazada_krw_myr_reference_price_v1",
      sourceCurrency: "KRW",
      sourcePriceKrw: SOURCE_PRICE_KRW,
      targetCurrency: "MYR",
      targetPriceMyr: TARGET_PRICE_MYR,
      rate: {
        krwPerMyr: KRW_PER_MYR,
        fetchedAt: timestamp,
        asOf: timestamp,
        source: "Coinbase Data API",
        sourceUrl:
          "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
        frequency: "minute-market",
      },
    },
    imageUrls: [REPRESENTATIVE, ...DETAILS],
    sellerpilotAssets: { galleryImageUrls: [REPRESENTATIVE] },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "detail_content",
      approvedManifestDigest: "b".repeat(64),
      providerTransportImages: DETAILS.map((publicUrl, index) => ({
        role: `detail-${index + 1}`,
        publicUrl,
      })),
    },
    request: {
      Request: {
        Product: {
          PrimaryCategory: CATEGORY_ID,
          Images: { Image: [REPRESENTATIVE, ...DETAILS.slice(0, 7)] },
          Attributes: {
            name: "Produk ujian SellerPilot",
            brand: "No Brand",
            description: DETAILS.map((url) => `<img src="${url}">`).join(""),
            size_chart_image: SIZE_CHART,
          },
          Skus: {
            Sku: [{
              SellerSku: SELLER_SKU,
              ...price,
              quantity: "1",
              package_content: "One item",
              package_weight: packageAmount,
              package_length: dimension,
              package_width: dimension,
              package_height: packageAmount,
              Status: "inactive",
              Images: {
                Image: [REPRESENTATIVE, ...DETAILS.slice(0, 7)],
              },
            }],
          },
        },
      },
    },
  };
}

function remote(data: UnknownRecord) {
  return {
    response: Response.json(data),
    data,
    text: JSON.stringify(data),
  };
}

function runtimeInput(
  mode: SellerMode,
  events: string[],
): PrepareProviderListingInput {
  return {
    channel: "lazada",
    operation: "listing.create",
    credential: credential(),
    arguments: argumentsValue(mode),
    environment: "production",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation"); },
    },
  };
}

function dependencies(events: string[]): LazadaListingRuntimeDependencies {
  let migrationIndex = 0;
  return {
    assertPublicReferenceUrl: async (url) => {
      events.push(`validate:${String(url)}`);
      return new URL(String(url));
    },
    loadKrwPerMyr: async () => {
      events.push("request:exchange-rate");
      const timestamp = new Date().toISOString();
      return {
        krwPerMyr: KRW_PER_MYR,
        fetchedAt: timestamp,
        asOf: timestamp,
        source: "Coinbase Data API",
        sourceUrl:
          "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
        frequency: "minute-market",
      };
    },
    lazadaRequest: async ({ path }) => {
      events.push(`request:${path}`);
      if (path === "/seller/get") {
        return remote({
          code: "0",
          data: { seller_id: SELLER_ID, is_active: true, status: "active" },
        });
      }
      if (path === "/products/get") {
        return remote({
          code: "0",
          data: { total_products: 0, products: [] },
        });
      }
      if (path === "/category/tree/get") {
        return remote({
          code: "0",
          data: [{ category_id: CATEGORY_ID, leaf: true }],
        });
      }
      if (path === "/category/attributes/get") {
        return remote({
          code: "0",
          data: [
            {
              name: "name",
              attribute_type: "normal",
              input_type: 5,
              is_mandatory: 1,
            },
            {
              name: "brand",
              attribute_type: "normal",
              input_type: 5,
              is_mandatory: 1,
            },
            {
              name: "size_chart_image",
              attribute_type: "normal",
              input_type: 9,
              is_mandatory: 1,
            },
          ],
        });
      }
      if (path === "/image/migrate") {
        migrationIndex += 1;
        return remote({
          code: "0",
          data: {
            image: {
              url: `https://my-live.slatic.net/p/provider-${migrationIndex}.jpg`,
            },
          },
        });
      }
      throw new Error(`unexpected Lazada prepare path: ${path}`);
    },
  };
}

function readbackFromPrepared(
  prepared: UnknownRecord,
  mode: SellerMode,
) {
  const product = record(record(record(prepared.request).Request).Product);
  const sourceSku = (record(product.Skus).Sku as UnknownRecord[])[0];
  const remoteSku = {
    ...structuredClone(sourceSku),
    SkuId: "555001",
    quantity: 1,
    Status: "inactive",
    ...(mode === "marketplace_ease"
      ? { supply_price: TARGET_PRICE_MYR }
      : { price: TARGET_PRICE_MYR, special_price: 0 }),
  };
  return {
    code: "0",
    request_id: "readback-request",
    data: {
      item_id: 987654321,
      primary_category: CATEGORY_ID,
      status: "inactive",
      images: record(product.Images).Image,
      attributes: product.Attributes,
      skus: [remoteSku],
    },
  };
}

for (const mode of ["standard", "marketplace_ease"] as const) {
  test(`Lazada MY ${mode} create passes prepareLazadaListing through official execution readback`, async () => {
    const events: string[] = [];
    const prepared = await prepareLazadaListing(
      runtimeInput(mode, events),
      dependencies(events),
    );
    assert.equal(events.filter((event) => event === "mutation").length, 10);
    assert.equal(
      events.filter((event) => event === "request:/image/migrate").length,
      10,
    );
    const preparedProduct = record(record(record(prepared.request).Request).Product);
    assert.equal(
      record(preparedProduct.Attributes).size_chart_image,
      "https://my-live.slatic.net/p/provider-10.jpg",
    );

    const originalFetch = globalThis.fetch;
    const providerCalls: Array<{ path: string; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname.replace(/^\/rest/u, "");
      providerCalls.push({ path, body: String(init?.body ?? "") });
      if (path === "/seller/get") {
        return Response.json({
          code: "0",
          data: { seller_id: SELLER_ID, is_active: true, status: "active" },
        });
      }
      if (path === "/products/get") {
        return Response.json({
          code: "0",
          data: { total_products: 0, products: [] },
        });
      }
      if (path === "/product/create") {
        return Response.json({
          code: "0",
          request_id: "create-request",
          data: { item_id: 987654321 },
        });
      }
      if (path === "/product/item/get") {
        return Response.json(readbackFromPrepared(prepared, mode));
      }
      throw new Error(`unexpected Lazada execute path: ${path}`);
    };
    try {
      const execution = await executeChannelOperation({
        channel: "lazada",
        operation: "listing.create",
        environment: "production",
        payload: credential(),
        arguments: prepared,
      });
      assert.equal(execution.ok, true, JSON.stringify(execution));
      assert.equal(execution.remoteId, "987654321");
      assert.equal(execution.remoteState?.visibility, "non_public");
      assert.deepEqual(providerCalls.map((call) => call.path), [
        "/seller/get",
        "/products/get",
        "/product/create",
        "/product/item/get",
      ]);
      const createBody = new URLSearchParams(providerCalls[2].body)
        .get("payload") ?? "";
      assert.match(createBody, /<SellerSku>NEW-MY-SKU-001<\/SellerSku>/u);
      if (mode === "marketplace_ease") {
        assert.match(createBody, /<supply_price>14\.29<\/supply_price>/u);
        assert.doesNotMatch(createBody, /<price>/u);
      } else {
        assert.match(createBody, /<price>14\.29<\/price>/u);
        assert.doesNotMatch(createBody, /<supply_price>/u);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("Lazada create preparation rejects missing marker or MY context with zero provider and media calls", async () => {
  for (const missing of ["marker", "context"] as const) {
    const events: string[] = [];
    const input = runtimeInput("standard", events);
    if (missing === "marker") {
      delete input.arguments.publicationStateContract;
    } else {
      delete input.arguments.sellerpilotLazadaMyCreateContext;
    }
    await assert.rejects(
      prepareLazadaListing(input, dependencies(events)),
      missing === "marker"
        ? /LAZADA_CREATE_PUBLICATION_CONTRACT_REQUIRED/u
        : /LAZADA_MY_CREATE_CONTEXT_INVALID/u,
    );
    assert.deepEqual(events, []);
  }
});
