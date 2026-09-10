import assert from "node:assert/strict";
import test from "node:test";

import {
  assertShopeeSgCreatePrewriteAtMutation,
  prepareShopeeSgCreatePrewrite,
  shopeeSgCreatePrewriteContract,
  shopeeSgCreatePrewriteEvidenceArgument,
  type ShopeeSgCreateCredentialRevision,
} from "../lib/product-registration/shopee/create-prewrite-adapter";
import {
  bindShopeeSgListingCreateArguments,
  shopeeSgListingCreateContextContract,
  type ShopeeSgListingCreateContext,
} from "../lib/channels/shopee-sg-listing-create";
import {
  shopeeSgCreateExecutionLineageArgument,
  shopeeSgCreateExecutionLineageContract,
} from "../lib/product-registration/shopee/target-lineage-readiness";
import type {
  ShopeeSgRequirementReaders,
  ShopeeSgRequirementRemote,
} from "../lib/product-registration/shopee/provider-requirements";

const credentialId = "22222222-2222-4222-8222-222222222222";
const merchantId = "5511564";
const shopId = "1719148844";
const categoryId = 100787;
const localCategoryId = 200787;
const sku = "AUTO-780720401E2D4E4EA45F";
const globalName = "Lotte Sand Milk Cream Biscuits 315g Pack of 6";
const localName = "Lotte Sand Milk Cream Biscuits 315g - 6 Packs";
const now = new Date("2026-09-10T04:00:00.000Z");
const attemptId = "20000000-0000-4000-8000-000000000001";
const claimId = "30000000-0000-4000-8000-000000000001";
const detailRoles = [
  "detail-hero", "detail-overview", "detail-feature-one", "detail-feature-two",
  "detail-specification", "detail-use", "detail-care", "detail-closing",
];

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
  return {
    contract: "sellerpilot_publication_asset_binding_v1",
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "b".repeat(64),
    approvedDetailImages: detailRoles.map((role, index) => ({
      role,
      approvedObjectPath: `results/${attemptId}/claims/${claimId}/${index + 1}.png`,
      approvedSourceSha256: (index + 20).toString(16).padStart(64, "0"),
      ...image(index + 1),
    })),
    providerImageSurface: "buyer_visible",
    providerTransportImages: detailRoles.map((role, index) => ({ role, ...image(index + 1) })),
  };
}

