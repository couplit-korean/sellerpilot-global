import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  assertSmartstoreUnitCapacity,
  smartstoreIndicationUnits,
  smartstoreUpdateOriginProductWithPreservedUnitCapacity,
} from "../lib/channels/smartstore-unit-capacity";

const category = { id: "50000001", last: true, exceptionalCategories: ["UNIT_PRICE"] };
// Explicit fixture choice of 100g is NOT an approval/default for the real SKU.
const capacity = { unitPriceYn: true, totalCapacityValue: 315, unitCapacity: 100, indicationUnit: "g" };
function product(value: unknown = capacity) {
  return { leafCategoryId: category.id, salePrice: 3190, detailAttribute: { unitCapacity: value } };
}
function validate(value: unknown) { assertSmartstoreUnitCapacity({ originProduct: { ...product(), detailAttribute: { unitCapacity: value } }, category }); }

test("315g and3190 approved inputs are preserved without unit-price calculation or pack multiplication", () => {
  const originProduct = product();
  const before = structuredClone(originProduct);
  assertSmartstoreUnitCapacity({ originProduct, category });
  assert.deepEqual(originProduct, before);
  assert.equal(originProduct.salePrice, 3190);
  assert.equal((originProduct.detailAttribute.unitCapacity as typeof capacity).totalCapacityValue, 315);
});

test("required categories reject absent/null/nonboolean/false unitPriceYn", () => {
  for (const value of [undefined, null, {}, { unitPriceYn: null }, { unitPriceYn: "true" }, { unitPriceYn: 1 }, { unitPriceYn: false }]) {
    assert.throws(() => validate(value), /NAVER_UNIT_PRICE/);
  }
  assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: { leafCategoryId: category.id }, category }), /NAVER_UNIT_PRICE_YN_REQUIRED/);
});

test("unknown category evidence is never a unit-price exemption", () => {
  for (const metadata of [null, {}, { ...category, id: "99" }, { ...category, last: false }, { ...category, exceptionalCategories: undefined }, { ...category, exceptionalCategories: null }, { ...category, exceptionalCategories: "UNIT_PRICE" }, { ...category, exceptionalCategories: [false] }]) {
    assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: product(), category: metadata }), /NAVER_UNIT_CAPACITY_CATEGORY_UNVERIFIED/);
  }
});

test("official total capacity numeric range and three-decimal precision are enforced without coercion", () => {
  for (const total of [0.001, 0.123, 1.001, 315, 999_999_999]) validate({ ...capacity, totalCapacityValue: total });
  for (const total of [undefined, null, "315", 0, -1, 0.0009, 1.0001, 1_000_000_000, NaN, Infinity]) {
    assert.throws(() => validate({ ...capacity, totalCapacityValue: total }), /NAVER_UNIT_TOTAL_CAPACITY_INVALID/);
  }
});

test("display capacity requires explicitly selected integer1..999", () => {
  for (const unit of [1, 100, 999]) validate({ ...capacity, unitCapacity: unit });
  for (const unit of [undefined, null, "100", 0, 0.1, 1000, Infinity]) {
    assert.throws(() => validate({ ...capacity, unitCapacity: unit }), /NAVER_UNIT_DISPLAY_CAPACITY_INVALID/);
  }
});

test("official case-sensitive units are preserved and no g/kg/L conversion guessed", () => {
  for (const unit of smartstoreIndicationUnits) validate({ ...capacity, indicationUnit: unit });
  for (const unit of [undefined, null, "G", "l", "ML", " g", "g ", "oz", "315g"]) {
    assert.throws(() => validate({ ...capacity, indicationUnit: unit }), /NAVER_UNIT_INDICATION_UNIT_INVALID/);
  }
});

test("confirmed nontarget category permits omission, but malformed explicit decisions fail", () => {
  const nonTarget = { ...category, exceptionalCategories: [] };
  assertSmartstoreUnitCapacity({ originProduct: { leafCategoryId: category.id }, category: nonTarget });
  assertSmartstoreUnitCapacity({ originProduct: product({ unitPriceYn: false }), category: nonTarget });
  assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: product({ ...capacity, unitPriceYn: false }), category: nonTarget }), /NAVER_UNIT_CAPACITY_DISABLED_WITH_VALUES/);
  assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: product({ unitPriceYn: "false" }), category: nonTarget }), /NAVER_UNIT_PRICE_YN_REQUIRED/);
});

test("content update preserves current remote capacity only when the request omits it", () => {
  const current = product(capacity);
  const requested = { leafCategoryId: category.id, detailAttribute: { sellerCodeInfo: { sellerManagementCode: "SKU" } } };
  const preserved = smartstoreUpdateOriginProductWithPreservedUnitCapacity(requested, current);
  assert.deepEqual((preserved.detailAttribute as Record<string, unknown>).unitCapacity, capacity);
  assert.doesNotThrow(() => assertSmartstoreUnitCapacity({ originProduct: preserved, category }));
  assert.equal(Object.hasOwn(requested.detailAttribute, "unitCapacity"), false);

  const explicitPartial = smartstoreUpdateOriginProductWithPreservedUnitCapacity({
    ...requested,
    detailAttribute: { ...requested.detailAttribute, unitCapacity: { unitPriceYn: true } },
  }, current);
  assert.deepEqual((explicitPartial.detailAttribute as Record<string, unknown>).unitCapacity, { unitPriceYn: true });
  assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: explicitPartial, category }), /NAVER_UNIT_TOTAL_CAPACITY_INVALID/);

  const unavailable = smartstoreUpdateOriginProductWithPreservedUnitCapacity(requested, {
    leafCategoryId: category.id,
    detailAttribute: {},
  });
  assert.equal(Object.hasOwn(unavailable.detailAttribute as object, "unitCapacity"), false);
  assert.throws(() => assertSmartstoreUnitCapacity({ originProduct: unavailable, category }), /NAVER_UNIT_PRICE_YN_REQUIRED/);
});

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  return nextResolve(specifier, context);
} });
const { prepareMarketplaceListingArguments } = await import("../lib/channels/provider-listing-runtime");

