import assert from "node:assert/strict";
import test from "node:test";
import {
  assertShopeeSgWarehouseEligibleShop,
  bindShopeeSgWarehouseStock,
  normalizeShopeeSgWarehouses,
  parseShopeeSgDaysToShip,
  parseShopeeSgPackage,
  resolveShopeeSgBrand,
  shopeeSgOfficialBrandPage,
  shopeeSgOfficialAttributeTree,
  shopeeSgOfficialEligibleShopPage,
  shopeeSgOfficialLogisticsChannels,
  shopeeSgOfficialWarehousePage,
  shopeeSgRequirementInputPaths,
  validateShopeeSgLogisticsSelection,
  validateShopeeSgRequiredAttributes,
} from "../lib/product-registration/shopee/sg-requirements";

const packageValue = parseShopeeSgPackage({
  weight: 0.4,
  dimension: { package_length: 28, package_width: 20, package_height: 7 },
});

test("Shopee SG requires the current Seller Centre days-to-ship choices", () => {
  assert.equal(parseShopeeSgDaysToShip(1), 1);
  for (let days = 4; days <= 10; days += 1) {
    assert.equal(parseShopeeSgDaysToShip(days), days);
  }
  for (const invalid of [undefined, null, "", true, 0, 2, 3, 11, 1.5, Number.NaN]) {
    assert.throws(() => parseShopeeSgDaysToShip(invalid), /SHOPEE_SG_DAYS_TO_SHIP_REQUIRED/u);
  }
});

test("Shopee SG validates the seller selection instead of enabling every active logistics channel", () => {
  const official = [
    { logistics_channel_id: 10, enabled: true, compulsory_channel: true, fee_type: "SIZE_SELECTION", size_list: [{ size_id: 3 }], weight_limit: { item_min_weight: 0.1, item_max_weight: 1 } },
    { logistics_channel_id: 20, enabled: true, compulsory_channel: false, fee_type: "CUSTOM_PRICE" },
  ];
  assert.deepEqual(validateShopeeSgLogisticsSelection({
    selected: [{ logistic_id: 10, enabled: true, size_id: 3 }],
    officialChannels: official,
    package: packageValue,
  }), [{ logistic_id: 10, enabled: true, size_id: 3 }]);
  assert.throws(() => validateShopeeSgLogisticsSelection({
    selected: [{ logistic_id: 20, enabled: true, shipping_fee: 2.5 }],
    officialChannels: official,
    package: packageValue,
  }), /SHOPEE_SG_COMPULSORY_LOGISTICS_REQUIRED/u);
  assert.throws(() => validateShopeeSgLogisticsSelection({
    selected: [{ logistic_id: 10, enabled: true, size_id: 4 }],
    officialChannels: official,
    package: packageValue,
  }), /SHOPEE_SG_LOGISTICS_SIZE_REQUIRED/u);
  assert.throws(() => validateShopeeSgLogisticsSelection({
    selected: [{ logistic_id: 99, enabled: true }],
    officialChannels: official,
    package: packageValue,
  }), /SHOPEE_SG_LOGISTICS_SELECTION_INVALID/u);
});

test("Shopee SG binds only one exact official brand and never invents an ID", () => {
  const brands = [
    { brand_id: 101, display_brand_name: "Lotte" },
    { brand_id: 202, display_brand_name: "No Brand" },
  ];
  assert.deepEqual(resolveShopeeSgBrand({
    selected: { brand_id: 101, original_brand_name: "Lotte" },
    officialBrands: brands,
    mandatory: true,
    inputType: "DROP_DOWN",
  }), { brand_id: 101, original_brand_name: "Lotte" });
  assert.throws(() => resolveShopeeSgBrand({
    selected: { brand_id: 999, original_brand_name: "Lotte-ish" },
    officialBrands: brands,
    mandatory: true,
    inputType: "DROP_DOWN",
  }), /SHOPEE_SG_BRAND_REQUIRED/u);
  assert.throws(() => resolveShopeeSgBrand({
    selected: { brand_id: 999, original_brand_name: "Lotte" },
    officialBrands: brands,
    mandatory: true,
    inputType: "DROP_DOWN",
  }), /SHOPEE_SG_BRAND_REQUIRED/u);
  assert.deepEqual(resolveShopeeSgBrand({
    selected: { brand_id: 0, original_brand_name: "Seller confirmed brand" },
    officialBrands: [],
    mandatory: false,
    inputType: "FREE_TEXT",
  }), { brand_id: 0, original_brand_name: "Seller confirmed brand" });
});

