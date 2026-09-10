import test from "node:test";
import assert from "node:assert/strict";
import { setListingDraftValue, listingDraftValue } from "../lib/channels/listing-preflight";
import { assertListingShippingReady, listingShippingRequirements } from "../lib/channels/listing-shipping";
import { buildChannelArguments, buildSynchronizedDraftMap } from "../app/product-publish-workbench";

test("numeric manualPath edits preserve array shape, sibling items and all other fields", () => {
  const original = { body: { items: [
    { itemName: "first", salePrice: 1234, outboundShippingTimeDay: null, images: [{ vendorPath: "https://example.com/1" }] },
    { itemName: "second", outboundShippingTimeDay: 7 },
  ], brand: "TEST" }, facts: { material: "test" } };
  const before = structuredClone(original);
  const result = setListingDraftValue(original, ["body", "items", "0", "outboundShippingTimeDay"], "2");
  const expected = { ...before, body: { ...before.body, items: before.body.items.map((item, index) =>
    index === 0 ? { ...item, outboundShippingTimeDay: "2" } : item) } };
  assert.deepEqual(result, expected);
  assert.deepEqual(original, before);
  assert.equal(Array.isArray((result.body as typeof original.body).items), true);
  assert.equal(listingDraftValue(result, ["body", "items", "0", "outboundShippingTimeDay"]), "2");
});

test("nested arrays and contiguous append preserve sibling rows", () => {
  const value = { matrix: [["a", "b"], ["c"]] };
  const edited = setListingDraftValue(value, ["matrix", "1", "0"], "d");
  assert.deepEqual(edited, { matrix: [["a", "b"], ["d"]] });
  const appended = setListingDraftValue(edited, ["matrix", "1", "1"], "e");
  assert.deepEqual(appended, { matrix: [["a", "b"], ["d", "e"]] });
  assert.deepEqual(value, { matrix: [["a", "b"], ["c"]] });
});

test("missing or null containers are created by next segment without losing siblings", () => {
  assert.deepEqual(setListingDraftValue({ keep: "x" }, ["body", "items", "0", "name"], "a"), {
    keep: "x", body: { items: [{ name: "a" }] },
  });
  assert.deepEqual(setListingDraftValue({ offer: null, keep: 1 }, ["offer", "listingPolicies", "fulfillmentPolicyId"], "p"), {
    offer: { listingPolicies: { fulfillmentPolicyId: "p" } }, keep: 1,
  });
});

test("plain object manual paths keep other channel values and JSON strings unchanged", () => {
  const original = { offer: { listingPolicies: { fulfillmentPolicyId: "old", returnPolicyId: "return" }, merchantLocationKey: "warehouse" }, facts: { noticeContent: "" } };
  const result = setListingDraftValue(original, ["offer", "listingPolicies", "fulfillmentPolicyId"], "new");
  assert.deepEqual(result.offer, { listingPolicies: { fulfillmentPolicyId: "new", returnPolicyId: "return" }, merchantLocationKey: "warehouse" });
  const json = '{"noticeCategoryName":"식품","details":{"제품명":"fixture"}}';
  const withJson = setListingDraftValue(result, ["facts", "noticeContent"], json);
  assert.equal(listingDraftValue(withJson, ["facts", "noticeContent"]), json);
  assert.equal(original.offer.listingPolicies.fulfillmentPolicyId, "old");
});

