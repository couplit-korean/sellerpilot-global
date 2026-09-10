import assert from "node:assert/strict";
import test from "node:test";

import {
  executeShopeeSgLocalResumeOrchestration,
  executeShopeeSgCreateOrchestration,
  type ShopeeSgCreateOrchestrationDependencies,
} from "../lib/product-registration/shopee/create-orchestration";
import type {
  ShopeeSgRequirementReaders,
  ShopeeSgRequirementRemote,
} from "../lib/product-registration/shopee/provider-requirements";
import {
  bindShopeeSgListingCreateArguments,
  shopeeSgListingCreateContextContract,
  type ShopeeSgListingCreateContext,
} from "../lib/channels/shopee-sg-listing-create";
import {
  shopeeSgCreateExecutionLineageArgument,
  shopeeSgCreateExecutionLineageContract,
} from "../lib/product-registration/shopee/target-lineage-readiness";
import type { ShopeeSgCreateCredentialRevision } from "../lib/product-registration/shopee/create-prewrite-adapter";

const credentialId = "22222222-2222-4222-8222-222222222222";
const merchantId = "5511564";
const shopId = "1719148844";
const categoryId = 100787;
const localCategoryId = 200787;
const sku = "AUTO-780720401E2D4E4EA45F";
const globalName = "Lotte Sand Milk Cream Biscuits 315g Pack of 6";
const localName = "Lotte Sand Milk Cream Biscuits 315g - 6 Packs";
const now = new Date("2026-09-10T04:00:00.000Z");
const roles = [
  "detail-hero", "detail-overview", "detail-feature-one", "detail-feature-two",
  "detail-specification", "detail-use", "detail-care", "detail-closing",
];

function image(index: number) {
  const digest = index.toString(16).padStart(64, "0");
  const objectPath = `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
  return {
    publicUrl: `https://qa-project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256: digest,
  };
}

function credential(overrides: Partial<ShopeeSgCreateCredentialRevision> = {}) {
  return {
    credentialId,
    credentialVersion: 81,
    credentialSnapshotSha256: "c".repeat(64),
    merchantId,
    shopId,
    region: "SG" as const,
    ...overrides,
  };
}

function context(): ShopeeSgListingCreateContext {
  return {
    contract: shopeeSgListingCreateContextContract,
    productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
    sku,
    sourceCurrency: "KRW",
    sourcePriceKrw: 25_000,
    market: "SG",
    locale: "en-SG",
    targetId: shopId,
    targetCurrency: "SGD",
    targetPriceSgd: 25,
    targetPriceSource: "stored_channel_price",
    globalCurrency: "USD",
    globalPriceUsd: 20,
    globalPriceSource: "stored_global_price",
    quantity: 3,
    categoryId: String(categoryId),
    categoryPath: ["Food & Beverages", "Snacks", "Biscuits, Cookies & Wafers"],
    categoryConfirmedAt: "2026-09-10T03:30:00.000Z",
    rate: {
      krwPerSgd: 1_000,
      krwPerUsd: 1_250,
      fetchedAt: "2026-09-10T03:59:00.000Z",
      asOf: "2026-09-10T03:59:00.000Z",
      source: "Coinbase Data API",
      sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
      frequency: "minute-market",
    },
  };
}

function argumentsValue() {
  const approved = roles.map((role, index) => ({
    role,
    approvedObjectPath: `results/20000000-0000-4000-8000-000000000001/claims/30000000-0000-4000-8000-000000000001/${index + 1}.png`,
    approvedSourceSha256: (index + 20).toString(16).padStart(64, "0"),
    ...image(index + 1),
  }));
  const bound = bindShopeeSgListingCreateArguments({
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "en-SG",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 1,
      approvedManifestDigest: "b".repeat(64),
      approvedDetailImages: approved,
      providerImageSurface: "buyer_visible",
      providerTransportImages: roles.map((role, index) => ({ role, ...image(index + 1) })),
    },
    imageUrls: [image(9).publicUrl, ...approved.map((item) => item.publicUrl)],
    body: {
      global_item_name: globalName,
      description: "Enjoy crisp sandwich biscuits with a smooth milk cream filling, packed for convenient everyday snacks and sharing.",
      brand: { brand_id: 101, original_brand_name: "Fixture Brand" },
      attribute_list: [{ attribute_id: 100010, attribute_value_list: [{ value_id: 580 }] }],
      weight: 0.4,
      dimension: { package_length: 20, package_width: 15, package_height: 12 },
      days_to_ship: 4,
      condition: "NEW",
    },
    publish: { item: {
      item_name: localName,
      description: "Enjoy crisp sandwich biscuits with a smooth milk cream filling, packed for convenient everyday snacks and sharing.",
      brand: { brand_id: 101, original_brand_name: "Fixture Brand" },
      attribute_list: [{ attribute_id: 100010, attribute_value_list: [{ value_id: 580 }] }],
      weight: 0.4,
      dimension: { package_length: 20, package_width: 15, package_height: 12 },
      days_to_ship: 4,
      condition: "NEW",
      logistic: [{ logistic_id: 18036, enabled: true }],
    } },
  }, context());
  const body = bound.body as Record<string, unknown>;
  const publish = bound.publish as Record<string, unknown>;
  const item = publish.item as Record<string, unknown>;
  body.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  item.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  bound[shopeeSgCreateExecutionLineageArgument] = {
    contract: shopeeSgCreateExecutionLineageContract,
    credentialId,
    credentialVersion: 81,
    targetId: shopId,
    marketCode: "SG",
  };
  return bound;
}