test("Shopee SG accepts all current mandatory attributes and rejects guesses or stale IDs", () => {
  const metadata = [
    { attribute_id: 1, mandatory: true, attribute_info: { input_type: 1, max_value_count: 1 }, attribute_value_list: [{ value_id: 11 }] },
    { attribute_id: 2, mandatory: true, attribute_info: { input_type: 3, max_value_count: 1 }, attribute_value_list: [] },
    { attribute_id: 3, mandatory: false, attribute_info: { input_type: 1, max_value_count: 1 }, attribute_value_list: [{ value_id: 31 }] },
  ];
  assert.deepEqual(validateShopeeSgRequiredAttributes({
    supplied: [
      { attribute_id: 1, attribute_value_list: [{ value_id: 11 }] },
      { attribute_id: 2, attribute_value_list: [{ original_value_name: "315 g x 6" }] },
    ],
    metadata,
  }), [
    { attribute_id: 1, attribute_value_list: [{ value_id: 11 }] },
    { attribute_id: 2, attribute_value_list: [{ original_value_name: "315 g x 6" }] },
  ]);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 12 }] }],
    metadata,
  }), /SHOPEE_SG_ATTRIBUTE_VALUE_INVALID/u);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
    metadata,
  }), /SHOPEE_SG_REQUIRED_ATTRIBUTES_MISSING:2/u);
});

test("Shopee SG warehouse stock keeps global and local shop identities separate", () => {
  const warehouses = normalizeShopeeSgWarehouses([
    { warehouse_id: "wh-a", location_id: "loc-a", warehouse_name: "Singapore A" },
    { warehouse_id: "wh-b", location_id: "loc-b", warehouse_name: "Singapore B" },
  ]);
  assert.throws(() => bindShopeeSgWarehouseStock({ sellerStock: [{ stock: 1 }], totalStock: 1, warehouses }), /SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED/u);
  assert.throws(() => bindShopeeSgWarehouseStock({
    sellerStock: [{ stock: 1 }],
    totalStock: 1,
    warehouses: [warehouses[0]],
  }), /SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED/u);
  const bound = bindShopeeSgWarehouseStock({ sellerStock: [{ location_id: "loc-b", stock: 1 }], totalStock: 1, warehouses });
  assert.deepEqual(bound.sellerStock, [{ location_id: "loc-b", stock: 1 }]);
  assert.deepEqual(assertShopeeSgWarehouseEligibleShop({
    warehouse: bound.warehouse!,
    targetShopId: "70000001",
    eligibleShops: [{ shop_id: "70000001" }, { shop_id: "70000002" }],
  }), { warehouseId: "wh-b", shopId: "70000001" });
  assert.throws(() => assertShopeeSgWarehouseEligibleShop({
    warehouse: bound.warehouse!,
    targetShopId: "70000003",
    eligibleShops: [{ shop_id: "70000001" }],
  }), /SHOPEE_SG_WAREHOUSE_SHOP_INELIGIBLE/u);
});

