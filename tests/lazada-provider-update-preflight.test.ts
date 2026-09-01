import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  prepareLazadaListing,
  type LazadaListingRuntimeDependencies,
  type PrepareProviderListingInput,
} from "../lib/channels/provider-listing-runtime";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import {
  normalizeLazadaListingPublicationReadback,
} from "../lib/channels/provider-lazada-publication-readback";

const ITEM_ID = "14976038919";
const CATEGORY_ID = "10100205";
const SELLER_SKU = "QA-20260823-CC-001-MY";
const SOURCE_PRICE_KRW = 5_000;
const KRW_PER_MYR = 350;
const TARGET_PRICE_MYR = 14.29;
const SELLER_ID = "200100300";
const LISTING_ID = "42021335-9793-4834-8cd5-b73169fd1f48";
const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const CREDENTIAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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
    sellerpilotExpectedSellerId: SELLER_ID,
    sellerpilotLazadaExactExistingUpdate: {
      contract: "lazada_exact_existing_my_live_update_v1",
      productId: PRODUCT_ID,
      listingId: LISTING_ID,
      credentialId: CREDENTIAL_ID,
      itemId: ITEM_ID,
      sellerSku: SELLER_SKU,
      sellerAccountKey: "a".repeat(64),
      targetId: SELLER_ID,
      lineageAttestationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      lineageEvidenceDigest: "c".repeat(64),
      approvedManifestDigest: "d".repeat(64),
      releaseSha: "e".repeat(40),
    },
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "b".repeat(64),
    publicationExpectedImageCount: 8,
    imageUrls: [REPRESENTATIVE, ...DETAILS],
    sellerpilotAssets: { galleryImageUrls: [REPRESENTATIVE] },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "detail_content",
      approvedManifestDigest: "d".repeat(64),
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
            Sku: [{
              SellerSku: SELLER_SKU,
              price: String(TARGET_PRICE_MYR),
              quantity: "1",
              Status: "active",
            }],
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

function remoteProducts(products: Array<Record<string, unknown>> = [
  remoteProduct().data as Record<string, unknown>,
]) {
  return {
    code: "0",
    data: { products },
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
    credential: withLazadaProviderAccountIdentity({
      app_key: "app",
      app_secret: "secret",
      access_token: "token",
      country: "my",
    }, {
      account_platform: "seller_center",
      country_user_info: [{
        country: "my",
        seller_id: SELLER_ID,
        user_id: "300100200",
      }],
    }).payload,
    arguments: argumentsValue(),
    environment: "production",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation"); },
    },
  };
}

function dependencies(events: string[], options: {
  category?: string;
  leaf?: boolean;
  products?: Array<Record<string, unknown>>;
  itemStatus?: "active" | "inactive";
} = {}): LazadaListingRuntimeDependencies {
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
    lazadaRequest: async ({ path, params }) => {
      events.push(`request:${path}`);
      if (path === "/seller/get") {
        return remote({
          code: "0",
          data: { seller_id: SELLER_ID, is_active: true, status: "active" },
        });
      }
      if (path === "/products/get") {
        assert.deepEqual(params, {
          filter: "all",
          sku_seller_list: JSON.stringify([SELLER_SKU]),
          options: "1",
          limit: "100",
          offset: "0",
        });
        return remote(remoteProducts(options.products));
      }
      if (path === "/product/item/get") {
        const item = remoteProduct(options.category);
        if (options.itemStatus) {
          item.data.status = options.itemStatus;
          item.data.skus[0].Status = options.itemStatus;
        }
        return remote(item);
      }
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
  assert.equal(firstMutation > events.indexOf("request:/products/get"), true);
  assert.equal(firstMutation > events.indexOf("request:/seller/get"), true);
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
      Status: "active",
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
    updateSkuStatus: "active",
  });

  const providerGallery = (product.Images as { Image: string[] }).Image;
  const providerSku = (product.Skus as { Sku: Array<Record<string, unknown>> }).Sku[0];
  const normalized = normalizeLazadaListingPublicationReadback({
    operation: "listing.update",
    remoteId: ITEM_ID,
    remoteData: {
      code: "0",
      data: {
        item_id: ITEM_ID,
        primary_category: CATEGORY_ID,
        status: "active",
        images: providerGallery,
        attributes,
        skus: [{
          ...providerSku,
          SkuId: "170000000001",
          price: TARGET_PRICE_MYR,
          quantity: 1,
          special_price: 0,
          Status: "active",
        }],
      },
    },
    mutationArguments: prepared,
    market: "MY",
    expectedLocale: "ms-MY",
    expectedFingerprint: "b".repeat(64),
    expectedImageCount: 8,
    verifiedAt: "2026-09-02T00:00:00.000Z",
  });
  assert.ok(normalized.remoteState, "the provider-prepared exact path must produce terminal evidence");
  assert.equal(
    normalized.remoteState.evidence.titleDigest,
    createHash("sha256").update(String(attributes.name).trim(), "utf8").digest("hex"),
  );
  assert.equal(
    normalized.remoteState.evidence.descriptionDigest,
    createHash("sha256").update(description.trim(), "utf8").digest("hex"),
  );
});

