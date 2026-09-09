import assert from "node:assert/strict";
import test from "node:test";
import { publishRegistrationIdentity } from "../lib/publish-registration-draft";
import {
  buildShopeeSgRequirementViewModel,
  planShopeeSgRequirementDraftSave,
  shopeeSgRequirementSnapshotContract,
  type ShopeeSgRequirementSnapshot,
} from "../lib/product-registration/shopee/requirement-view-model";

const credentialId = "0dc9112c-340e-4fe5-870f-d33d61cd8914";
const merchantId = "80000001";
const shopId = "70000001";
const categoryId = "100787";
const sourceFingerprint = "current-product-lineage";
const observedAt = "2026-09-09T03:00:00.000Z";

function baseDraft() {
  const common = {
    category_id: Number(categoryId),
    brand: { brand_id: 0, original_brand_name: "" },
    attribute_list: [],
    normal_stock: 3,
    seller_stock: [{ stock: 3 }],
    weight: 0.4,
    dimension: { package_length: 28, package_width: 20, package_height: 7 },
  };
  return {
    shopId,
    country: "sg",
    body: { ...structuredClone(common), original_price: 4 },
    publish: {
      shop_id: Number(shopId),
      shop_region: "SG",
      item: {
        ...structuredClone(common),
        original_price: 5,
        logistic: [],
      },
    },
  };
}

function draftData() {
  return {
    schemaVersion: 1,
    sourceFingerprint,
    common: {
      fields: {},
      price: 5_000,
      globalBaseUsdPrice: 4,
      quantity: 3,
      packageFields: { weight: 0.4, length: 28, width: 20, height: 7 },
    },
    channels: {
      [publishRegistrationIdentity("shopee", "SG", shopId, credentialId)]: {
        categoryId,
        patches: [],
      },
    },
  };
}

function readySnapshot(): ShopeeSgRequirementSnapshot {
  return {
    contract: shopeeSgRequirementSnapshotContract,
    observedAt,
    tuple: {
      credentialId,
      merchantId,
      shopId,
      region: "SG",
      categoryId,
      sourceFingerprint,
    },
    resources: {
      category: { state: "ready", value: { categoryId, path: ["Health", "Supplements"], hasChildren: false } },
      brand: {
        state: "ready",
        value: {
          brands: [{ brand_id: 101, display_brand_name: "Lotte" }],
          mandatory: true,
          inputType: "DROP_DOWN",
        },
      },
      attributes: {
        state: "ready",
        value: {
          attributeTree: [{
            attribute_id: 1,
            mandatory: true,
            attribute_info: { input_type: 1, max_value_count: 1 },
            attribute_value_list: [{
              value_id: 11,
              child_attribute_list: [{
                attribute_id: 2,
                mandatory: true,
                attribute_info: { input_type: 3, max_value_count: 1 },
                attribute_value_list: [],
              }],
            }],
          }],
        },
      },
      logistics: {
        state: "ready",
        value: {
          channels: [{
            logistics_channel_id: 10,
            enabled: true,
            compulsory_channel: true,
            fee_type: "SIZE_SELECTION",
            size_list: [{ size_id: "3" }],
            weight_limit: { item_min_weight: 0.1, item_max_weight: 1 },
          }],
        },
      },
      warehouses: {
        state: "ready",
        value: { warehouses: [{ warehouseId: "9001", locationId: "SG-LOC", name: "Pickup" }] },
      },
      eligibleShops: {
        state: "ready",
        value: { byWarehouse: [{ warehouseId: "9001", shops: [{ shop_id: Number(shopId), shop_name: "SG Shop" }] }] },
      },
    },
  };
}

function build(snapshot = readySnapshot(), data: unknown = draftData(), base: unknown = baseDraft()) {
  return buildShopeeSgRequirementViewModel({
    draftData: data,
    baseDraft: base,
    snapshot,
    credentialId,
    merchantId,
    shopId,
    categoryId,
    expectedSourceFingerprint: sourceFingerprint,
    now: new Date("2026-09-09T03:05:00.000Z"),
  });
}

function selectedDraft() {
  const current = baseDraft();
  current.body.brand = { brand_id: 101, original_brand_name: "Lotte" };
  current.publish.item.brand = { brand_id: 101, original_brand_name: "Lotte" };
  current.body.attribute_list = [
    { attribute_id: 1, attribute_value_list: [{ value_id: 11 }] },
    { attribute_id: 2, attribute_value_list: [{ original_value_name: "30 sachets" }] },
  ];
  current.publish.item.attribute_list = structuredClone(current.body.attribute_list);
  current.body.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  current.publish.item.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  current.publish.item.logistic = [{ logistic_id: 10, enabled: true, size_id: "3" }];
  return current;
}