test("prototype-related tokens fail at every path depth without pollution", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    for (const path of [[key, "polluted"], ["safe", key, "polluted"], ["safe", key]]) {
      const original = { safe: {} };
      assert.throws(() => setListingDraftValue(original, path, "yes"), /LISTING_DRAFT_PATH_INVALID/);
      assert.deepEqual(original, { safe: {} });
    }
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("malformed paths and invalid value types reject before modifying the source", () => {
  const original = { body: { items: [{ day: null }] } };
  for (const path of [[], null, undefined, "body", [""], [" "], ["body", " items"], ["body", 0], ["body", null]]) {
    assert.throws(() => setListingDraftValue(original, path as string[], "2"), /LISTING_DRAFT_PATH_INVALID/);
  }
  assert.throws(() => setListingDraftValue(original, ["body"], 2 as unknown as string), /LISTING_DRAFT_VALUE_INVALID/);
  assert.deepEqual(original, { body: { items: [{ day: null }] } });
});

test("unsafe, noncanonical, named array indices and sparse growth fail closed", () => {
  for (const index of ["-1", "01", "1.5", "+1", "1e0", "0x1", "Infinity", "4294967295", "9007199254740992", "length", "name", "2"]) {
    const original = { items: [{ day: null }] };
    assert.throws(() => setListingDraftValue(original, ["items", index, "day"], "2"), /LISTING_DRAFT_PATH_INVALID/);
    assert.deepEqual(original, { items: [{ day: null }] });
  }
  for (const index of ["01", "1.5", "-1", "1e0"]) {
    assert.throws(() => setListingDraftValue({}, ["items", index, "day"], "2"), /LISTING_DRAFT_PATH_INVALID/);
  }
});

test("sparse existing arrays and numeric-keyed objects are not silently repaired", () => {
  const sparse: unknown[] = Array(2);
  sparse[1] = { day: null };
  assert.throws(() => setListingDraftValue({ items: sparse }, ["items", "0", "day"], "2"), /LISTING_DRAFT_PATH_INVALID/);
  assert.throws(() => setListingDraftValue({ items: { "0": { day: null } } }, ["items", "0", "day"], "2"), /LISTING_DRAFT_PATH_INVALID/);
});

test("descent cannot erase existing primitive or incompatible containers", () => {
  for (const body of ["keep", 123, false, [], new Date(0), new Map()]) {
    const original = { body };
    const before = structuredClone(original);
    assert.throws(() => setListingDraftValue(original, ["body", "items", "0", "day"], "2"), /LISTING_DRAFT_PATH_INVALID/);
    assert.deepEqual(original, before);
  }
  for (const root of [[], null, new Date(0), Object.create({ inherited: true })]) {
    assert.throws(() => setListingDraftValue(root, ["day"], "2"), /LISTING_DRAFT_PATH_INVALID/);
  }
});

function context(): Parameters<typeof buildChannelArguments>[1] {
  return {
    product: { id: "setter-fixture", externalCode: "SETTER", sku: "SETTER", name: "setter fixture", description: "shipping setter fixture", sourceUrl: null, status: "ready" },
    manualFields: { productName: "setter fixture", description: "shipping setter fixture", sellerSku: "SETTER", categoryHint: "생활용품", brandName: "TEST", manufacturer: "TEST", countryOfOrigin: "대한민국", material: "test", packageContents: "상품 1개", condition: "NEW", gtinStatus: "NO_GTIN", gtin: "", sellingPrice: 10000, currency: "KRW", stock: 1, shippingFeeKrw: 3000, shippingRule: "결제 후 1~2영업일 내 출고", packagingRule: "완충재 포장", weightKg: 0.2, packageLengthCm: 10, packageWidthCm: 8, packageHeightCm: 4 },
    contentMode: "manual_mvp", imageSpecs: [], assignments: [], listings: [], sourceImages: [{ path: "fixture.jpg", url: "https://example.com/fixture.jpg" }], generatedImages: [], localizedListings: [], detailData: null,
  };
}
const packageFields = { weight: 0.2, length: 10, width: 8, height: 4 };
function enteredDraft(input = context()) {
  let current = buildChannelArguments("coupang", input, 10000, 1, undefined, packageFields, 10) as Record<string, unknown>;
  const fields = listingShippingRequirements("coupang", current, "listing.create");
  // Same setter and string values as the existing onChange callback. Synthetic
  // confirmation only, never a real account or approved operating value.
  const values: Record<string, string> = {
    "shipping-shippingRule": "확인", "shipping-packagingRule": "확인", "shipping-lead-time-0": "2",
    "shipping-lead-time-confirmation": JSON.stringify({ shippingRule: input.manualFields.shippingRule, outboundShippingTimeDay: 2, source: "coupang-wing", orderDateAndCalendarConfirmed: true, approvedPromiseMatched: true, sameDayShipping: false }),
  };
  for (const field of fields) {
    if (field.manualPath && values[field.key] !== undefined) current = setListingDraftValue(current, field.manualPath, values[field.key]);
  }
  return current;
}

test("actual required manualPaths work through existing callback setter and server guard", () => {
  const current = enteredDraft();
  assert.doesNotThrow(() => assertListingShippingReady("coupang", current, "listing.create"));
  const body = current.body as { items: Record<string, unknown>[] };
  assert.equal(body.items[0].outboundShippingTimeDay, "2");
  assert.equal(body.items[0].salePrice, 10000);
  assert.ok(Array.isArray(body.items[0].images));
});

test("unchanged source synchronization preserves array, explicit day and JSON confirmation", () => {
  const input = context();
  const current = enteredDraft(input);
  const next = JSON.parse(buildSynchronizedDraftMap(input, { coupang: JSON.stringify(current) }, 10000, 1, {}, packageFields, 10).coupang!);
  assert.ok(Array.isArray(next.body.items));
  assert.equal(next.body.items[0].outboundShippingTimeDay, "2");
  assert.equal(next.body.items[0].salePrice, 10000);
  assert.doesNotThrow(() => assertListingShippingReady("coupang", next, "listing.create"));
});

test("changed source synchronization clears the explicit day and receipt then blocks", () => {
  const input = context();
  const current = enteredDraft(input);
  input.manualFields.shippingRule = "판매자가 새로 확인해야 하는 출고 문구";
  const next = JSON.parse(buildSynchronizedDraftMap(input, { coupang: JSON.stringify(current) }, 10000, 1, {}, packageFields, 10).coupang!);
  assert.ok(Array.isArray(next.body.items));
  assert.equal(next.body.items[0].outboundShippingTimeDay, null);
  assert.equal(next.sellerpilotAssets.shipping.coupangLeadTimeConfirmation, undefined);
  assert.throws(() => assertListingShippingReady("coupang", next, "listing.create"), /shipping-lead-time/);
  assert.equal((current.body as { items: Record<string, unknown>[] }).items[0].outboundShippingTimeDay, "2");
});
