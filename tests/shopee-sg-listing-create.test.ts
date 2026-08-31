import assert from "node:assert/strict";
import test from "node:test";
import {
  assertShopeeSgCurrentPrice,
  bindShopeeSgListingCreateArguments,
  buildShopeeSgListingCreateContext,
  buildShopeeSgPreparedCreateEvidence,
  loadAuthoritativeKrwSgdUsdRate,
  shopeeExactGlobalCategoryPath,
  shopeeGlobalLeafCategoryPaths,
  shopeeSgCableClipCategory,
  shopeeSgExactCreateIdentity,
  shopeeSgListingCreateExpectation,
  shopeeSgListingCreateContextContract,
  shopeeSgPreparedCreateExpectation,
  shopeeSgdPriceFromKrw,
  shopeeUsdPriceFromKrw,
  verifyShopeeSgListingCreateReadback,
  type ShopeeKrwSgdUsdRateEvidence,
} from "../lib/channels/shopee-sg-listing-create";

const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_ID = "30000000-0000-4000-8000-000000000001";
const SKU = "QA-20260823-CC-001";
const SHOP_ID = "1719148844";
const GLOBAL_ITEM_ID = "7001";
const LOCAL_ITEM_ID = "9001";
const LOCAL_CATEGORY_ID = "200479";
const FINGERPRINT = "a".repeat(64);
const NOW = new Date("2026-08-30T05:00:00.000Z");
const roles = [
  "detail-hero",
  "detail-overview",
  "detail-feature-one",
  "detail-feature-two",
  "detail-specification",
  "detail-use",
  "detail-care",
  "detail-closing",
];

function rate(overrides: Partial<ShopeeKrwSgdUsdRateEvidence> = {}): ShopeeKrwSgdUsdRateEvidence {
  return {
    krwPerSgd: 1_000,
    krwPerUsd: 1_250,
    fetchedAt: NOW.toISOString(),
    asOf: NOW.toISOString(),
    source: "Coinbase Data API",
    sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
    frequency: "minute-market",
    ...overrides,
  };
}

