import assert from "node:assert/strict";
import test from "node:test";
import {
  planShopeeGlobalImages,
  prepareShopeeGlobalListing,
  type PrepareProviderListingInput,
  type ShopeeGlobalListingRuntimeDependencies,
} from "../lib/channels/provider-listing-runtime";
import type { RemoteResponse, SecretPayload } from "../lib/channels/protocols";
import {
  bindShopeeSgListingCreateArguments,
  buildShopeeSgListingCreateContext,
  shopeeSgCableClipCategory,
  type ShopeeKrwSgdUsdRateEvidence,
} from "../lib/channels/shopee-sg-listing-create";

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_ID = "30000000-0000-4000-8000-000000000001";
const SKU = "QA-20260823-CC-001";
const GLOBAL_CATEGORY_ID = 100479;
const LOCAL_CATEGORY_ID = 200456;
const FINGERPRINT = "a".repeat(64);
const detailRoles = [
  "detail-hero", "detail-overview", "detail-feature-one", "detail-feature-two",
  "detail-specification", "detail-use", "detail-care", "detail-closing",
];

function normalizedImage(index: number) {
  const contentSha256 = index.toString(16).padStart(64, "0");
  const objectPath = `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`;
  return {
    publicUrl: `https://qa-project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256,
  };
}

const imageUrls = [normalizedImage(9).publicUrl, ...detailRoles.map((_role, index) => normalizedImage(index + 1).publicUrl)];

function publicationBinding() {
  const approvedDetailImages = detailRoles.map((role, index) => ({
    role,
    approvedObjectPath: `results/${ATTEMPT_ID}/claims/${CLAIM_ID}/${index + 1}.png`,
    approvedSourceSha256: (index + 20).toString(16).padStart(64, "0"),
    ...normalizedImage(index + 1),
  }));
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "b".repeat(64),
    approvedDetailImages,
    providerImageSurface: "buyer_visible",
    providerTransportImages: detailRoles.map((role, index) => ({ role, ...normalizedImage(index + 1) })),
  };
}

function rate(): ShopeeKrwSgdUsdRateEvidence {
  const now = new Date().toISOString();
  return {
    krwPerSgd: 1_000,
    krwPerUsd: 1_250,
    fetchedAt: now,
    asOf: now,
    source: "Coinbase Data API",
    sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
    frequency: "minute-market",
  };
}

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  const text = JSON.stringify(data);
  return {
    response: new Response(text, { status, headers: { "content-type": "application/json" } }),
    data,
    text,
  };
}

function categoryResponse(categoryId: number, hasChildren = false) {
  if (categoryId === GLOBAL_CATEGORY_ID) {
    return remote({
      error: "",
      response: {
        category_list: [
          { category_id: 100013, parent_category_id: 0, display_category_name: "Mobile & Gadgets", has_children: true },
          { category_id: 100075, parent_category_id: 100013, display_category_name: "Accessories", has_children: true },
          { category_id: 100284, parent_category_id: 100075, display_category_name: "Cables, Chargers & Converters", has_children: true },
          { category_id: GLOBAL_CATEGORY_ID, parent_category_id: 100284, display_category_name: "Cable Cases, Protectors, & Winders", has_children: hasChildren },
        ],
      },
    });
  }
  return remote({
    error: "",
    response: {
      category_list: [{
        category_id: categoryId,
        parent_category_id: 100,
        display_category_name: "Cable Clips",
        has_children: hasChildren,
      }],
    },
  });
}

function attributeResponse(categoryId: number, attributeId: number, valueId: number, available = true) {
  return remote({
    error: "",
    response: {
      list: [{
        category_id: categoryId,
        attribute_tree: [{
          attribute_id: attributeId,
          name: `Required ${attributeId}`,
          mandatory: true,
          attribute_value_list: available ? [{ value_id: valueId, name: "Cable organizer" }] : [],
        }],
      }],
    },
  });
}

function limitResponse(galleryMax: number, descriptionMax = 8) {
  return remote({
    error: "",
    response: {
      global_item_image_count_limit: { min_limit: 1, max_limit: galleryMax },
      extended_description_limit: {
        description_image_num_min: 0,
        description_image_num_max: descriptionMax,
      },
    },
  });
}

function localLimitResponse(galleryMax: number, descriptionMax = 8, galleryMin = 1) {
  return remote({
    error: "",
    response: {
      item_image_count_limit: { min_limit: galleryMin, max_limit: galleryMax },
      extended_description_limit: {
        description_image_num_min: 0,
        description_image_num_max: descriptionMax,
      },
    },
  });
}

function input(): PrepareProviderListingInput {
  const createContext = buildShopeeSgListingCreateContext({
    productId: PRODUCT_ID,
    product: { id: PRODUCT_ID, sku: SKU, onHand: 1 },
    manualFields: { sellingPrice: 5_000, currency: "KRW" },
    assignments: [{
      channel: "shopee",
      market: "SG",
      status: "confirmed",
      categoryId: String(GLOBAL_CATEGORY_ID),
      categoryPath: [...shopeeSgCableClipCategory.path],
      confirmedAt: "2026-08-30T04:55:00.000Z",
    }],
    market: "SG",
    targetId: "3001",
    currency: "SGD",
    rate: rate(),
  });
  assert.ok(createContext);
  const arguments_ = bindShopeeSgListingCreateArguments({
      publicationStateContract: "verified_remote_state_v1",
      publicationIntent: "live",
      publicationExpectedLocale: "en-SG",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      sellerpilotPublicationAssetBinding: publicationBinding(),
      globalProduct: true,
      country: "sg",
      imageUrls,
      body: {
        category_id: GLOBAL_CATEGORY_ID,
        global_item_name: "Reusable cable organizer clips",
        description: "Keep charging cables tidy on a desk.",
        attribute_list: [{ attribute_id: 501, attribute_value_list: [{ value_id: 601 }] }],
      },
      publish: {
        shop_id: 3001,
        shop_region: "SG",
        item: {
          category_id: GLOBAL_CATEGORY_ID,
          item_name: "Reusable Cable Organizer Clips",
          item_sku: SKU,
          description: "Keep charging cables tidy with durable adhesive clips designed for desks, walls, and everyday home use.",
          attribute_list: [{ attribute_id: 501, attribute_value_list: [{ value_id: 601 }] }],
        },
      },
    }, createContext);
  return {
    channel: "shopee",
    operation: "listing.create",
    credential: {
      partner_id: "1001",
      partner_key: "merchant-key",
      merchant_id: "2001",
      access_token: "merchant-access",
    },
    shopeeShopCredential: {
      partner_id: "1001",
      partner_key: "shop-key",
      shop_id: "3001",
      access_token: "shop-access",
    },
    arguments: arguments_,
    environment: "production",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => undefined,
      beginProviderMutation: async () => undefined,
    },
  };
}

function dependencies(inputValue: {
  events: string[];
  galleryMax?: number;
  descriptionMax?: number;
  localGalleryMax?: number;
  localDescriptionMax?: number;
  localGalleryMin?: number;
  globalHasChildren?: boolean;
  globalAttributeAvailable?: boolean;
  activeLogistics?: boolean;
  localCategoryAvailable?: boolean;
}): ShopeeGlobalListingRuntimeDependencies {
  let uploadIndex = 0;
  return {
    shopRequest: async ({ path, query }) => {
      inputValue.events.push(`shop:${path}?${query?.toString() ?? ""}`);
      if (path.endsWith("get_channel_list")) {
        return remote({
          error: "",
          response: {
            logistics_channel_list: [
              { logistics_channel_id: 8001, enabled: inputValue.activeLogistics ?? true },
              { logistics_channel_id: 8002, enabled: false },
            ],
          },
        });
      }
      if (path.endsWith("category_recommend")) {
        return remote({
          error: "",
          response: { category_id: inputValue.localCategoryAvailable === false ? [] : [LOCAL_CATEGORY_ID] },
        });
      }
      if (path.endsWith("get_category")) return categoryResponse(LOCAL_CATEGORY_ID);
      if (path.endsWith("get_item_limit")) {
        return localLimitResponse(
          inputValue.localGalleryMax ?? inputValue.galleryMax ?? 9,
          inputValue.localDescriptionMax ?? inputValue.descriptionMax ?? 8,
          inputValue.localGalleryMin ?? 1,
        );
      }
      throw new Error(`unexpected shop request: ${path}`);
    },
    merchantRequest: async ({ path, query }) => {
      inputValue.events.push(`merchant:${path}?${query?.toString() ?? ""}`);
      if (path.endsWith("get_category")) {
        return categoryResponse(GLOBAL_CATEGORY_ID, inputValue.globalHasChildren ?? false);
      }
      if (path.endsWith("get_attribute_tree")) {
        return attributeResponse(GLOBAL_CATEGORY_ID, 501, 601, inputValue.globalAttributeAvailable ?? true);
      }
      if (path.endsWith("get_global_item_limit")) {
        return limitResponse(inputValue.galleryMax ?? 9, inputValue.descriptionMax ?? 8);
      }
      throw new Error(`unexpected merchant request: ${path}`);
    },
    uploadImage: async (
      _payload: SecretPayload,
      _environment,
      _imageUrl,
      _signal,
      _hooks,
      scene,
    ) => {
      inputValue.events.push(`upload:${scene}`);
      uploadIndex += 1;
      return `image-${uploadIndex}`;
    },
    loadKrwSgdUsdRate: async () => rate(),
  };
}

test("Shopee global image planning uses the category-scoped gallery limit and fails closed without an eight-image detail surface", () => {
  assert.deepEqual(planShopeeGlobalImages(limitResponse(9).data, localLimitResponse(9).data), {
    providerImageSurface: "gallery",
    galleryImageCount: 9,
    descriptionImageCount: 0,
  });
  assert.deepEqual(planShopeeGlobalImages(limitResponse(9).data, localLimitResponse(8).data), {
    providerImageSurface: "detail_content",
    galleryImageCount: 8,
    descriptionImageCount: 8,
  });
  assert.throws(
    () => planShopeeGlobalImages(limitResponse(9, 8).data, localLimitResponse(8, 7).data),
    /SHOPEE_EXTENDED_DESCRIPTION_IMAGES_UNAVAILABLE/,
  );
  assert.throws(
    () => planShopeeGlobalImages(limitResponse(12).data, localLimitResponse(12, 8, 10).data),
    /SHOPEE_GLOBAL_ITEM_IMAGE_COUNT_UNSUPPORTED/,
  );
});

test("Shopee SG validates logistics, the global category/attributes, and the recommended local category before uploading representative plus eight details", async () => {
  const events: string[] = [];
  const prepared = await prepareShopeeGlobalListing(input(), dependencies({ events }));
  const firstUpload = events.findIndex((event) => event.startsWith("upload:"));
  assert.equal(firstUpload, 7);
  assert.equal(events.slice(0, firstUpload).every((event) => !event.startsWith("upload:")), true);
  assert.equal(events.some((event) => event.includes(`global_product/get_attribute_tree?category_id_list=${GLOBAL_CATEGORY_ID}`)), true);
  assert.equal(events.some((event) => event.includes("product/category_recommend?item_name=Reusable+Cable+Organizer+Clips")), true);
  assert.equal(events.some((event) => event.includes(`global_product/get_global_item_limit?category_id=${GLOBAL_CATEGORY_ID}`)), true);
  assert.equal(events.some((event) => event.includes(`product/get_item_limit?category_id=${LOCAL_CATEGORY_ID}`)), true);
  assert.equal(events.filter((event) => event === "upload:normal").length, 9);

  const body = prepared.body as Record<string, unknown>;
  const bodyImage = body.image as { image_id_list: string[] };
  assert.equal(bodyImage.image_id_list.length, 9);
  assert.deepEqual(body.attribute_list, [{ attribute_id: 501, attribute_value_list: [{ value_id: 601 }] }]);
  const publish = prepared.publish as Record<string, unknown>;
  const item = publish.item as Record<string, unknown>;
  assert.deepEqual(item.logistic, [{ logistic_id: 8001, enabled: true }]);
  assert.equal(item.category_id, undefined, "create_publish_task removed category_id from its supported item schema");
  assert.equal(item.attribute_list, undefined, "global attribute IDs must not leak into the local publish item");
  assert.equal(item.item_sku, undefined, "undocumented local fields must not be sent");
  assert.equal(body.category_id, GLOBAL_CATEGORY_ID);
  assert.equal(body.global_item_sku, SKU);
  assert.equal(body.original_price, 4);
  assert.equal(body.normal_stock, 1);
  assert.equal(prepared.sellerpilotProviderLocalCategoryId, LOCAL_CATEGORY_ID);
  assert.deepEqual(prepared.sellerpilotProviderGlobalCategoryPath, {
    ids: [...shopeeSgCableClipCategory.ids],
    names: [...shopeeSgCableClipCategory.path],
    leafId: String(GLOBAL_CATEGORY_ID),
  });
  assert.equal(
    (prepared.sellerpilotShopeeSgPreparedCreateEvidence as Record<string, unknown>).providerLocalCategoryId,
    String(LOCAL_CATEGORY_ID),
  );
  assert.equal(prepared.sellerpilotProviderImageSurface, "gallery");
  assert.deepEqual(
    prepared.sellerpilotProviderDetailImageIds,
    Array.from({ length: 8 }, (_, index) => `image-${index + 2}`),
  );
});

test("Shopee SG falls back to buyer-visible extended description without dropping any approved detail image", async () => {
  const events: string[] = [];
  const prepared = await prepareShopeeGlobalListing(input(), dependencies({ events, galleryMax: 8 }));
  assert.equal(events.filter((event) => event === "upload:normal").length, 1);
  assert.equal(events.filter((event) => event === "upload:desc").length, 8);
  assert.equal(prepared.sellerpilotProviderImageSurface, "detail_content");

  const body = prepared.body as Record<string, unknown>;
  assert.equal((body.image as { image_id_list: string[] }).image_id_list.length, 8);
  assert.equal(body.description_type, "extended");
  const fields = ((body.description_info as {
    extended_description: { field_list: Array<Record<string, unknown>> };
  }).extended_description.field_list);
  assert.equal(fields.filter((field) => field.field_type === "image").length, 8);
  assert.deepEqual(
    fields.filter((field) => field.field_type === "image")
      .map((field) => (field.image_info as { image_id: string }).image_id),
    Array.from({ length: 8 }, (_, index) => `image-${index + 2}`),
  );
});

test("Shopee SG provider-preflight failure occurs before any image mutation", async () => {
  for (const { options, error } of [
    { options: { activeLogistics: false }, error: /SHOPEE_LOGISTICS_MISSING/ },
    { options: { globalHasChildren: true }, error: /SHOPEE_SG_EXACT_CATEGORY_PATH_INVALID/ },
    { options: { localCategoryAvailable: false }, error: /SHOPEE_LOCAL_CATEGORY_RECOMMENDATION_INVALID/ },
    { options: { localGalleryMax: 8, localDescriptionMax: 7 }, error: /SHOPEE_EXTENDED_DESCRIPTION_IMAGES_UNAVAILABLE/ },
  ]) {
    const events: string[] = [];
    await assert.rejects(
      prepareShopeeGlobalListing(input(), dependencies({ events, ...options })),
      error,
    );
    assert.equal(events.some((event) => event.startsWith("upload:")), false);
  }

  const invalidAttributeInput = input();
  const invalidBody = invalidAttributeInput.arguments.body as Record<string, unknown>;
  invalidBody.attribute_list = [{ attribute_id: 501, attribute_value_list: [{ value_id: 999 }] }];
  const attributeEvents: string[] = [];
  await assert.rejects(
    prepareShopeeGlobalListing(
      invalidAttributeInput,
      dependencies({ events: attributeEvents, globalAttributeAvailable: false }),
    ),
    /SHOPEE_GLOBAL_REQUIRED_ATTRIBUTES_MISSING/,
  );
  assert.equal(attributeEvents.some((event) => event.startsWith("upload:")), false);
});

test("Shopee SG publish.shop_region alone cannot bypass strict CREATE preflight", async () => {
  const publishOnlyInput = input();
  delete publishOnlyInput.arguments.country;
  delete publishOnlyInput.arguments.publicationExpectedLocale;
  delete publishOnlyInput.arguments.sellerpilotShopeeSgCreateContext;
  const publish = publishOnlyInput.arguments.publish as Record<string, unknown>;
  assert.equal(publish.shop_region, "SG");

  const events: string[] = [];
  await assert.rejects(
    prepareShopeeGlobalListing(publishOnlyInput, dependencies({ events })),
    /SHOPEE_SG_CREATE_PREWRITE_MISMATCH/,
  );
  assert.deepEqual(events, [], "strict request validation must precede every provider read or upload");
});