test("Shopee SG exposes official candidates without choosing defaults and plans an exact tuple-bound save", () => {
  const viewModel = build();
  assert.equal(viewModel.saveAllowed, true);
  assert.deepEqual(viewModel.selectedDraft?.body && (viewModel.selectedDraft.body as Record<string, unknown>).brand, {
    brand_id: 0,
    original_brand_name: "",
  });
  assert.deepEqual((viewModel.resources.logistics as { state: "ready"; value: { channels: unknown[] } }).value.channels, readySnapshot().resources.logistics.state === "ready"
    ? readySnapshot().resources.logistics.value.channels
    : []);

  const plan = planShopeeSgRequirementDraftSave({ viewModel, currentDraft: selectedDraft() });
  assert.equal(plan.identity, publishRegistrationIdentity("shopee", "SG", shopId, credentialId));
  assert.deepEqual(plan.evidence, {
    brandId: 101,
    attributeIds: [1, 2],
    logisticsChannelIds: [10],
    warehouseId: "9001",
    locationId: "SG-LOC",
    shopId,
    globalPriceUsd: 4,
    localPriceSgd: 5,
  });
  assert.ok(plan.patches.some((patch) => patch.path.join(".").startsWith("body.brand.")));
  assert.ok(plan.patches.some((patch) => patch.path.join(".") === "body.attribute_list"));
  assert.ok(plan.patches.some((patch) => patch.path.join(".") === "publish.item.logistic"));
  assert.ok(plan.patches.some((patch) => patch.path.join(".") === "body.seller_stock"));
});

test("Shopee SG refuses stale and other-shop, other-credential, other-category, or other-source snapshots", () => {
  const cases: Array<[string, (snapshot: ShopeeSgRequirementSnapshot) => void]> = [
    ["SHOPEE_SG_REQUIREMENT_SNAPSHOT_STALE", (snapshot) => { snapshot.observedAt = "2026-09-09T02:00:00.000Z"; }],
    ["SHOPEE_SG_REQUIREMENT_TUPLE_MISMATCH", (snapshot) => { snapshot.tuple.shopId = "70000002"; }],
    ["SHOPEE_SG_REQUIREMENT_TUPLE_MISMATCH", (snapshot) => { snapshot.tuple.credentialId = "f844111c-d62d-4b66-88fb-8b54df766edc"; }],
    ["SHOPEE_SG_REQUIREMENT_TUPLE_MISMATCH", (snapshot) => { snapshot.tuple.merchantId = "80000002"; }],
    ["SHOPEE_SG_REQUIREMENT_TUPLE_MISMATCH", (snapshot) => { snapshot.tuple.categoryId = "100788"; }],
    ["SHOPEE_SG_REQUIREMENT_TUPLE_MISMATCH", (snapshot) => { snapshot.tuple.sourceFingerprint = "other-product"; }],
  ];
  for (const [code, change] of cases) {
    const snapshot = readySnapshot();
    change(snapshot);
    const viewModel = build(snapshot);
    assert.equal(viewModel.saveAllowed, false);
    assert.ok(viewModel.blockers.some((blocker) => blocker.code === code));
    assert.throws(() => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: selectedDraft() }), new RegExp(code, "u"));
  }
});

test("Shopee SG surfaces loading, missing, and blocked resources and never permits their save", () => {
  const snapshot = readySnapshot();
  snapshot.resources.brand = { state: "loading" };
  snapshot.resources.attributes = { state: "missing", reason: "No official attribute tree was returned." };
  snapshot.resources.logistics = { state: "blocked", code: "SHOPEE_SG_LOGISTICS_QUERY_FAILED", message: "Official logistics query failed." };
  const viewModel = build(snapshot);
  assert.equal(viewModel.saveAllowed, false);
  assert.deepEqual(viewModel.blockers.map((item) => [item.resource, item.state, item.code]), [
    ["brand", "blocked", "SHOPEE_SG_REQUIREMENT_LOADING"],
    ["attributes", "missing", "SHOPEE_SG_REQUIREMENT_MISSING"],
    ["logistics", "blocked", "SHOPEE_SG_LOGISTICS_QUERY_FAILED"],
  ]);
});

