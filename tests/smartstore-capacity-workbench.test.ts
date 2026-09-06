import test from "node:test";
import assert from "node:assert/strict";
import { inspectListingDraft, setSmartstoreCapacityDraftValue, preserveSmartstoreCapacityDraft, editSmartstoreCapacityDraftValue } from "../lib/channels/listing-preflight";
import { assertSmartstoreUnitCapacity } from "../lib/channels/smartstore-unit-capacity";
import { smartstoreExactQaRecoveryIdentity } from "../lib/channels/smartstore-exact-qa-recovery";
import { buildChannelArguments, buildSynchronizedDraftMap, inspectWorkbenchListingDraft } from "../app/product-publish-workbench";

const path = ["body", "originProduct", "detailAttribute", "unitCapacity"];
const exact = { unitPriceYn: true, totalCapacityValue: 315, unitCapacity: 10, indicationUnit: "g" };
const draft = (value: unknown = exact): Record<string, unknown> => ({ body: { originProduct: {
  leafCategoryId: "50000001", salePrice: 3190, detailAttribute: { unitCapacity: value, sellerCodeInfo: { sellerManagementCode: "TEST-ONLY" } },
} }, sellerpilotAssets: { approvedManifest: "unchanged" } });
const blockingCapacity = (value: Record<string, unknown>) => inspectListingDraft("smartstore", value)
  .filter((field) => field.key.startsWith("unit-") && field.status === "manual").map((field) => field.key);
const capacity = (value: Record<string, unknown>) => (value.body as { originProduct: { detailAttribute: { unitCapacity: unknown } } }).originProduct.detailAttribute.unitCapacity;

test("explicit UI fields serialize boolean and numeric provider values without changing price, SKU or receipt", () => {
  const original = draft({});
  let entered = original;
  for (const [key, value] of Object.entries(exact)) entered = setSmartstoreCapacityDraftValue(entered, [...path, key], String(value));
  assert.deepEqual(capacity(entered), exact);
  assert.deepEqual(capacity(original), {});
  assert.deepEqual(entered, draft(exact));
  assert.deepEqual(blockingCapacity(entered), []);
  assert.doesNotThrow(() => assertSmartstoreUnitCapacity({ originProduct: (entered.body as Record<string, unknown>).originProduct,
    category: { id: "50000001", last: true, exceptionalCategories: ["UNIT_PRICE"] } }));
});

test("missing capacity and hand-edited string booleans/numbers cannot appear ready", () => {
  for (const value of [null, {}, { ...exact, unitPriceYn: "true" }, { ...exact, totalCapacityValue: "315" }, { ...exact, unitCapacity: "10" }, { ...exact, indicationUnit: "GRAM" }]) {
    assert.ok(blockingCapacity(draft(value)).length > 0);
  }
  assert.equal(blockingCapacity({ body: { originProduct: { detailAttribute: {} } } }).length, 4);
});

test("existing-product update reads current remote capacity at runtime and does not repeat create-only checks", () => {
  const updateRequirements = inspectWorkbenchListingDraft("smartstore", draft({}), "listing.update");
  const updateKeys = new Set(updateRequirements.map((item) => item.key));
  assert.equal(updateRequirements.find((item) => item.key === "unit-capacity-preserved")?.status, "runtime");
  for (const key of [
    "unit-price-enabled",
    "unit-total-capacity",
    "unit-display-capacity",
    "unit-indication",
    "price",
    "stock",
    "minor-purchasable",
    "provided-notice",
    "display-status",
    "phone",
  ]) assert.equal(updateKeys.has(key), false, key);
  for (const key of ["category", "title", "description", "images", "origin", "uploaded-image"]) {
    assert.equal(updateKeys.has(key), true, key);
  }
  assert.equal(inspectListingDraft("smartstore", draft({}), "listing.create").some((item) => item.key === "unit-price-enabled"), true);
});

