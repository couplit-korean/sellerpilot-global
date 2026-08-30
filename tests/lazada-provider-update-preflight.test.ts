import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareLazadaListing,
  type LazadaListingRuntimeDependencies,
  type PrepareProviderListingInput,
} from "../lib/channels/provider-listing-runtime";

const ITEM_ID = "14976038919";
const CATEGORY_ID = "10100205";
const SELLER_SKU = "QA-20260823-CC-001-MY";
const SOURCE_PRICE_KRW = 5_000;
const KRW_PER_MYR = 350;
const TARGET_PRICE_MYR = 14.29;
const REPRESENTATIVE = "https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/ff/representative.jpg";
const DETAILS = Array.from(
  { length: 8 },
  (_, index) => `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/0${index + 1}/detail-${index + 1}.jpg`,
);

function argumentsValue() {
  return {
    itemId: ITEM_ID,
    country: "my",
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "b".repeat(64),
    publicationExpectedImageCount: 8,
    imageUrls: [REPRESENTATIVE, ...DETAILS],
    sellerpilotAssets: { galleryImageUrls: [REPRESENTATIVE] },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "detail_content",
      providerTransportImages: DETAILS.map((publicUrl, index) => ({
        role: `detail-role-${index + 1}`,
        publicUrl,
      })),
    },
    sellerpilotLazadaPricePolicy: {
      contract: "lazada_krw_myr_reference_price_v1",
      sourceCurrency: "KRW",
      sourcePriceKrw: SOURCE_PRICE_KRW,
      targetCurrency: "MYR",
      targetPriceMyr: TARGET_PRICE_MYR,
      rate: {
        krwPerMyr: KRW_PER_MYR,
        fetchedAt: new Date().toISOString(),
        asOf: new Date().toISOString(),
        source: "Coinbase Data API",
        sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
        frequency: "minute-market",
      },
    },
    request: {
      Request: {
        Product: {
          PrimaryCategory: CATEGORY_ID,
          Images: { Image: [REPRESENTATIVE, ...DETAILS.slice(0, 7)] },
          Attributes: {
            name: "Klip pengurusan kabel pelekat, set 6 unit",
            short_description: "Pastikan kabel tersusun dan mudah dicapai.",
            description: `<section><p>Klip kabel tahan lama untuk meja yang kemas.</p>${DETAILS.map((url) => `<img src="${url}">`).join("")}</section>`,
            brand: "No Brand",
          },
          Skus: {
            Sku: [{ SellerSku: SELLER_SKU, price: String(TARGET_PRICE_MYR), quantity: "1" }],
          },
        },
      },
    },
  };
}

function remoteProduct(category = CATEGORY_ID) {
  return {
    code: "0",
    data: {
      item_id: ITEM_ID,
      primary_category: category,
      status: "active",
      skus: [{
        SkuId: "170000000001",
        SellerSku: SELLER_SKU,
        price: 40,
        quantity: 3,
        special_price: 0,
        Status: "active",
        multiWarehouseInventories: [],
        fblWarehouseInventories: [],
      }],
    },
  };
}

function remote(data: Record<string, unknown>) {
  return {
    response: new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    data,
  };
}

function input(events: string[]): PrepareProviderListingInput {
  return {
    channel: "lazada",
    operation: "listing.update",
    credential: {
      app_key: "app",
      app_secret: "secret",
      access_token: "token",
      country: "my",
    },
    arguments: argumentsValue(),
    environment: "production",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation"); },
    },
  };
}

function dependencies(events: string[], options: { category?: string; leaf?: boolean } = {}): LazadaListingRuntimeDependencies {
  let migrationIndex = 0;
  return {
    loadKrwPerMyr: async () => {
      events.push("request:exchange-rate");
      const now = new Date().toISOString();
      return {
        krwPerMyr: KRW_PER_MYR,
        fetchedAt: now,
        asOf: now,
        source: "Coinbase Data API",
        sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
        frequency: "minute-market",
      };
    },
    assertPublicReferenceUrl: async (url) => {
      events.push(`validate:${String(url)}`);
      return new URL(String(url));
    },
    lazadaRequest: async ({ path }) => {
      events.push(`request:${path}`);
      if (path === "/product/item/get") return remote(remoteProduct(options.category));
      if (path === "/category/tree/get") {
        return remote({ code: "0", data: [{ category_id: CATEGORY_ID, leaf: options.leaf ?? true }] });
      }
      if (path === "/category/attributes/get") {
        return remote({ code: "0", data: [{ name: "name" }, { name: "description" }] });
      }
      if (path === "/image/migrate") {
        migrationIndex += 1;
        return remote({
          code: "0",
          data: { image: { url: `https://my-live.slatic.net/p/provider-${migrationIndex}.jpg` } },
        });
      }
      throw new Error(`unexpected Lazada path: ${path}`);
    },
  } as LazadaListingRuntimeDependencies;
}