function credential(
  overrides: Partial<ShopeeSgCreateCredentialRevision> = {},
): ShopeeSgCreateCredentialRevision {
  return {
    credentialId,
    credentialVersion: 81,
    credentialSnapshotSha256: "c".repeat(64),
    merchantId,
    shopId,
    region: "SG",
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
  const detailImages = detailRoles.map((_role, index) => image(index + 1).publicUrl);
  const bound = bindShopeeSgListingCreateArguments({
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "en-SG",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    sellerpilotPublicationAssetBinding: publicationBinding(),
    imageUrls: [image(9).publicUrl, ...detailImages],
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
    publish: {
      item: {
        item_name: localName,
        description: "Enjoy crisp sandwich biscuits with a smooth milk cream filling, packed for convenient everyday snacks and sharing.",
        brand: { brand_id: 101, original_brand_name: "Fixture Brand" },
        attribute_list: [{ attribute_id: 100010, attribute_value_list: [{ value_id: 580 }] }],
        weight: 0.4,
        dimension: { package_length: 20, package_width: 15, package_height: 12 },
      days_to_ship: 4,
      condition: "NEW",
        logistic: [{ logistic_id: 18036, enabled: true }],
      },
    },
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

type ExistingGlobal = { global_item_id: number; global_item_sku: string; global_item_name: string };
type ExistingLocal = { item_id: number; item_sku: string; item_name: string; item_status: string };

function readers(input: {
  events?: string[];
  global?: ExistingGlobal[];
  local?: ExistingLocal[];
  warehouseLocationId?: string;
} = {}): ShopeeSgRequirementReaders {
  const events = input.events ?? [];
  const global = input.global ?? [];
  const local = input.local ?? [];
  const warehouseLocationId = input.warehouseLocationId ?? "SG-LOC";
  return {
    merchantGet: async (path, query) => {
      events.push(`merchant:get:${path}?${query.toString()}`);
      if (path.endsWith("get_merchant_info")) {
        return remote({ error: "", response: { merchant_id: Number(merchantId), merchant_name: "Couplit.kr" } });
      }
      if (path.endsWith("get_category")) {
        return remote({ error: "", response: { category_list: [
          { category_id: 100629, parent_category_id: 0, display_category_name: "Food & Beverages", has_children: true },
          { category_id: 100646, parent_category_id: 100629, display_category_name: "Snacks", has_children: true },
          { category_id: categoryId, parent_category_id: 100646, display_category_name: "Biscuits, Cookies & Wafers", has_children: false },
        ] } });
      }
      if (path.endsWith("get_attribute_tree")) {
        return remote({ error: "", response: { list: [{
          category_id: categoryId,
          attribute_tree: [{
            attribute_id: 100010,
            name: "Shelf Life",
            mandatory: true,
            attribute_info: { input_type: 1, max_value_count: 1, mandatory_region: ["SG"] },
            attribute_value_list: [{ value_id: 580, name: "6 Months" }],
          }],
        }] } });
      }
      if (path.endsWith("get_brand_list")) {
        return remote({ error: "", response: {
          brand_list: [{ brand_id: 101, display_brand_name: "Fixture Brand" }],
          has_next_page: false,
          next_offset: 0,
          is_mandatory: true,
          input_type: "DROP_DOWN",
        } });
      }
      if (path.endsWith("get_global_item_list")) {
        return remote({ error: "", response: {
          global_item_list: global.map(({ global_item_id }) => ({ global_item_id })),
          total_count: global.length,
          has_next_page: false,
        } });
      }
      if (path.endsWith("get_global_item_info")) {
        return remote({ error: "", response: { global_item_list: global } });
      }
      throw new Error(`unexpected merchant GET ${path}`);
    },
    merchantPost: async (path, body) => {
      events.push(`merchant:post:${path}:${JSON.stringify(body)}`);
      if (path.endsWith("get_merchant_warehouse_list")) {
        return remote({ error: null, response: {
          warehouse_list: [{ warehouse_id: 9001, location_id: warehouseLocationId, warehouse_name: "API Pickup" }],
          cursor: { next_id: null, page_size: 30 },
        } });
      }
      if (path.endsWith("get_warehouse_eligible_shop_list")) {
        return remote({ error: null, response: {
          shop_list: [{ shop_id: Number(shopId), shop_name: "gjrxn.sg" }],
          cursor: { next_id: null, page_size: 30 },
        } });
      }
      throw new Error(`unexpected merchant POST ${path}`);
    },
    shopGet: async (path, query) => {
      events.push(`shop:get:${path}?${query.toString()}`);
      if (path.endsWith("get_shop_info")) {
        return remote({ error: "", response: { shop_id: Number(shopId), shop_name: "gjrxn.sg", region: "SG" } });
      }
      if (path.endsWith("category_recommend")) {
        return remote({ error: "", response: { category_id: [localCategoryId] } });
      }
      if (path.endsWith("get_category")) {
        return remote({ error: "", response: { category_list: [
          { category_id: localCategoryId, parent_category_id: 200000, display_category_name: "Biscuits", has_children: false },
        ] } });
      }
      if (path.endsWith("get_channel_list")) {
        return remote({ error: "", response: { logistics_channel_list: [{
          logistics_channel_id: 18036,
          enabled: true,
          compulsory_channel: false,
          fee_type: "NO_SELECTION",
          weight_limit: { item_min_weight: 0, item_max_weight: 30 },
          item_max_dimension: { length: 100, width: 100, height: 100, dimension_sum: 300 },
        }] } });
      }
      if (path.endsWith("get_item_list")) {
        const status = query.get("item_status");
        const selected = local.filter((item) => item.item_status === status);
        return remote({ error: "", response: {
          item: selected.map(({ item_id, item_status }) => ({ item_id, item_status })),
          total_count: selected.length,
          has_next_page: false,
        } });
      }
      if (path.endsWith("get_item_base_info")) {
        return remote({ error: "", response: { item_list: local } });
      }
      throw new Error(`unexpected shop GET ${path}`);
    },
  };
}

test("Shopee SG prewrite binds official requirements, exact duplicate absence, content, prices and stock to one credential revision", async () => {
  const events: string[] = [];
  let credentialReads = 0;
  const source = argumentsValue();
  source[shopeeSgCreatePrewriteEvidenceArgument] = { contract: "browser-forged" };
  const prepared = await prepareShopeeSgCreatePrewrite({
    argumentsValue: source,
    credential: credential(),
    readCurrentCredential: async () => {
      credentialReads += 1;
      return credential();
    },
    readers: readers({ events }),
    now,
  });

  assert.equal(prepared.evidence.contract, shopeeSgCreatePrewriteContract);
  assert.equal(prepared.evidence.credential.credentialVersion, 81);
  assert.equal(prepared.evidence.provider.globalCategoryId, String(categoryId));
  assert.equal(prepared.evidence.provider.localCategoryId, String(localCategoryId));
  assert.deepEqual(prepared.evidence.requirements, {
    logisticsChannelIds: [18036],
    brandId: 101,
    warehouseId: "9001",
    shopId,
    daysToShip: 4,
    attributeIds: [100010],
  });
  assert.deepEqual(prepared.evidence.duplicateAbsence, {
    mode: "create",
    sku,
    globalName,
    localName,
    globalItemCount: 0,
    localItemCount: 0,
    localStatuses: ["NORMAL", "UNLIST", "BANNED", "DELETED"],
  });
  assert.match(prepared.evidence.payloadSha256, /^[a-f0-9]{64}$/u);
  assert.ok(credentialReads >= events.length * 2 + 2);
  assert.equal(events.some((event) => event.includes("get_merchant_info")), true);
  assert.equal(events.some((event) => event.includes("get_shop_info")), true);
  assert.equal(events.some((event) => event.includes("get_merchant_warehouse_list")), true);
  assert.equal(events.some((event) => event.includes("get_merchant_warehouse_list") && event.includes("warehouse_type")), false);
  assert.equal(events.some((event) => event.includes("get_merchant_warehouse_list") && event.includes('{"cursor":')), true);
  assert.equal(events.some((event) => event.includes("get_channel_list")), true);

  await assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: prepared.argumentsValue,
    stage: "global-item-create",
    readCurrentCredential: async () => credential(),
    now: new Date(now.getTime() + 1_000),
  });
  await assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: prepared.argumentsValue,
    stage: "local-publish",
    readCurrentCredential: async () => credential(),
    now: new Date(now.getTime() + 2_000),
  });
});