function image(index: number) {
  const contentSha256 = index.toString(16).padStart(64, "0");
  const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
  return {
    publicUrl: `https://qa-project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256,
  };
}

function publicationBinding() {
  const approvedDetailImages = roles.map((role, index) => ({
    role,
    approvedObjectPath: `results/${ATTEMPT_ID}/claims/${CLAIM_ID}/${index + 1}.png`,
    approvedSourceSha256: (index + 20).toString(16).padStart(64, "0"),
    ...image(index + 1),
  }));
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "b".repeat(64),
    approvedDetailImages,
    providerImageSurface: "buyer_visible",
    providerTransportImages: roles.map((role, index) => ({ role, ...image(index + 1) })),
  };
}

function exactCategoryResponse() {
  return {
    error: "",
    response: {
      category_list: [
        { category_id: 100013, parent_category_id: 0, display_category_name: "Mobile & Gadgets", has_children: true },
        { category_id: 100075, parent_category_id: 100013, display_category_name: "Accessories", has_children: true },
        { category_id: 100284, parent_category_id: 100075, display_category_name: "Cables, Chargers & Converters", has_children: true },
        { category_id: 100479, parent_category_id: 100284, display_category_name: "Cable Cases, Protectors, & Winders", has_children: false },
        { category_id: 999999, parent_category_id: 100284, display_category_name: "Unrelated Leaf", has_children: false },
      ],
    },
  };
}

function strictArguments() {
  const context = buildShopeeSgListingCreateContext({
    productId: PRODUCT_ID,
    product: { id: PRODUCT_ID, sku: SKU, onHand: 1 },
    manualFields: { sellingPrice: 5_000, currency: "KRW" },
    assignments: [{
      channel: "shopee",
      market: "SG",
      status: "confirmed",
      categoryId: shopeeSgCableClipCategory.id,
      categoryPath: [...shopeeSgCableClipCategory.path],
      confirmedAt: "2026-08-30T04:55:00.000Z",
    }],
    market: "SG",
    targetId: SHOP_ID,
    currency: "SGD",
    rate: rate(),
  });
  assert.ok(context);
  return bindShopeeSgListingCreateArguments({
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "en-SG",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    sellerpilotPublicationAssetBinding: publicationBinding(),
    imageUrls: [image(9).publicUrl, ...roles.map((_role, index) => image(index + 1).publicUrl)],
    globalProduct: true,
    country: "sg",
    body: {
      category_id: 42,
      global_item_name: "Wrong client title",
      global_item_sku: "WRONG-SKU",
      description: "Wrong client description",
      original_price: 99,
      normal_stock: 99,
    },
    publish: {
      shop_id: 42,
      shop_region: "MY",
      item: {
        category_id: 42,
        item_name: "Adhesive Cable Organizer Clips",
        item_sku: "WRONG-SKU",
        description: "Keep charging cables tidy with durable adhesive clips designed for desks, walls, and everyday home use.",
        original_price: 99,
        normal_stock: 99,
      },
    },
  }, context);
}

function preparedArguments() {
  const source = strictArguments();
  const parsed = shopeeSgListingCreateExpectation(source);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture prewrite invalid");
  const providerPath = shopeeExactGlobalCategoryPath(
    exactCategoryResponse(),
    shopeeSgCableClipCategory.id,
  );
  assert.ok(providerPath);
  const publish = source.publish as Record<string, unknown>;
  const itemValue = publish.item as Record<string, unknown>;
  const item = {
    item_name: itemValue.item_name,
    description: itemValue.description,
    original_price: itemValue.original_price,
  };
  return {
    ...source,
    sellerpilotProviderGlobalCategoryPath: providerPath,
    sellerpilotProviderLocalCategoryId: LOCAL_CATEGORY_ID,
    sellerpilotShopeeSgPreparedCreateEvidence: buildShopeeSgPreparedCreateEvidence({
      expectation: parsed.expectation,
      providerGlobalCategoryPath: providerPath,
      providerLocalCategoryId: LOCAL_CATEGORY_ID,
    }),
    publish: { ...publish, item },
  };
}

function readbackData() {
  return {
    globalRemoteData: {
      error: "",
      response: {
        global_item_list: [{
          global_item_id: Number(GLOBAL_ITEM_ID),
          category_id: Number(shopeeSgCableClipCategory.id),
          global_item_sku: SKU,
          original_price: 4,
          stock_info: [{ normal_stock: 1 }],
        }],
      },
    },
    publishedRemoteData: {
      error: "",
      response: { published_item: [{ shop_id: Number(SHOP_ID), item_id: Number(LOCAL_ITEM_ID) }] },
    },
    localRemoteData: {
      error: "",
      response: {
        item_list: [{
          item_id: Number(LOCAL_ITEM_ID),
          category_id: Number(LOCAL_CATEGORY_ID),
          item_sku: SKU,
          original_price: 5,
          stock_info_v2: { summary_info: { total_available_stock: 1 } },
        }],
      },
    },
  };
}

test("Shopee uses the exact stored provider ancestry and only returns complete leaf paths", () => {
  assert.deepEqual(
    shopeeExactGlobalCategoryPath(exactCategoryResponse(), "100479"),
    {
      ids: [...shopeeSgCableClipCategory.ids],
      names: [...shopeeSgCableClipCategory.path],
      leafId: "100479",
    },
  );
  assert.deepEqual(
    shopeeGlobalLeafCategoryPaths(exactCategoryResponse()).map((item) => item.leafId),
    ["100479", "999999"],
  );
  const missingParent = exactCategoryResponse();
  missingParent.response.category_list.splice(1, 1);
  assert.equal(shopeeExactGlobalCategoryPath(missingParent, "100479"), null);
});

test("Shopee SG context binds the exact central SKU, 5,000 KRW, stock one, category and request-time SGD/USD prices", () => {
  const arguments_ = strictArguments();
  const context = arguments_.sellerpilotShopeeSgCreateContext as Record<string, unknown>;
  assert.equal(context.contract, shopeeSgListingCreateContextContract);
  assert.equal(context.sku, SKU);
  assert.equal(context.sourcePriceKrw, 5_000);
  assert.equal(context.targetPriceSgd, 5);
  assert.equal(context.globalPriceUsd, 4);
  assert.equal(context.quantity, 1);
  assert.deepEqual(context.categoryPath, [...shopeeSgCableClipCategory.path]);
  assert.equal((arguments_.body as Record<string, unknown>).global_item_sku, SKU);
  assert.equal((arguments_.body as Record<string, unknown>).category_id, 100479);
  assert.equal((arguments_.publish as { shop_region: string }).shop_region, "SG");
  assert.equal(shopeeSgdPriceFromKrw(5_000, 1_000), 5);
  assert.equal(shopeeUsdPriceFromKrw(5_000, 1_250), 4);
  assert.equal(shopeeSgListingCreateExpectation(arguments_).ok, true);
  assert.deepEqual(shopeeSgExactCreateIdentity, {
    productId: PRODUCT_ID,
    sku: SKU,
    merchantId: "5511564",
    shopId: SHOP_ID,
    market: "SG",
  });
});

test("Shopee SG exact context rejects product, SKU, or shop drift before provider access", () => {
  for (const [field, mutate] of [
    ["productId", (context: Record<string, unknown>) => {
      context.productId = "10000000-0000-4000-8000-000000000001";
    }],
    ["sku", (context: Record<string, unknown>) => { context.sku = `${SKU}-SG`; }],
    ["targetId", (context: Record<string, unknown>) => { context.targetId = "1719148845"; }],
  ] as const) {
    const argumentsValue = strictArguments();
    mutate(argumentsValue.sellerpilotShopeeSgCreateContext as Record<string, unknown>);
    const parsed = shopeeSgListingCreateExpectation(argumentsValue);
    assert.equal(parsed.ok, false, field);
    if (!parsed.ok) {
      assert.equal(parsed.mismatchFields.includes("sellerpilotShopeeSgCreateContext"), true, field);
    }
  }
});

test("Coinbase KRW exchange response is converted to authoritative KRW-per-SGD and KRW-per-USD evidence", async () => {
  const loaded = await loadAuthoritativeKrwSgdUsdRate({
    signal: new AbortController().signal,
    now: NOW,
    fetcher: async (_input, init) => {
      assert.equal(init?.cache, "no-store");
      return Response.json({
        data: { currency: "KRW", rates: { SGD: "0.001", USD: "0.0008" } },
      }, { headers: { "last-modified": NOW.toUTCString() } });
    },
  });
  assert.deepEqual(loaded, rate());
});

test("Shopee SG prewrite and request-time FX checks fail before provider image mutation on any guessed commerce field", () => {
  for (const [field, mutate] of [
    ["body.category_id", (value: ReturnType<typeof strictArguments>) => {
      (value.body as Record<string, unknown>).category_id = 100480;
    }],
    ["body.global_item_sku", (value: ReturnType<typeof strictArguments>) => {
      (value.body as Record<string, unknown>).global_item_sku = `${SKU}-SG`;
    }],
    ["publish.item.original_price", (value: ReturnType<typeof strictArguments>) => {
      ((value.publish as { item: Record<string, unknown> }).item).original_price = 16.77;
    }],
    ["imageUrls", (value: ReturnType<typeof strictArguments>) => {
      value.imageUrls = value.imageUrls.slice(0, 8);
    }],
  ] as const) {
    const value = strictArguments();
    mutate(value);
    const parsed = shopeeSgListingCreateExpectation(value);
    assert.equal(parsed.ok, false, field);
    if (!parsed.ok) assert.equal(parsed.mismatchFields.includes(field), true, field);
  }

  const parsed = shopeeSgListingCreateExpectation(strictArguments());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture expectation invalid");
  assert.equal(
    assertShopeeSgCurrentPrice({ expectation: parsed.expectation, authoritativeRate: rate(), now: NOW }).sku,
    SKU,
  );
  assert.throws(
    () => assertShopeeSgCurrentPrice({
      expectation: parsed.expectation,
      authoritativeRate: rate(),
      now: new Date(NOW.getTime() + 11 * 60_000),
    }),
    /SHOPEE_KRW_SGD_RATE_STALE/,
  );
  assert.throws(
    () => assertShopeeSgCurrentPrice({
      expectation: parsed.expectation,
      authoritativeRate: rate({ krwPerSgd: 1_100 }),
      now: NOW,
    }),
    /SHOPEE_KRW_SGD_AUTHORITATIVE_RATE_MISMATCH/,
  );
});

test("Shopee prepared evidence survives provider schema stripping without allowing a forged local category or digest", () => {
  const prepared = preparedArguments();
  assert.equal(shopeeSgPreparedCreateExpectation(prepared).ok, true);
  const wrongLocal = structuredClone(prepared);
  wrongLocal.sellerpilotProviderLocalCategoryId = "200480";
  assert.equal(shopeeSgPreparedCreateExpectation(wrongLocal).ok, false);
  const wrongDigest = structuredClone(prepared);
  (wrongDigest.sellerpilotShopeeSgPreparedCreateEvidence as Record<string, unknown>).expectationDigest = "c".repeat(64);
  assert.equal(shopeeSgPreparedCreateExpectation(wrongDigest).ok, false);
});

test("Shopee CREATE readback requires exact global/local identity, linkage, category, central SKU, execution price and stock", () => {
  const argumentsValue = preparedArguments();
  const base = readbackData();
  const verify = (overrides: Partial<typeof base> = {}) => verifyShopeeSgListingCreateReadback({
    argumentsValue,
    globalItemId: GLOBAL_ITEM_ID,
    localItemId: LOCAL_ITEM_ID,
    shopId: SHOP_ID,
    localTransportVerified: true,
    ...base,
    ...overrides,
  });
  const exact = verify();
  assert.equal(exact.ok, true);
  if (exact.ok) assert.equal(Object.values(exact.checks).every(Boolean), true);

  for (const [name, mutate] of [
    ["global category", (value: ReturnType<typeof readbackData>) => {
      value.globalRemoteData.response.global_item_list[0].category_id = 100480;
    }],
    ["global SKU", (value: ReturnType<typeof readbackData>) => {
      value.globalRemoteData.response.global_item_list[0].global_item_sku = `${SKU}-SG`;
    }],
    ["global USD price", (value: ReturnType<typeof readbackData>) => {
      value.globalRemoteData.response.global_item_list[0].original_price = 4.01;
    }],
    ["linkage", (value: ReturnType<typeof readbackData>) => {
      value.publishedRemoteData.response.published_item[0].item_id = 9002;
    }],
    ["local category", (value: ReturnType<typeof readbackData>) => {
      value.localRemoteData.response.item_list[0].category_id = 200480;
    }],
    ["local SKU", (value: ReturnType<typeof readbackData>) => {
      value.localRemoteData.response.item_list[0].item_sku = `${SKU}-SG`;
    }],
    ["local SGD price", (value: ReturnType<typeof readbackData>) => {
      value.localRemoteData.response.item_list[0].original_price = 5.01;
    }],
    ["local stock", (value: ReturnType<typeof readbackData>) => {
      value.localRemoteData.response.item_list[0].stock_info_v2.summary_info.total_available_stock = 2;
    }],
  ] as const) {
    const attacked = readbackData();
    mutate(attacked);
    assert.equal(verify(attacked).ok, false, name);
  }

  assert.equal(verifyShopeeSgListingCreateReadback({
    argumentsValue,
    globalItemId: GLOBAL_ITEM_ID,
    localItemId: LOCAL_ITEM_ID,
    shopId: SHOP_ID,
    localTransportVerified: false,
    ...readbackData(),
  }).ok, false, "an item-shaped local body cannot override failed transport evidence");
});
