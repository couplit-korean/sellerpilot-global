import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { publishRegistrationIdentity, restoreChannelRegistrationPatches } from "../lib/publish-registration-draft";
import { shopeeSgStoredCreatePrices } from "../lib/product-registration/shopee/stored-prices";
import {
  evaluateShopeeSgRequirementSelection,
  serializeShopeeSgChannelPatches,
  shopeeSgChannelExecutionAllowed,
  ShopeeSgRequirementCandidateFields,
  shopeeSgGlobalLocalSelectionChanges,
  type ShopeeSgRequirementLoadState,
} from "../app/_publishing/shopee/requirement-candidate-fields";

const credentialId = "0dc9112c-340e-4fe5-870f-d33d61cd8914";
const merchantId = "80000001";
const shopId = "70000001";
const categoryId = "100787";
const sourceFingerprint = "fixture-product";

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
      item: { ...structuredClone(common), original_price: 5, logistic: [] },
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
      [publishRegistrationIdentity("shopee", "SG", shopId, credentialId)]: { categoryId, patches: [] },
    },
  };
}

function readySource(observedAt = new Date().toISOString(), brand: { mandatory: boolean; inputType: string } = { mandatory: true, inputType: "DROP_DOWN" }): ShopeeSgRequirementLoadState {
  return {
    state: "ready",
    snapshot: {
      contract: "sellerpilot_shopee_sg_requirement_snapshot_v1",
      observedAt,
      tuple: { credentialId, merchantId, shopId, region: "SG", categoryId, sourceFingerprint },
      resources: {
        category: { state: "ready", value: { categoryId, path: ["Health", "Supplements"], hasChildren: false } },
        brand: { state: "ready", value: { brands: [{ brand_id: 101, display_brand_name: "Fixture Brand" }], ...brand } },
        attributes: { state: "ready", value: { attributeTree: [{
          attribute_id: 1,
          display_attribute_name: "Form",
          mandatory: true,
          attribute_info: { input_type: 1, max_value_count: 1 },
          attribute_value_list: [{ value_id: 11, display_value_name: "Sachet", child_attribute_list: [{
            attribute_id: 2,
            display_attribute_name: "Sachet count",
            mandatory: true,
            attribute_info: { input_type: 3, max_value_count: 1 },
            attribute_value_list: [],
          }] }],
        }] } },
        logistics: { state: "ready", value: { channels: [{ logistics_channel_id: 10, logistics_channel_name: "Fixture Express", enabled: true, compulsory_channel: true }] } },
        warehouses: { state: "ready", value: { warehouses: [{ warehouseId: "9001", locationId: "SG-LOC", name: "Fixture Pickup" }] } },
        eligibleShops: { state: "ready", value: { byWarehouse: [{ warehouseId: "9001", shops: [{ shop_id: Number(shopId) }] }] } },
      },
    },
  };
}

function render(source: ShopeeSgRequirementLoadState, currentDraft?: Record<string, unknown>) {
  const base = baseDraft();
  return renderToStaticMarkup(createElement(ShopeeSgRequirementCandidateFields, {
    source,
    credentialId,
    shopId,
    categoryId,
    sourceFingerprint,
    draftData: draftData(),
    baseDraft: base,
    currentDraft: currentDraft ?? structuredClone(base),
    onChange: () => {},
    onValidationChange: () => {},
    onRefresh: () => {},
  }));
}

test("Shopee SG candidate UI renders official options with explicit placeholders and no fixed selection", () => {
  const html = render(readySource());
  assert.match(html, /Shopee SG 공식 필수조건 선택/u);
  assert.match(html, /Health › Supplements · 100787/u);
  assert.match(html, /브랜드를 명시적으로 선택/u);
  assert.match(html, /Fixture Brand · 101/u);
  assert.match(html, /속성값을 명시적으로 선택/u);
  assert.match(html, /Fixture Express · 필수 채널/u);
  assert.match(html, /창고를 명시적으로 선택/u);
  assert.match(html, /Fixture Pickup · 9001/u);
  assert.doesNotMatch(html, /value="101" selected/u);
  assert.doesNotMatch(html, /type="checkbox" checked/u);
});

test("Shopee SG candidate UI keeps dependent children inactive until the parent value is selected", () => {
  const html = render(readySource());
  assert.match(html, /Form · 필수/u);
  assert.doesNotMatch(html, /Sachet count/u);
});

test("Shopee SG candidate UI presents loading, missing, and provider-blocked states explicitly", () => {
  assert.match(render({ state: "loading" }), /공식 필수조건 조회 중/u);
  assert.match(render({ state: "missing", reason: "No current candidates" }), /No current candidates/u);
  const blocked = render({ state: "blocked", code: "SHOPEE_SG_LOGISTICS_QUERY_FAILED", message: "Official query failed" });
  assert.match(blocked, /role="alert"/u);
  assert.match(blocked, /SHOPEE_SG_LOGISTICS_QUERY_FAILED/u);
  assert.match(render({ state: "ready", snapshot: { contract: "sellerpilot_shopee_sg_requirement_snapshot_v1" } }), /snapshot 형식/u);
});