function runtimeInput(unitCapacity: unknown, mutations: string[]) {
  const urls = Array.from({ length: 9 }, (_, i) => `https://images.example.com/${i}.jpg`);
  return {
    channel: "smartstore" as const, operation: "listing.create" as const, environment: "production" as const,
    credential: { access_token: "test-only", access_token_expires_at: "2099-01-01T00:00:00.000Z", after_service_phone: "02-1234-5678" },
    arguments: {
      publicationIntent: "live", imageUrls: urls,
      body: { originProduct: {
        ...product(unitCapacity), name: "롯샌 315g (6봉입)", stockQuantity: 1,
        detailContent: urls.slice(1).map(url => `<img src="${url}" />`).join(""),
        detailAttribute: { unitCapacity, sellerCodeInfo: { sellerManagementCode: "UNIT-CAPACITY-TEST-ONLY" } },
        deliveryInfo: { deliveryType: "DELIVERY", deliveryCompany: "HANJIN",
          deliveryFee: { deliveryFeeType: "PAID", baseFee: 3000, deliveryFeePayType: "PREPAID" },
          claimDeliveryInfo: { returnDeliveryCompanyPriorityType: "PRIMARY", returnDeliveryFee: 3000, exchangeDeliveryFee: 6000, shippingAddressId: 123, returnAddressId: 456 } },
      }, smartstoreChannelProduct: {} },
    },
    signal: new AbortController().signal,
    hooks: { assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { mutations.push("mutation"); } },
  };
}

test("runtime missing/disabled/malformed capacity stops after category GET before search, image fetch/upload or mutation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const invalid of [undefined, { unitPriceYn: false }, { ...capacity, totalCapacityValue: undefined }, { ...capacity, unitCapacity: undefined }]) {
      const calls: string[] = []; const mutations: string[] = [];
      globalThis.fetch = async (input) => {
        const url = String(input); calls.push(url);
        assert.ok(url.endsWith(`/v1/categories/${category.id}`));
        return Response.json(category);
      };
      await assert.rejects(prepareMarketplaceListingArguments(runtimeInput(invalid, mutations)), /NAVER_UNIT_/);
      assert.equal(calls.length, 1); assert.deepEqual(mutations, []);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("runtime valid explicit contract reaches existing duplicate guard unchanged, no live send", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = []; const mutations: string[] = [];
  const input = runtimeInput(capacity, mutations);
  const before = structuredClone(input.arguments);
  globalThis.fetch = async (request) => {
    const url = String(request); calls.push(url);
    if (url.endsWith(`/v1/categories/${category.id}`)) return Response.json(category);
    assert.ok(url.endsWith("/v1/products/search"));
    return Response.json({ code: "TEST_STOP" }, { status: 503 });
  };
  try {
    await assert.rejects(prepareMarketplaceListingArguments(input), /NAVER_DUPLICATE_PREFLIGHT_FAILED/);
    assert.equal(calls.length, 2); assert.deepEqual(mutations, []);
    assert.deepEqual(input.arguments, before);
  } finally { globalThis.fetch = originalFetch; }
});


test("runtime update preserves readback identity checks then blocks required omission before image mutation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = []; const mutations: string[] = [];
  const base = runtimeInput(undefined, mutations);
  const input = { ...base, operation: "listing.update" as const, arguments: { ...base.arguments, originProductNo: "13671684696" } };
  globalThis.fetch = async (request) => {
    const url = String(request); calls.push(url);
    if (url.endsWith("/v1/products/search")) return Response.json({
      page: 1, size: 50, totalElements: 1, totalPages: 1, first: true, last: true,
      contents: [{ originProductNo: "13671684696", channelProducts: [{ channelProductNo: "13732202182", sellerManagementCode: "UNIT-CAPACITY-TEST-ONLY" }] }],
    });
    if (url.endsWith("/v2/products/origin-products/13671684696")) return Response.json({
      originProductNo: "13671684696", smartstoreChannelProductNo: "13732202182",
      originProduct: { detailAttribute: { sellerCodeInfo: { sellerManagementCode: "UNIT-CAPACITY-TEST-ONLY" } } },
    });
    if (url.endsWith("/v2/products/channel-products/13732202182")) return Response.json({
      originProduct: { detailAttribute: { sellerCodeInfo: { sellerManagementCode: "UNIT-CAPACITY-TEST-ONLY" } } },
      smartstoreChannelProduct: { channelProductNo: "13732202182", originProductNo: "13671684696", sellerManagementCode: "UNIT-CAPACITY-TEST-ONLY" },
    });
    assert.ok(url.endsWith(`/v1/categories/${category.id}`));
    return Response.json(category);
  };
  try {
    await assert.rejects(prepareMarketplaceListingArguments(input), /NAVER_UNIT_PRICE_YN_REQUIRED/);
    assert.equal(calls.length, 4); assert.deepEqual(mutations, []);
    assert.equal(calls.some(url => url.includes("upload") || url.includes("images.example")), false);
  } finally { globalThis.fetch = originalFetch; }
});