function remote(data: Record<string, unknown>, ok = true): ShopeeSgRequirementRemote {
  return { response: { ok }, data };
}

function authoritativeReaders(events: string[], existingGlobal = false): ShopeeSgRequirementReaders {
  return {
    merchantGet: async (path, query) => {
      events.push(`merchant:${path}?${query.toString()}`);
      if (path.endsWith("get_merchant_info")) return remote({ error: "", response: { merchant_id: Number(merchantId) } });
      if (path.endsWith("get_category")) return remote({ error: "", response: { category_list: [
        { category_id: 100629, parent_category_id: 0, display_category_name: "Food & Beverages", has_children: true },
        { category_id: 100646, parent_category_id: 100629, display_category_name: "Snacks", has_children: true },
        { category_id: categoryId, parent_category_id: 100646, display_category_name: "Biscuits, Cookies & Wafers", has_children: false },
      ] } });
      if (path.endsWith("get_attribute_tree")) return remote({ error: "", response: { list: [{ category_id: categoryId, attribute_tree: [{
        attribute_id: 100010,
        mandatory: true,
        attribute_info: { input_type: 1, max_value_count: 1, mandatory_region: ["SG"] },
        attribute_value_list: [{ value_id: 580, name: "6 Months" }],
      }] }] } });
      if (path.endsWith("get_brand_list")) return remote({ error: "", response: {
        brand_list: [{ brand_id: 101, display_brand_name: "Fixture Brand" }],
        has_next_page: false,
        next_offset: 0,
        is_mandatory: true,
        input_type: "DROP_DOWN",
      } });
      if (path.endsWith("get_global_item_list")) return remote({ error: "", response: {
        global_item_list: existingGlobal ? [{ global_item_id: 7001 }] : [],
        total_count: existingGlobal ? 1 : 0,
        has_next_page: false,
      } });
      if (path.endsWith("get_global_item_info") && existingGlobal) return remote({ error: "", response: { global_item_list: [{
        global_item_id: 7001,
        global_item_sku: sku,
        global_item_name: globalName,
      }] } });
      throw new Error(`unexpected merchant read ${path}`);
    },
    merchantPost: async (path, body) => {
      events.push(`merchant:${path}:${JSON.stringify(body)}`);
      if (path.endsWith("get_merchant_warehouse_list")) return remote({ error: null, response: {
        warehouse_list: [{ warehouse_id: 9001, location_id: "SG-LOC", warehouse_name: "API Pickup" }],
        cursor: { next_id: null, page_size: 30 },
      } });
      if (path.endsWith("get_warehouse_eligible_shop_list")) return remote({ error: null, response: {
        shop_list: [{ shop_id: Number(shopId), shop_name: "gjrxn.sg" }],
        cursor: { next_id: null, page_size: 30 },
      } });
      throw new Error(`unexpected merchant read ${path}`);
    },
    shopGet: async (path, query) => {
      events.push(`shop:${path}?${query.toString()}`);
      if (path.endsWith("get_shop_info")) return remote({ error: "", response: { shop_id: Number(shopId), region: "SG" } });
      if (path.endsWith("category_recommend")) return remote({ error: "", response: { category_id: [localCategoryId] } });
      if (path.endsWith("get_category")) return remote({ error: "", response: { category_list: [{ category_id: localCategoryId, has_children: false }] } });
      if (path.endsWith("get_channel_list")) return remote({ error: "", response: { logistics_channel_list: [{
        logistics_channel_id: 18036,
        enabled: true,
        compulsory_channel: false,
        fee_type: "NO_SELECTION",
        weight_limit: { item_min_weight: 0, item_max_weight: 30 },
        item_max_dimension: { length: 100, width: 100, height: 100, dimension_sum: 300 },
      }] } });
      if (path.endsWith("get_item_list")) return remote({ error: "", response: { item: [], total_count: 0, has_next_page: false } });
      throw new Error(`unexpected shop read ${path}`);
    },
  };
}