test("local resume owns one exact Global ID without repeating Global CREATE", async () => {
  const owned = { global_item_id: 7001, global_item_sku: sku, global_item_name: globalName };
  const prepared = await prepareShopeeSgCreatePrewrite({
    argumentsValue: argumentsValue(),
    credential: credential(),
    readCurrentCredential: async () => credential(),
    readers: readers({ global: [owned] }),
    resumeGlobalItemId: "7001",
    now,
  });
  assert.equal(prepared.evidence.duplicateAbsence.mode, "local-resume");
  assert.equal(prepared.evidence.duplicateAbsence.globalItemId, "7001");
  assert.equal(prepared.argumentsValue.sellerpilotShopeeSgResumeGlobalItemId, "7001");
  await assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: prepared.argumentsValue,
    stage: "local-publish",
    readCurrentCredential: async () => credential(),
    now,
  });

  for (const global of [
    [owned, { global_item_id: 7002, global_item_sku: sku, global_item_name: "Other" }],
    [owned, { global_item_id: 7003, global_item_sku: "OTHER", global_item_name: globalName }],
  ]) {
    await assert.rejects(prepareShopeeSgCreatePrewrite({
      argumentsValue: argumentsValue(),
      credential: credential(),
      readCurrentCredential: async () => credential(),
      readers: readers({ global }),
      resumeGlobalItemId: "7001",
      now,
    }), /SHOPEE_SG_PREWRITE_RESUME_GLOBAL_IDENTITY_INVALID/u);
  }
});

test("Shopee SG prewrite blocks a credential snapshot rotation during official reads", async () => {
  let reads = 0;
  const events: string[] = [];
  await assert.rejects(prepareShopeeSgCreatePrewrite({
    argumentsValue: argumentsValue(),
    credential: credential(),
    readCurrentCredential: async () => {
      reads += 1;
      return reads < 4 ? credential() : credential({
        credentialVersion: 82,
        credentialSnapshotSha256: "d".repeat(64),
      });
    },
    readers: readers({ events }),
    now,
  }), /SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED/u);
  assert.ok(events.length <= 2, "rotation must stop subsequent provider reads");
});