test("invalid typed entries remain blocking rather than being inferred or defaulted", () => {
  for (const [key, values] of Object.entries({ totalCapacityValue: ["0", "-1", "1.0001", "1e2", "NaN", "", "1000000000"], unitCapacity: ["0", "0.1", "1000", ""], unitPriceYn: ["1", "yes", ""] })) {
    for (const value of values) assert.ok(blockingCapacity(setSmartstoreCapacityDraftValue(draft(), [...path, key], value)).length > 0, `${key}=${value}`);
  }
  assert.throws(() => setSmartstoreCapacityDraftValue(draft(), ["body", "__proto__"], "x"), /SMARTSTORE_CAPACITY_PATH_INVALID/);
});

test("explicit non-target does not discard contradictory amounts and remains subject to authoritative category check", () => {
  const disabled = setSmartstoreCapacityDraftValue(draft(), [...path, "unitPriceYn"], "false");
  assert.deepEqual(capacity(disabled), { ...exact, unitPriceYn: false });
  assert.ok(blockingCapacity(disabled).includes("unit-price-enabled"));
  let cleared = disabled;
  for (const key of ["totalCapacityValue", "unitCapacity", "indicationUnit"]) cleared = setSmartstoreCapacityDraftValue(cleared, [...path, key], "");
  assert.deepEqual(capacity(cleared), { unitPriceYn: false });
  assert.deepEqual(blockingCapacity(cleared), []);
  assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: (cleared.body as Record<string, unknown>).originProduct,
    category: { id: "50000001", last: true, exceptionalCategories: ["UNIT_PRICE"] } }), /CANNOT_DISABLE/);
});

test("raw JSON preservation keeps invalid types and unknown keys unchanged without mutating either input", () => {
  const raw = { ...exact, totalCapacityValue: "315", custom: ["kept"] };
  const current = draft(raw);
  const next = draft({});
  const result = preserveSmartstoreCapacityDraft(current, next);
  assert.deepEqual(capacity(result), raw);
  assert.deepEqual(capacity(next), {});
  assert.deepEqual(capacity(current), raw);
  assert.ok(blockingCapacity(result).includes("unit-total-capacity"));
});

function context(): Parameters<typeof buildChannelArguments>[1] {
  return {
    product: { id: "setter-fixture", externalCode: "SETTER", sku: "SETTER", name: "setter fixture", description: "shipping setter fixture", sourceUrl: null, status: "ready" },
    manualFields: { productName: "setter fixture", description: "shipping setter fixture", sellerSku: "SETTER", categoryHint: "생활용품", brandName: "TEST", manufacturer: "TEST", countryOfOrigin: "대한민국", material: "test", packageContents: "상품 1개", condition: "NEW", gtinStatus: "NO_GTIN", gtin: "", sellingPrice: 10000, currency: "KRW", stock: 1, shippingFeeKrw: 3000, shippingRule: "결제 후 1~2영업일 내 출고", packagingRule: "완충재 포장", weightKg: 0.2, packageLengthCm: 10, packageWidthCm: 8, packageHeightCm: 4 },
    contentMode: "manual_mvp", imageSpecs: [], assignments: [], listings: [], sourceImages: [{ path: "fixture.jpg", url: "https://example.com/fixture.jpg" }], generatedImages: [], localizedListings: [], detailData: null,
  };
}
const packageFields = { weight: 0.2, length: 10, width: 8, height: 4 };
test("actual common price/stock/packaging synchronization preserves exact entered capacity and current asset contract", () => {
  const input = context();
  const initial = buildChannelArguments("smartstore", input, 3190, 1, undefined, packageFields, 10) as Record<string, unknown>;
  const entered = preserveSmartstoreCapacityDraft(draft(), initial);
  const next = JSON.parse(buildSynchronizedDraftMap(input, { smartstore: JSON.stringify(entered) }, 3290, 2, {}, { ...packageFields, weight: 0.4 }, 10).smartstore!);
  assert.deepEqual(capacity(next), exact);
  assert.equal(next.body.originProduct.salePrice, 3290);
  assert.equal(next.body.originProduct.stockQuantity, 2);
  assert.deepEqual(next.sellerpilotAssets, JSON.parse(JSON.stringify((buildChannelArguments("smartstore", input, 3290, 2, undefined, { ...packageFields, weight: 0.4 }, 10) as Record<string, unknown>).sellerpilotAssets)));
  assert.deepEqual(capacity(entered), exact);
});