function runtime(input: {
  events: string[];
  currentCredential?: () => ShopeeSgCreateCredentialRevision;
  globalReadbackSku?: string;
  localReadbackName?: string;
  existingGlobal?: boolean;
}) {
  const providerMutationCounts = { global: 0, local: 0 };
  let mediaPrepareCalls = 0;
  const dependencies: ShopeeSgCreateOrchestrationDependencies = {
    readers: authoritativeReaders(input.events, input.existingGlobal),
    readCurrentCredential: async () => input.currentCredential?.() ?? credential(),
    assertLeaseHealthy: async () => undefined,
    beginProviderMutation: async (stage) => { input.events.push(`begin:${stage}`); },
    completeProviderMutation: async (stage) => { input.events.push(`complete:${stage}`); },
    prepareProviderImages: async (source) => {
      mediaPrepareCalls += 1;
      input.events.push("prepare:provider-images");
      const next = structuredClone(source);
      const details = Array.from({ length: 8 }, (_value, index) => `detail-${index + 1}`);
      const gallery = ["representative-1", ...details];
      const body = next.body as Record<string, unknown>;
      const publish = next.publish as Record<string, unknown>;
      const item = publish.item as Record<string, unknown>;
      body.image = { image_id_list: gallery };
      item.image = { image_id_list: gallery };
      next.sellerpilotProviderDetailImageIds = details;
      next.sellerpilotProviderImageSurface = "gallery";
      return next;
    },
    createGlobalItem: async (body) => {
      providerMutationCounts.global += 1;
      input.events.push("mutate:add_global_item");
      assert.equal(body.global_item_sku, sku);
      return remote({ error: "", response: { global_item_id: 7001 } });
    },
    readGlobalItem: async () => remote({ error: "", response: { global_item_list: [{
      global_item_id: 7001,
      global_item_sku: input.globalReadbackSku ?? sku,
      global_item_name: globalName,
      category_id: categoryId,
      original_price: 20,
      normal_stock: 3,
      seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
    }] } }),
    createLocalPublish: async (body) => {
      providerMutationCounts.local += 1;
      input.events.push("mutate:create_publish_task");
      assert.equal(body.global_item_id, 7001);
      return remote({ error: "", response: { publish_task_id: 7101 } });
    },
    readLocalPublication: async () => ({
      publishedRemote: remote({ error: "", response: { published_item: [{
        global_item_id: 7001,
        shop_id: Number(shopId),
        item_id: 8001,
      }] } }),
      localRemote: remote({ error: "", response: { item_list: [{
        item_id: 8001,
        item_sku: sku,
        item_name: input.localReadbackName ?? localName,
        category_id: localCategoryId,
        original_price: 25,
        normal_stock: 3,
        seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
        logistic_info: [{ logistic_id: 18036, enabled: true }],
      }] } }),
    }),
    now: () => now,
  };
  return { dependencies, providerMutationCounts, mediaPrepareCalls: () => mediaPrepareCalls };
}

test("one authoritative read set permits exactly one global CREATE and one local publish", async () => {
  const events: string[] = [];
  const fixture = runtime({ events });
  const result = await executeShopeeSgCreateOrchestration({
    argumentsValue: argumentsValue(),
    credential: credential(),
    dependencies: fixture.dependencies,
  });
  assert.equal(result.ok, true);
  assert.equal(result.globalItemId, "7001");
  assert.equal(result.localItemId, "8001");
  assert.deepEqual(result.providerMutationCounts, { globalItemCreate: 1, localPublish: 1 });
  assert.deepEqual(fixture.providerMutationCounts, { global: 1, local: 1 });
  assert.equal(fixture.mediaPrepareCalls(), 1);
  for (const suffix of [
    "get_merchant_info", "get_shop_info", "/api/v2/global_product/get_category?",
    "get_attribute_tree", "get_brand_list", "category_recommend",
    "/api/v2/product/get_category?", "get_channel_list", "get_merchant_warehouse_list",
    "get_warehouse_eligible_shop_list", "get_global_item_list",
  ]) {
    assert.equal(events.filter((event) => event.includes(suffix)).length, 1, suffix);
  }
  assert.equal(events.filter((event) => event.includes("product/get_item_list")).length, 4);
  assert.ok(events.indexOf("begin:global-item-create") < events.indexOf("mutate:add_global_item"));
  assert.ok(events.indexOf("begin:local-publish") < events.indexOf("mutate:create_publish_task"));
});