test("Shopee SG provider errors map back to persisted input paths", () => {
  assert.deepEqual(shopeeSgRequirementInputPaths(new Error("SHOPEE_SG_DAYS_TO_SHIP_REQUIRED")), [
    ["body", "days_to_ship"],
    ["publish", "item", "days_to_ship"],
  ]);
  assert.deepEqual(shopeeSgRequirementInputPaths(new Error("SHOPEE_SG_BRAND_REQUIRED")), [["body", "brand", "original_brand_name"]]);
  assert.deepEqual(shopeeSgRequirementInputPaths(new Error("SHOPEE_SG_LOGISTICS_SIZE_REQUIRED")), [["publish", "item", "logistic"]]);
  assert.deepEqual(shopeeSgRequirementInputPaths(new Error("SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED")), [["body", "seller_stock", "0", "location_id"]]);
  assert.deepEqual(shopeeSgRequirementInputPaths(new Error("SHOPEE_SG_REQUIRED_ATTRIBUTES_MISSING:2")), [["body", "attribute_list"]]);
});

test("Shopee SG rejects malformed or duplicate provider metadata instead of dropping it", () => {
  assert.throws(() => validateShopeeSgLogisticsSelection({
    selected: [{ logistic_id: 10, enabled: true }],
    officialChannels: [
      { logistics_channel_id: 10, enabled: true },
      { logistics_channel_id: 10, enabled: true },
    ],
    package: packageValue,
  }), /SHOPEE_SG_LOGISTICS_RESPONSE_INVALID/u);
  assert.throws(() => resolveShopeeSgBrand({
    selected: { brand_id: 101, original_brand_name: "Lotte" },
    officialBrands: [{ brand_id: 101, display_brand_name: "Lotte" }, null],
    mandatory: true,
    inputType: "DROP_DOWN",
  }), /SHOPEE_SG_BRAND_RESPONSE_INVALID/u);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
    metadata: [
      { attribute_id: 1, mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [{ value_id: 11 }] },
      { attribute_id: 1, mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [{ value_id: 11 }] },
    ],
  }), /SHOPEE_SG_ATTRIBUTE_METADATA_INVALID/u);
  assert.throws(() => normalizeShopeeSgWarehouses([
    { warehouse_id: "wh-a", location_id: "loc-a" },
    { warehouse_id: "wh-b" },
  ]), /SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID/u);
});

test("Shopee SG parses the current official response envelopes without guessing field names", () => {
  assert.deepEqual(shopeeSgOfficialLogisticsChannels({
    error: "",
    response: { logistics_channel_list: [{ logistics_channel_id: 4000, enabled: true }] },
  }), [{ logistics_channel_id: 4000, enabled: true }]);
  assert.deepEqual(shopeeSgOfficialBrandPage({
    error: "",
    response: {
      brand_list: [{ brand_id: 2500139861, original_brand_name: "nike", display_brand_name: "nike" }],
      has_next_page: true,
      next_offset: 10,
      is_mandatory: false,
      input_type: "TEXT_FILED",
    },
  }), {
    brands: [{ brand_id: 2500139861, original_brand_name: "nike", display_brand_name: "nike" }],
    mandatory: false,
    inputType: "TEXT_FILED",
    hasNextPage: true,
    nextOffset: 10,
  });
  assert.deepEqual(shopeeSgOfficialAttributeTree({
    error: "",
    response: { list: [{
      category_id: 100787,
      attribute_tree: [{ attribute_id: 1, mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [] }],
    }] },
  }, 100787), [{ attribute_id: 1, mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [] }]);
  assert.deepEqual(shopeeSgOfficialWarehousePage({
    error: null,
    response: {
      warehouse_list: [{ warehouse_id: 10001020, location_id: "SG1006Y4Z", warehouse_name: "SG Warehouse 2" }],
      cursor: { next_id: null, page_size: 30 },
    },
  }), {
    warehouses: [{ warehouseId: "10001020", locationId: "SG1006Y4Z", name: "SG Warehouse 2" }],
    nextId: null,
    pageSize: 30,
  });
  assert.deepEqual(shopeeSgOfficialEligibleShopPage({
    error: null,
    response: {
      shop_list: [{ shop_id: 222859294, shop_name: "test_shop11" }],
      cursor: { next_id: 222859324, page_size: 4 },
    },
  }), {
    shops: [{ shop_id: 222859294, shop_name: "test_shop11" }],
    nextId: 222859324,
    pageSize: 4,
  });
});