test("Lazada MY existing listing preflights item, leaf category and immutable SKU before nine image migrations", async () => {
  const events: string[] = [];
  const prepared = await prepareLazadaListing(input(events), dependencies(events));
  const firstMutation = events.indexOf("mutation");
  assert.equal(firstMutation > events.indexOf("request:/product/item/get"), true);
  assert.equal(firstMutation > events.indexOf("request:/category/tree/get"), true);
  assert.equal(firstMutation > events.indexOf("request:/category/attributes/get"), true);
  assert.equal(firstMutation > events.indexOf("request:exchange-rate"), true);
  assert.equal(events.filter((event) => event === "mutation").length, 9);
  assert.equal(events.filter((event) => event === "request:/image/migrate").length, 9);

  const request = prepared.request as {
    Request: { Product: Record<string, unknown> };
  };
  const product = request.Request.Product;
  assert.equal(product.PrimaryCategory, CATEGORY_ID);
  assert.deepEqual(product.Images, {
    Image: Array.from({ length: 8 }, (_, index) => `https://my-live.slatic.net/p/provider-${index + 1}.jpg`),
  });
  assert.deepEqual(product.Skus, {
    Sku: [{
      SkuId: "170000000001",
      SellerSku: SELLER_SKU,
      price: String(TARGET_PRICE_MYR),
      quantity: "1",
      Images: {
        Image: Array.from({ length: 8 }, (_, index) => `https://my-live.slatic.net/p/provider-${index + 1}.jpg`),
      },
    }],
  });
  const attributes = product.Attributes as Record<string, unknown>;
  const description = String(attributes.description);
  assert.equal((description.match(/my-live\.slatic\.net\/p\/provider-/gu) ?? []).length, 8);
  assert.doesNotMatch(description, /sellerpilot\.supabase\.co/u);
  assert.equal(prepared.sellerpilotProviderRepresentativeImageUrl, "https://my-live.slatic.net/p/provider-1.jpg");
  assert.deepEqual(
    prepared.sellerpilotProviderDetailImageUrls,
    Array.from({ length: 8 }, (_, index) => `https://my-live.slatic.net/p/provider-${index + 2}.jpg`),
  );
  assert.deepEqual(prepared.sellerpilotLazadaUpdatePreflight, {
    contract: "lazada_existing_listing_update_v1",
    itemId: ITEM_ID,
    country: "my",
    primaryCategory: CATEGORY_ID,
    sellerSku: SELLER_SKU,
    skuId: "170000000001",
    price: String(TARGET_PRICE_MYR),
    quantity: 1,
    providerStatus: "ACTIVE",
  });
});

test("Lazada MY category or leaf mismatch fails before image validation and every provider mutation", async () => {
  for (const options of [
    { category: "99999999" },
    { leaf: false },
  ]) {
    const events: string[] = [];
    await assert.rejects(
      prepareLazadaListing(input(events), dependencies(events, options)),
      /LAZADA_UPDATE_(?:CATEGORY_MISMATCH|LEAF_CATEGORY_PREFLIGHT_FAILED)/u,
    );
    assert.equal(events.some((event) => event.startsWith("validate:")), false);
    assert.equal(events.includes("mutation"), false);
    assert.equal(events.includes("request:/image/migrate"), false);
  }
});

test("Lazada MY rejects a price that is not the fresh 5,000 KRW equivalent before every provider mutation", async () => {
  const events: string[] = [];
  const nextInput = input(events);
  const policy = nextInput.arguments.sellerpilotLazadaPricePolicy as Record<string, unknown>;
  policy.targetPriceMyr = 58.05;
  const request = nextInput.arguments.request as {
    Request: { Product: { Skus: { Sku: Array<Record<string, unknown>> } } };
  };
  request.Request.Product.Skus.Sku[0].price = "58.05";
  await assert.rejects(
    prepareLazadaListing(nextInput, dependencies(events)),
    /LAZADA_KRW_MYR_(?:DECLARED|AUTHORITATIVE)_RATE_MISMATCH/u,
  );
  assert.equal(events.some((event) => event.startsWith("validate:")), false);
  assert.equal(events.includes("mutation"), false);
  assert.equal(events.includes("request:/image/migrate"), false);
});

test("Lazada MY validates all nine public image URLs before the first image migration", async () => {
  const events: string[] = [];
  const runtimeDependencies = dependencies(events);
  runtimeDependencies.assertPublicReferenceUrl = async (url) => {
    events.push(`validate:${String(url)}`);
    if (String(url) === DETAILS[7]) throw new Error("PUBLIC_REFERENCE_URL_REJECTED");
    return new URL(String(url));
  };
  await assert.rejects(
    prepareLazadaListing(input(events), runtimeDependencies),
    /PUBLIC_REFERENCE_URL_REJECTED/u,
  );
  assert.equal(events.filter((event) => event.startsWith("validate:")).length, 9);
  assert.equal(events.includes("mutation"), false);
  assert.equal(events.includes("request:/image/migrate"), false);
});