test("every prewrite validation failure leaves both provider mutation counts at zero", async () => {
  for (const mutate of [
    (value: Record<string, unknown>) => { delete (value.body as Record<string, unknown>).days_to_ship; },
    (value: Record<string, unknown>) => { value.imageUrls = []; },
    (value: Record<string, unknown>) => {
      ((value.body as Record<string, unknown>).seller_stock as Array<Record<string, unknown>>)[0].location_id = "TWS03";
    },
  ]) {
    const events: string[] = [];
    const fixture = runtime({ events });
    const source = argumentsValue();
    mutate(source);
    await assert.rejects(executeShopeeSgCreateOrchestration({
      argumentsValue: source,
      credential: credential(),
      dependencies: fixture.dependencies,
    }));
    assert.deepEqual(fixture.providerMutationCounts, { global: 0, local: 0 });
    assert.equal(fixture.mediaPrepareCalls(), 0);
    assert.equal(events.some((event) => event.startsWith("begin:")), false);
  }
});

test("credential drift at the global mutation guard leaves both mutations at zero", async () => {
  let reads = 0;
  const events: string[] = [];
  const fixture = runtime({
    events,
    currentCredential: () => {
      reads += 1;
      return reads < 32 ? credential() : credential({
        credentialVersion: 82,
        credentialSnapshotSha256: "d".repeat(64),
      });
    },
  });
  await assert.rejects(executeShopeeSgCreateOrchestration({
    argumentsValue: argumentsValue(),
    credential: credential(),
    dependencies: fixture.dependencies,
  }), /SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED/u);
  assert.deepEqual(fixture.providerMutationCounts, { global: 0, local: 0 });
});

test("failed exact global readback permits no local publish retry", async () => {
  const events: string[] = [];
  const fixture = runtime({ events, globalReadbackSku: "OTHER-SKU" });
  await assert.rejects(executeShopeeSgCreateOrchestration({
    argumentsValue: argumentsValue(),
    credential: credential(),
    dependencies: fixture.dependencies,
  }), /SHOPEE_SG_GLOBAL_CREATE_READBACK_INVALID/u);
  assert.deepEqual(fixture.providerMutationCounts, { global: 1, local: 0 });
});

test("local readback must preserve exact identity, price, stock, warehouse and logistics", async () => {
  const events: string[] = [];
  const fixture = runtime({ events, localReadbackName: "Different product" });
  await assert.rejects(executeShopeeSgCreateOrchestration({
    argumentsValue: argumentsValue(),
    credential: credential(),
    dependencies: fixture.dependencies,
  }), /SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID/u);
  assert.deepEqual(fixture.providerMutationCounts, { global: 1, local: 1 });
});

test("local resume owns the exact Global ID and never repeats Global CREATE", async () => {
  const firstEvents: string[] = [];
  const first = runtime({ events: firstEvents });
  const created = await executeShopeeSgCreateOrchestration({
    argumentsValue: argumentsValue(),
    credential: credential(),
    dependencies: first.dependencies,
  });
  const resumeEvents: string[] = [];
  const resumed = runtime({ events: resumeEvents, existingGlobal: true });
  const result = await executeShopeeSgLocalResumeOrchestration({
    argumentsValue: created.argumentsValue,
    credential: credential(),
    globalItemId: created.globalItemId,
    dependencies: {
      ...resumed.dependencies,
      readExistingLocalPublication: async () => null,
    },
  });
  assert.equal(result.recovered, false);
  assert.deepEqual(result.providerMutationCounts, { globalItemCreate: 0, localPublish: 1 });
  assert.deepEqual(resumed.providerMutationCounts, { global: 0, local: 1 });
  assert.equal(resumed.mediaPrepareCalls(), 0, "persisted native image binding is reused");
  assert.equal(resumeEvents.includes("mutate:add_global_item"), false);
});

test("local resume reconciles an already published exact item with zero provider mutations", async () => {
  const first = runtime({ events: [] });
  const created = await executeShopeeSgCreateOrchestration({
    argumentsValue: argumentsValue(),
    credential: credential(),
    dependencies: first.dependencies,
  });
  const resume = runtime({ events: [] });
  const result = await executeShopeeSgLocalResumeOrchestration({
    argumentsValue: created.argumentsValue,
    credential: credential(),
    globalItemId: created.globalItemId,
    dependencies: {
      ...resume.dependencies,
      readExistingLocalPublication: async () => resume.dependencies.readLocalPublication({
        globalItemId: created.globalItemId,
        publishTaskId: created.publishTaskId,
        shopId,
      }),
    },
  });
  assert.equal(result.recovered, true);
  assert.deepEqual(result.providerMutationCounts, { globalItemCreate: 0, localPublish: 0 });
  assert.deepEqual(resume.providerMutationCounts, { global: 0, local: 0 });
  assert.equal(resume.mediaPrepareCalls(), 0);
});