test("Shopee SG refuses a non-leaf category, mismatched base identity, and another warehouse's eligible-shop candidates", () => {
  const categorySnapshot = readySnapshot();
  if (categorySnapshot.resources.category.state === "ready") {
    categorySnapshot.resources.category.value.hasChildren = true;
  }
  assert.equal(build(categorySnapshot).saveAllowed, false);

  const otherShopBase = baseDraft();
  otherShopBase.publish.shop_id = 70000002;
  assert.equal(build(readySnapshot(), draftData(), otherShopBase).saveAllowed, false);

  const eligibleSnapshot = readySnapshot();
  if (eligibleSnapshot.resources.eligibleShops.state === "ready") {
    eligibleSnapshot.resources.eligibleShops.value.byWarehouse[0].warehouseId = "9002";
  }
  const viewModel = build(eligibleSnapshot);
  assert.throws(
    () => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: selectedDraft() }),
    /SHOPEE_SG_WAREHOUSE_ELIGIBILITY_MISMATCH/u,
  );
});

test("Shopee SG validates conditional child attributes and exact local/global prices before save", () => {
  const viewModel = build();
  const missingChild = selectedDraft();
  missingChild.body.attribute_list = [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }];
  missingChild.publish.item.attribute_list = structuredClone(missingChild.body.attribute_list);
  assert.throws(
    () => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: missingChild }),
    /SHOPEE_SG_REQUIRED_ATTRIBUTES_MISSING:2/u,
  );

  const missingLocalPrice = selectedDraft();
  missingLocalPrice.publish.item.original_price = 0;
  assert.throws(
    () => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: missingLocalPrice }),
    /SHOPEE_SG_LOCAL_PRICE_REQUIRED/u,
  );

  const missingGlobalPrice = selectedDraft();
  missingGlobalPrice.body.original_price = 0;
  assert.throws(
    () => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: missingGlobalPrice }),
    /SHOPEE_SG_GLOBAL_PRICE_REQUIRED/u,
  );
});

test("Shopee SG refuses drift between global and local brand, attributes, package, or warehouse", () => {
  const viewModel = build();
  const cases: Array<[string, (draft: ReturnType<typeof selectedDraft>) => void]> = [
    ["SHOPEE_SG_BRAND_REQUIRED", (draft) => { draft.publish.item.brand = { brand_id: 0, original_brand_name: "" }; }],
    ["SHOPEE_SG_REQUIRED_ATTRIBUTES_MISSING", (draft) => { draft.publish.item.attribute_list = []; }],
    ["SHOPEE_SG_GLOBAL_LOCAL_PACKAGE_MISMATCH", (draft) => { draft.publish.item.weight = 0.5; }],
    ["SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED", (draft) => { draft.publish.item.seller_stock = [{ stock: 3 }]; }],
  ];
  for (const [code, mutate] of cases) {
    const draft = selectedDraft();
    mutate(draft);
    assert.throws(
      () => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: draft }),
      new RegExp(code, "u"),
    );
  }
});

test("Shopee SG turns missing tuple or any missing/malformed resource into a blocked view model", () => {
  const malformedSnapshots: unknown[] = [
    { ...readySnapshot(), tuple: undefined },
    { ...readySnapshot(), resources: {} },
    { ...readySnapshot(), resources: { ...readySnapshot().resources, brand: undefined } },
    { ...readySnapshot(), resources: { ...readySnapshot().resources, logistics: { state: "ready", value: { channels: [null] } } } },
  ];
  for (const snapshot of malformedSnapshots) {
    const viewModel = buildShopeeSgRequirementViewModel({
      draftData: draftData(),
      baseDraft: baseDraft(),
      snapshot,
      credentialId,
      merchantId,
      shopId,
      categoryId,
      expectedSourceFingerprint: sourceFingerprint,
      now: new Date("2026-09-09T03:05:00.000Z"),
    });
    assert.equal(viewModel.saveAllowed, false);
    assert.ok(viewModel.blockers.some((blocker) => blocker.code === "SHOPEE_SG_REQUIREMENT_SNAPSHOT_INVALID"));
    assert.throws(
      () => planShopeeSgRequirementDraftSave({ viewModel, currentDraft: selectedDraft() }),
      /SHOPEE_SG_REQUIREMENT_SNAPSHOT_INVALID/u,
    );
  }
});

test("Shopee SG save planner rejects a forged runtime view model with malformed resources", () => {
  const forged = build();
  (forged as unknown as { resources: unknown }).resources = {};
  assert.throws(
    () => planShopeeSgRequirementDraftSave({ viewModel: forged, currentDraft: selectedDraft() }),
    /SHOPEE_SG_CATEGORY_NOT_READY/u,
  );
});
