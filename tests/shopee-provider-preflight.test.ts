import assert from "node:assert/strict";
import test from "node:test";
import {
  planShopeeGlobalImages,
  prepareMarketplaceListingArguments,
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

const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const ATTEMPT_ID = "20000000-0000-4000-8000-000000000001";
const CLAIM_ID = "30000000-0000-4000-8000-000000000001";
const SKU = "QA-20260823-CC-001";
const MERCHANT_ID = "5511564";
const SHOP_ID = "1719148844";
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
    targetId: SHOP_ID,
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
        shop_id: Number(SHOP_ID),
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
      merchant_id: MERCHANT_ID,
      access_token: "merchant-access",
    },
    shopeeShopCredential: {
      partner_id: "1001",
      partner_key: "shop-key",
      shop_id: SHOP_ID,
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
  merchantInventoryRequest?: (
    path: string,
    query: URLSearchParams,
  ) => RemoteResponse | null;
  shopInventoryRequest?: (
    path: string,
    query: URLSearchParams,
  ) => RemoteResponse | null;
}): ShopeeGlobalListingRuntimeDependencies {
  let uploadIndex = 0;
  return {
    shopRequest: async ({ path, query }) => {
      inputValue.events.push(`shop:${path}?${query?.toString() ?? ""}`);
      const inventoryOverride = inputValue.shopInventoryRequest?.(
        path,
        query ?? new URLSearchParams(),
      );
      if (inventoryOverride) return inventoryOverride;
      if (path.endsWith("get_item_list")) {
        return remote({
          error: "",
          response: { item: [], total_count: 0, has_next_page: false },
        });
      }
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
      const inventoryOverride = inputValue.merchantInventoryRequest?.(
        path,
        query ?? new URLSearchParams(),
      );
      if (inventoryOverride) return inventoryOverride;
      if (path.endsWith("get_global_item_list")) {
        return remote({
          error: "",
          response: { global_item_list: [], total_count: 0, has_next_page: false },
        });
      }
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

type GlobalInventoryItem = {
  global_item_id: number;
  global_item_sku: string;
};

type LocalInventoryItem = {
  item_id: number;
  item_sku: string;
  item_status: "NORMAL" | "UNLIST" | "BANNED" | "DELETED";
};

function page<T>(items: readonly T[], query: URLSearchParams) {
  const offset = Number(query.get("offset"));
  const pageSize = Number(query.get("page_size"));
  const rows = items.slice(offset, offset + pageSize);
  return {
    rows,
    totalCount: items.length,
    hasNextPage: offset + rows.length < items.length,
  };
}

function globalInventory(items: readonly GlobalInventoryItem[]) {
  return (path: string, query: URLSearchParams) => {
    if (path.endsWith("get_global_item_list")) {
      const current = page(items, query);
      return remote({
        error: "",
        response: {
          global_item_list: current.rows.map(({ global_item_id }) => ({ global_item_id })),
          total_count: current.totalCount,
          has_next_page: current.hasNextPage,
        },
      });
    }
    if (path.endsWith("get_global_item_info")) {
      const requested = new Set((query.get("global_item_id_list") ?? "").split(","));
      return remote({
        error: "",
        response: {
          global_item_list: items.filter((item) => requested.has(String(item.global_item_id))),
        },
      });
    }
    return null;
  };
}

function localInventory(items: readonly LocalInventoryItem[]) {
  return (path: string, query: URLSearchParams) => {
    if (path.endsWith("get_item_list")) {
      const statusItems = items.filter((item) => item.item_status === query.get("item_status"));
      const current = page(statusItems, query);
      return remote({
        error: "",
        response: {
          item: current.rows.map(({ item_id, item_status }) => ({ item_id, item_status })),
          total_count: current.totalCount,
          has_next_page: current.hasNextPage,
        },
      });
    }
    if (path.endsWith("get_item_base_info")) {
      const requested = new Set((query.get("item_id_list") ?? "").split(","));
      return remote({
        error: "",
        response: {
          item_list: items.filter((item) => requested.has(String(item.item_id))),
        },
      });
    }
    return null;
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
  assert.equal(firstUpload, 12);
  assert.equal(events.slice(0, firstUpload).every((event) => !event.startsWith("upload:")), true);
  assert.equal(events.some((event) => event.includes("global_product/get_global_item_list?offset=0&page_size=100")), true);
  assert.equal(events.filter((event) => event.includes("product/get_item_list?")).length, 4);
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
  assert.deepEqual(prepared.sellerpilotShopeeSgExactSkuAbsenceEvidence, {
    contract: "sellerpilot_shopee_sg_exact_sku_absence_v1",
    sku: SKU,
    globalItemCount: 0,
    localItemCount: 0,
    localStatuses: ["NORMAL", "UNLIST", "BANNED", "DELETED"],
  });
  assert.deepEqual(
    prepared.sellerpilotProviderDetailImageIds,
    Array.from({ length: 8 }, (_, index) => `image-${index + 2}`),
  );
});

test("Shopee SG exact create scans every Global and SG inventory page before the first media mutation", async () => {
  const globalItems = Array.from({ length: 101 }, (_, index) => ({
    global_item_id: 50_000 + index,
    global_item_sku: `OTHER-GLOBAL-${index}`,
  }));
  const localItems = Array.from({ length: 101 }, (_, index) => ({
    item_id: 60_000 + index,
    item_sku: `OTHER-LOCAL-${index}`,
    item_status: "UNLIST" as const,
  }));
  const events: string[] = [];
  const prepared = await prepareShopeeGlobalListing(input(), dependencies({
    events,
    merchantInventoryRequest: globalInventory(globalItems),
    shopInventoryRequest: localInventory(localItems),
  }));
  const firstUpload = events.findIndex((event) => event.startsWith("upload:"));
  assert.ok(firstUpload > 0);
  assert.equal(events.slice(0, firstUpload).every((event) => !event.startsWith("upload:")), true);
  assert.equal(events.some((event) => event.includes("get_global_item_list?offset=100&page_size=100")), true);
  assert.equal(events.some((event) => event.includes("get_item_list?item_status=UNLIST&offset=100&page_size=100")), true);
  assert.equal(events.filter((event) => event.includes("get_global_item_info?")).length, 3);
  assert.equal(events.filter((event) => event.includes("get_item_base_info?")).length, 3);
  assert.deepEqual(prepared.sellerpilotShopeeSgExactSkuAbsenceEvidence, {
    contract: "sellerpilot_shopee_sg_exact_sku_absence_v1",
    sku: SKU,
    globalItemCount: 101,
    localItemCount: 101,
    localStatuses: ["NORMAL", "UNLIST", "BANNED", "DELETED"],
  });
});

test("Shopee SG exact create rejects any existing exact SKU globally or locally with zero provider writes", async () => {
  for (const [surface, count, error] of [
    ["global", 1, /SHOPEE_SG_EXACT_SKU_ALREADY_EXISTS_GLOBAL/],
    ["global", 2, /SHOPEE_SG_EXACT_SKU_ALREADY_EXISTS_GLOBAL/],
    ["local", 1, /SHOPEE_SG_EXACT_SKU_ALREADY_EXISTS_LOCAL/],
    ["local", 2, /SHOPEE_SG_EXACT_SKU_ALREADY_EXISTS_LOCAL/],
  ] as const) {
    const events: string[] = [];
    let mutationStarts = 0;
    const candidate = input();
    candidate.hooks.beginProviderMutation = async () => { mutationStarts += 1; };
    const globalItems = surface === "global"
      ? Array.from({ length: count }, (_, index) => ({
          global_item_id: 70_000 + index,
          global_item_sku: SKU,
        }))
      : [];
    const localItems = surface === "local"
      ? Array.from({ length: count }, (_, index) => ({
          item_id: 80_000 + index,
          item_sku: SKU,
          item_status: "UNLIST" as const,
        }))
      : [];
    await assert.rejects(
      prepareShopeeGlobalListing(candidate, dependencies({
        events,
        merchantInventoryRequest: globalInventory(globalItems),
        shopInventoryRequest: localInventory(localItems),
      })),
      error,
      `${surface}:${count}`,
    );
    assert.equal(events.some((event) => event.startsWith("upload:")), false, `${surface}:${count}`);
    assert.equal(mutationStarts, 0, `${surface}:${count}`);
  }
});

test("Shopee SG exact create fails closed on incomplete, duplicate, or failed inventory reads", async () => {
  const cases: Array<{
    name: string;
    merchantInventoryRequest?: (
      path: string,
      query: URLSearchParams,
    ) => RemoteResponse | null;
    shopInventoryRequest?: (
      path: string,
      query: URLSearchParams,
    ) => RemoteResponse | null;
    error: RegExp;
  }> = [
    {
      name: "global transport failure",
      merchantInventoryRequest: (path) => path.endsWith("get_global_item_list")
        ? remote({ error: "system_error" }, 503)
        : null,
      error: /SHOPEE_SG_EXACT_GLOBAL_INVENTORY_INCOMPLETE/,
    },
    {
      name: "global total missing",
      merchantInventoryRequest: (path) => path.endsWith("get_global_item_list")
        ? remote({ error: "", response: { global_item_list: [], has_next_page: false } })
        : null,
      error: /SHOPEE_SG_EXACT_GLOBAL_INVENTORY_INCOMPLETE/,
    },
    {
      name: "global duplicate page identity",
      merchantInventoryRequest: (path, query) => {
        if (!path.endsWith("get_global_item_list")) return null;
        const offset = Number(query.get("offset"));
        const ids = offset === 0
          ? Array.from({ length: 100 }, (_, index) => ({ global_item_id: 90_000 + index }))
          : [{ global_item_id: 90_000 }];
        return remote({
          error: "",
          response: { global_item_list: ids, total_count: 101, has_next_page: offset === 0 },
        });
      },
      error: /SHOPEE_SG_EXACT_GLOBAL_INVENTORY_INCOMPLETE/,
    },
    {
      name: "local page body missing",
      shopInventoryRequest: (path) => path.endsWith("get_item_list")
        ? remote({ error: "", response: { total_count: 0, has_next_page: false } })
        : null,
      error: /SHOPEE_SG_EXACT_LOCAL_INVENTORY_INCOMPLETE/,
    },
    {
      name: "local detail SKU missing",
      shopInventoryRequest: (path, query) => {
        if (path.endsWith("get_item_list")) {
          const hasItem = query.get("item_status") === "UNLIST";
          return remote({
            error: "",
            response: {
              item: hasItem ? [{ item_id: 95_001 }] : [],
              total_count: hasItem ? 1 : 0,
              has_next_page: false,
            },
          });
        }
        return path.endsWith("get_item_base_info")
          ? remote({ error: "", response: { item_list: [{ item_id: 95_001 }] } })
          : null;
      },
      error: /SHOPEE_SG_EXACT_LOCAL_INVENTORY_INCOMPLETE/,
    },
  ];
  for (const fixture of cases) {
    const events: string[] = [];
    let mutationStarts = 0;
    const candidate = input();
    candidate.hooks.beginProviderMutation = async () => { mutationStarts += 1; };
    await assert.rejects(
      prepareShopeeGlobalListing(candidate, dependencies({
        events,
        merchantInventoryRequest: fixture.merchantInventoryRequest,
        shopInventoryRequest: fixture.shopInventoryRequest,
      })),
      fixture.error,
      fixture.name,
    );
    assert.equal(events.some((event) => event.startsWith("upload:")), false, fixture.name);
    assert.equal(mutationStarts, 0, fixture.name);
  }
});

test("Shopee SG exact create binds the provider-selected merchant and shop before every provider read", async () => {
  for (const [name, mutate] of [
    ["merchant", (value: PrepareProviderListingInput) => { value.credential.merchant_id = "5511565"; }],
    ["shop", (value: PrepareProviderListingInput) => {
      if (value.shopeeShopCredential) value.shopeeShopCredential.shop_id = "1719148845";
    }],
  ] as const) {
    const candidate = input();
    mutate(candidate);
    const events: string[] = [];
    await assert.rejects(
      prepareShopeeGlobalListing(candidate, dependencies({ events })),
      /SHOPEE_SG_EXACT_CREATE_PROVIDER_BINDING_MISMATCH/,
      name,
    );
    assert.deepEqual(events, [], name);
  }
});

test("Shopee SG exact create cannot use resume-only to bypass a fresh pre-media inventory scan", async () => {
  const candidate = input();
  candidate.arguments.resumeOnly = true;
  let mutationStarts = 0;
  candidate.hooks.beginProviderMutation = async () => { mutationStarts += 1; };
  await assert.rejects(
    prepareMarketplaceListingArguments(candidate),
    /SHOPEE_SG_EXACT_CREATE_RESUME_REQUIRES_FRESH_PREFLIGHT/,
  );
  assert.equal(mutationStarts, 0);
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