test("Shopee SG rejects non-empty structured provider errors and coercible non-numbers", () => {
  assert.throws(() => shopeeSgOfficialLogisticsChannels({
    error: { code: "invalid_access_token" },
    response: { logistics_channel_list: [] },
  }), /SHOPEE_SG_LOGISTICS_RESPONSE_INVALID/u);
  for (const invalid of [true, false, null, "", [], [0.4], {}, Number.NaN]) {
    assert.throws(() => parseShopeeSgPackage({
      weight: invalid,
      dimension: { package_length: 28, package_width: 20, package_height: 7 },
    }), /SHOPEE_SG_PACKAGE_REQUIRED/u);
  }
  assert.throws(() => validateShopeeSgLogisticsSelection({
    selected: [{ logistic_id: true, enabled: true }],
    officialChannels: [{ logistics_channel_id: 1, enabled: true }],
    package: packageValue,
  }), /SHOPEE_SG_LOGISTICS_SELECTION_INVALID/u);
});

test("Shopee SG rejects duplicate attribute values and multiple values for official single-value input types", () => {
  const singleDropdown = [{
    attribute_id: 1,
    mandatory: true,
    attribute_info: { input_type: 1 },
    attribute_value_list: [{ value_id: 11 }, { value_id: 12 }],
  }];
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }, { value_id: 12 }] }],
    metadata: singleDropdown,
  }), /SHOPEE_SG_ATTRIBUTE_VALUE_REQUIRED/u);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }, { value_id: 11 }] }],
    metadata: [{ ...singleDropdown[0], attribute_info: { input_type: 4 } }],
  }), /SHOPEE_SG_ATTRIBUTE_VALUE_INVALID/u);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{
      attribute_id: 2,
      attribute_value_list: [{ original_value_name: "Red" }, { original_value_name: " red " }],
    }],
    metadata: [{
      attribute_id: 2,
      mandatory: true,
      attribute_info: { input_type: 5 },
      attribute_value_list: [],
    }],
  }), /SHOPEE_SG_ATTRIBUTE_VALUE_INVALID/u);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{
      attribute_id: 3,
      attribute_value_list: [{ value_id: 31 }, { original_value_name: " red " }],
    }],
    metadata: [{
      attribute_id: 3,
      mandatory: true,
      attribute_info: { input_type: 5 },
      attribute_value_list: [{ value_id: 31, display_value_name: "Red" }],
    }],
  }), /SHOPEE_SG_ATTRIBUTE_VALUE_INVALID/u);
});

test("Shopee SG activates child attributes only for the selected parent value", () => {
  const metadata = [{
    attribute_id: 1,
    mandatory: true,
    attribute_info: { input_type: 1, max_value_count: 1 },
    attribute_value_list: [
      {
        value_id: 11,
        child_attribute_list: [{
          attribute_id: 2,
          mandatory: true,
          attribute_info: { input_type: 3, max_value_count: 1 },
          attribute_value_list: [],
        }],
      },
      { value_id: 12, child_attribute_list: [] },
    ],
  }];
  assert.deepEqual(validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 12 }] }],
    metadata,
  }), [{ attribute_id: 1, attribute_value_list: [{ value_id: 12 }] }]);
  assert.throws(() => validateShopeeSgRequiredAttributes({
    supplied: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
    metadata,
  }), /SHOPEE_SG_REQUIRED_ATTRIBUTES_MISSING:2/u);
  assert.deepEqual(validateShopeeSgRequiredAttributes({
    supplied: [
      { attribute_id: 1, attribute_value_list: [{ value_id: 11 }] },
      { attribute_id: 2, attribute_value_list: [{ original_value_name: "child answer" }] },
    ],
    metadata,
  }), [
    { attribute_id: 1, attribute_value_list: [{ value_id: 11 }] },
    { attribute_id: 2, attribute_value_list: [{ original_value_name: "child answer" }] },
  ]);
});