test("Lazada MY blocks absent or duplicate GetProducts SellerSku identity before every mutation", async () => {
  const product = remoteProduct().data as Record<string, unknown>;
  for (const products of [
    [],
    [product, { ...product, item_id: "14976038920" }],
  ]) {
    const events: string[] = [];
    await assert.rejects(
      prepareLazadaListing(input(events), dependencies(events, { products })),
      /LAZADA_UPDATE_GET_PRODUCTS_IDENTITY_AMBIGUOUS/u,
    );
    assert.equal(events.includes("request:/products/get"), true);
    assert.equal(events.some((event) => event.startsWith("validate:")), false);
    assert.equal(events.includes("mutation"), false);
    assert.equal(events.includes("request:/image/migrate"), false);
  }
});

test("Lazada MY requires GetProducts and GetProductItem to return the same immutable SkuId", async () => {
  const product = structuredClone(remoteProduct().data) as Record<string, unknown>;
  const skus = product.skus as Array<Record<string, unknown>>;
  skus[0].SkuId = "170000000002";
  const events: string[] = [];
  await assert.rejects(
    prepareLazadaListing(input(events), dependencies(events, { products: [product] })),
    /LAZADA_UPDATE_PRODUCTS_ITEM_SKU_ID_MISMATCH/u,
  );
  assert.equal(events.some((event) => event.startsWith("validate:")), false);
  assert.equal(events.includes("mutation"), false);
  assert.equal(events.includes("request:/image/migrate"), false);
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

test("Lazada exact MY content contract fails before every provider read or mutation", async () => {
  const invalidArguments = [
    (value: Record<string, unknown>) => { value.publicationIntent = "safe_test"; },
    (value: Record<string, unknown>) => { value.sellerpilotExpectedSellerId = ""; },
    (value: Record<string, unknown>) => { value.publicationExpectedLocale = "en-MY"; },
    (value: Record<string, unknown>) => {
      const policy = value.sellerpilotLazadaPricePolicy as Record<string, unknown>;
      policy.targetCurrency = "USD";
    },
    (value: Record<string, unknown>) => {
      const policy = value.sellerpilotLazadaPricePolicy as Record<string, unknown>;
      policy.sourcePriceKrw = 4_999;
    },
    (value: Record<string, unknown>) => {
      const request = value.request as {
        Request: { Product: { Skus: { Sku: Array<Record<string, unknown>> } } };
      };
      request.Request.Product.Skus.Sku[0].quantity = "2";
    },
    (value: Record<string, unknown>) => {
      const request = value.request as {
        Request: { Product: { Skus: { Sku: Array<Record<string, unknown>> } } };
      };
      request.Request.Product.Skus.Sku[0].Status = "inactive";
    },
    (value: Record<string, unknown>) => {
      const binding = value.sellerpilotPublicationAssetBinding as {
        providerTransportImages: Array<Record<string, unknown>>;
      };
      binding.providerTransportImages.pop();
    },
  ];

  for (const invalidate of invalidArguments) {
    const events: string[] = [];
    const nextInput = input(events);
    invalidate(nextInput.arguments);
    await assert.rejects(
      prepareLazadaListing(nextInput, dependencies(events)),
      /LAZADA_EXACT_EXISTING_CONTENT_CONTRACT_REQUIRED/u,
    );
    assert.deepEqual(events, []);
  }
});

test("Lazada exact MY requires an already live provider item before image migration", async () => {
  const events: string[] = [];
  const inactive = structuredClone(remoteProduct().data) as Record<string, unknown>;
  inactive.status = "inactive";
  const skus = inactive.skus as Array<Record<string, unknown>>;
  skus[0].Status = "inactive";
  await assert.rejects(
    prepareLazadaListing(input(events), dependencies(events, {
      products: [inactive],
      itemStatus: "inactive",
    })),
    /LAZADA_UPDATE_REMOTE_SKU_NOT_LIVE/u,
  );
  assert.equal(events.includes("request:/products/get"), true);
  assert.equal(events.includes("request:/product/item/get"), true);
  assert.equal(events.some((event) => event.startsWith("validate:")), false);
  assert.equal(events.includes("mutation"), false);
  assert.equal(events.includes("request:/image/migrate"), false);
});