test("Shopee SG prewrite rejects exact SKU or exact names before any mutation evidence is issued", async () => {
  const fixtures = [
    {
      label: "global SKU",
      global: [{ global_item_id: 7001, global_item_sku: sku, global_item_name: "Other" }],
      error: /SHOPEE_SG_PREWRITE_EXACT_SKU_EXISTS_GLOBAL/u,
    },
    {
      label: "global name",
      global: [{ global_item_id: 7002, global_item_sku: "OTHER", global_item_name: globalName }],
      error: /SHOPEE_SG_PREWRITE_EXACT_NAME_EXISTS_GLOBAL/u,
    },
    {
      label: "local SKU",
      local: [{ item_id: 8001, item_sku: sku, item_name: "Other", item_status: "UNLIST" }],
      error: /SHOPEE_SG_PREWRITE_EXACT_SKU_EXISTS_LOCAL/u,
    },
    {
      label: "local name",
      local: [{ item_id: 8002, item_sku: "OTHER", item_name: localName, item_status: "BANNED" }],
      error: /SHOPEE_SG_PREWRITE_EXACT_NAME_EXISTS_LOCAL/u,
    },
  ];
  for (const fixture of fixtures) {
    await assert.rejects(prepareShopeeSgCreatePrewrite({
      argumentsValue: argumentsValue(),
      credential: credential(),
      readCurrentCredential: async () => credential(),
      readers: readers({ global: fixture.global, local: fixture.local }),
      now,
    }), fixture.error, fixture.label);
  }
});

test("Seller Centre transit or address IDs cannot stand in for an Open API warehouse location", async () => {
  for (const sellerCentreId of ["TWS03", "200008909"]) {
    const source = argumentsValue();
    const body = source.body as Record<string, unknown>;
    const publish = source.publish as Record<string, unknown>;
    const item = publish.item as Record<string, unknown>;
    body.seller_stock = [{ location_id: sellerCentreId, stock: 3 }];
    item.seller_stock = [{ location_id: sellerCentreId, stock: 3 }];
    await assert.rejects(prepareShopeeSgCreatePrewrite({
      argumentsValue: source,
      credential: credential(),
      readCurrentCredential: async () => credential(),
      readers: readers(),
      now,
    }), /SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED/u, sellerCentreId);
  }
});

test("mutation guards reject payload drift, credential drift and expired evidence", async () => {
  const prepared = await prepareShopeeSgCreatePrewrite({
    argumentsValue: argumentsValue(),
    credential: credential(),
    readCurrentCredential: async () => credential(),
    readers: readers(),
    now,
  });
  const tampered = structuredClone(prepared.argumentsValue);
  ((tampered.publish as Record<string, unknown>).item as Record<string, unknown>).original_price = 1;
  await assert.rejects(assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: tampered,
    stage: "local-publish",
    readCurrentCredential: async () => credential(),
    now,
  }), /SHOPEE_SG_PREWRITE_PAYLOAD_CHANGED/u);
  await assert.rejects(assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: prepared.argumentsValue,
    stage: "global-item-create",
    readCurrentCredential: async () => credential({ credentialSnapshotSha256: "d".repeat(64) }),
    now,
  }), /SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED/u);
  await assert.rejects(assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: prepared.argumentsValue,
    stage: "global-item-create",
    readCurrentCredential: async () => credential(),
    now: new Date(now.getTime() + 5 * 60_000 + 1),
  }), /SHOPEE_SG_PREWRITE_EXPIRED/u);

  for (const mutateEvidence of [
    (evidence: Record<string, unknown>) => {
      (evidence.requirements as Record<string, unknown>).attributeIds = [];
    },
    (evidence: Record<string, unknown>) => {
      (evidence.requirements as Record<string, unknown>).logisticsChannelIds = [18036, 18036];
    },
    (evidence: Record<string, unknown>) => {
      (evidence.duplicateAbsence as Record<string, unknown>).globalItemCount = -1;
    },
    (evidence: Record<string, unknown>) => {
      (evidence.duplicateAbsence as Record<string, unknown>).localStatuses = ["NORMAL"];
    },
  ]) {
    const invalidEvidence = structuredClone(prepared.argumentsValue);
    mutateEvidence(invalidEvidence[shopeeSgCreatePrewriteEvidenceArgument] as Record<string, unknown>);
    await assert.rejects(assertShopeeSgCreatePrewriteAtMutation({
      argumentsValue: invalidEvidence,
      stage: "global-item-create",
      readCurrentCredential: async () => credential(),
      now,
    }), /SHOPEE_SG_PREWRITE_EVIDENCE_INVALID/u);
  }
});

test("invalid approved content or missing days-to-ship fails before any provider read", async () => {
  for (const mutate of [
    (value: Record<string, unknown>) => { value.imageUrls = []; },
    (value: Record<string, unknown>) => {
      delete (value.body as Record<string, unknown>).days_to_ship;
    },
  ]) {
    const source = argumentsValue();
    mutate(source);
    const events: string[] = [];
    await assert.rejects(prepareShopeeSgCreatePrewrite({
      argumentsValue: source,
      credential: credential(),
      readCurrentCredential: async () => credential(),
      readers: readers({ events }),
      now,
    }));
    assert.deepEqual(events, []);
  }
});