test("Shopee SG shared selections always update both Global body and local publish item", () => {
  for (const [field, value] of [
    ["brand", { brand_id: 101, original_brand_name: "Fixture Brand" }],
    ["attribute_list", [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }]],
    ["seller_stock", [{ location_id: "SG-LOC", stock: 3 }]],
  ] as const) {
    assert.deepEqual(shopeeSgGlobalLocalSelectionChanges(field, value), [
      { path: ["body", field], value },
      { path: ["publish", "item", field], value },
    ]);
  }
});

function completeDraft() {
  const current = baseDraft();
  current.body.brand = { brand_id: 101, original_brand_name: "Fixture Brand" };
  current.publish.item.brand = structuredClone(current.body.brand);
  current.body.attribute_list = [
    { attribute_id: 1, attribute_value_list: [{ value_id: 11 }] },
    { attribute_id: 2, attribute_value_list: [{ original_value_name: "30 sachets" }] },
  ];
  current.publish.item.attribute_list = structuredClone(current.body.attribute_list);
  current.body.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  current.publish.item.seller_stock = structuredClone(current.body.seller_stock);
  current.publish.item.logistic = [{ logistic_id: 10, enabled: true }];
  return current;
}

test("Shopee SG direct-brand policy renders a controlled React input without guessing a brand", () => {
  const current = baseDraft();
  current.body.brand = { brand_id: 0, original_brand_name: "Seller Entered Brand" };
  current.publish.item.brand = structuredClone(current.body.brand);
  const html = render(readySource(new Date().toISOString(), { mandatory: false, inputType: "TEXT_FIELD" }), current);
  assert.match(html, /공식 정책 허용 직접 브랜드명/u);
  assert.match(html, /value="Seller Entered Brand"/u);
  assert.match(html, /브랜드를 명시적으로 선택/u);
  assert.deepEqual(shopeeSgGlobalLocalSelectionChanges("brand", {
    brand_id: 0,
    original_brand_name: "Seller Entered Brand",
  }), [
    { path: ["body", "brand"], value: { brand_id: 0, original_brand_name: "Seller Entered Brand" } },
    { path: ["publish", "item", "brand"], value: { brand_id: 0, original_brand_name: "Seller Entered Brand" } },
  ]);
});

test("Shopee SG synchronous execution validation isolates other channels and recovers after a same-tuple refresh", () => {
  const current = completeDraft();
  const stale = evaluateShopeeSgRequirementSelection({
    source: readySource("2026-09-09T01:00:00.000Z"),
    credentialId,
    shopId,
    categoryId,
    sourceFingerprint,
    draftData: draftData(),
    baseDraft: baseDraft(),
    currentDraft: current,
    now: new Date("2026-09-09T01:11:00.000Z"),
  });
  assert.equal(stale.saveAllowed, false);
  assert.match(render(readySource("2026-09-09T01:00:00.000Z"), current), /공식 조건 다시 조회/u);
  assert.equal(shopeeSgChannelExecutionAllowed("shopee", "listing.create", stale), false);
  assert.equal(shopeeSgChannelExecutionAllowed("qoo10", "listing.create", stale), true);

  const refreshed = evaluateShopeeSgRequirementSelection({
    source: readySource("2026-09-09T01:11:00.000Z"),
    credentialId,
    shopId,
    categoryId,
    sourceFingerprint,
    draftData: draftData(),
    baseDraft: baseDraft(),
    currentDraft: current,
    now: new Date("2026-09-09T01:11:30.000Z"),
  });
  assert.equal(refreshed.saveAllowed, true);
  assert.equal(shopeeSgChannelExecutionAllowed("shopee", "listing.create", refreshed), true);
});

test("Shopee SG serialization preserves one explicit local SGD patch even when it equals the base", () => {
  const base = baseDraft();
  const current = structuredClone(base);
  const patches = serializeShopeeSgChannelPatches(base, current);
  assert.deepEqual(patches.filter((patch) => patch.path.join(".") === "publish.item.original_price"), [
    { path: ["publish", "item", "original_price"], value: 5 },
  ]);
  const restored = restoreChannelRegistrationPatches(base, patches);
  const savedDraft = draftData();
  savedDraft.channels[publishRegistrationIdentity("shopee", "SG", shopId, credentialId)].patches = patches;
  assert.deepEqual(shopeeSgStoredCreatePrices({
    draftData: savedDraft,
    credentialId,
    market: "SG",
    targetId: shopId,
    categoryId,
    transmittedArguments: restored,
  }), {
    targetPriceSgd: 5,
    globalPriceUsd: 4,
    identity: publishRegistrationIdentity("shopee", "SG", shopId, credentialId),
  });
});