test("normal existing-product content draft excludes price, stock and create shipping while keeping an entered capacity", () => {
  const input = context();
  input.listings = [{
    id: "smartstore-listing",
    channel: "smartstore",
    market: "KR",
    targetId: "",
    remoteId: "13688607602",
    status: "published",
    lastError: null,
    publishedAt: "2026-09-07T00:00:00.000Z",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  }];
  const initial = buildChannelArguments("smartstore", input, 3190, 1, undefined, packageFields, 10) as Record<string, unknown>;
  const originProduct = (initial.body as { originProduct: Record<string, unknown> }).originProduct;
  assert.equal(Object.hasOwn(originProduct, "salePrice"), false);
  assert.equal(Object.hasOwn(originProduct, "stockQuantity"), false);
  assert.equal(Object.hasOwn(originProduct, "deliveryInfo"), false);
  const preserved = preserveSmartstoreCapacityDraft(draft(), initial);
  assert.deepEqual(capacity(preserved), exact);
});

test("the exact QA recovery draft keeps its fixed commerce values for the legacy recovery guard", () => {
  const input = context();
  input.product.id = smartstoreExactQaRecoveryIdentity.productId;
  input.listings = [{
    id: smartstoreExactQaRecoveryIdentity.listingId,
    channel: "smartstore",
    market: "KR",
    targetId: "",
    remoteId: smartstoreExactQaRecoveryIdentity.originProductNo,
    status: "failed",
    lastError: "exact recovery fixture",
    failureClass: "external_action",
    publishedAt: null,
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
  }];
  const draftValue = buildChannelArguments(
    "smartstore",
    input,
    smartstoreExactQaRecoveryIdentity.priceKrw,
    smartstoreExactQaRecoveryIdentity.stock,
    undefined,
    packageFields,
    10,
  ) as Record<string, unknown>;
  const originProduct = (draftValue.body as { originProduct: Record<string, unknown> }).originProduct;
  assert.equal(originProduct.salePrice, smartstoreExactQaRecoveryIdentity.priceKrw);
  assert.equal(originProduct.stockQuantity, smartstoreExactQaRecoveryIdentity.stock);
});

test("actual common synchronization neither invents absent capacity nor repairs raw invalid capacity", () => {
  const input = context();
  const initial = buildChannelArguments("smartstore", input, 3190, 1, undefined, packageFields, 10) as Record<string, unknown>;
  const absent = JSON.parse(buildSynchronizedDraftMap(input, { smartstore: JSON.stringify(initial) }, 3190, 1, {}, packageFields, 10).smartstore!);
  assert.equal(capacity(absent), undefined);
  for (const value of [null, { ...exact, unitPriceYn: "true" }]) {
    const raw = preserveSmartstoreCapacityDraft(draft(value), initial);
    const next = JSON.parse(buildSynchronizedDraftMap(input, { smartstore: JSON.stringify(raw) }, 3190, 3, {}, packageFields, 10).smartstore!);
    assert.deepEqual(capacity(next), value);
    assert.ok(blockingCapacity(next).length > 0);
  }
});


test("UI edits of malformed capacity containers preserve raw JSON and return a correction message without throwing", () => {
  for (const value of [[], ["315g"], "oops", 42, true]) {
    const original = draft(value);
    const before = structuredClone(original);
    for (const [key, entered] of Object.entries(exact)) {
      const result = editSmartstoreCapacityDraftValue(original, [...path, key], String(entered));
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /채널 공식 payload 최종 검토.*unitCapacity.*객체/);
      assert.deepEqual(original, before);
      assert.ok(blockingCapacity(original).length > 0);
    }
  }
});

test("after explicit JSON container correction the same UI boundary accepts typed capacity inputs", () => {
  let corrected = draft({});
  for (const [key, value] of Object.entries(exact)) {
    const result = editSmartstoreCapacityDraftValue(corrected, [...path, key], String(value));
    assert.equal(result.ok, true);
    if (result.ok) corrected = result.draft;
  }
  assert.deepEqual(capacity(corrected), exact);
  assert.deepEqual(blockingCapacity(corrected), []);
});
