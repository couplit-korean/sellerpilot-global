import assert from "node:assert/strict";
import test from "node:test";
import { loadShopeeSgOfficialRequirementCandidates, prepareShopeeSgOfficialRequirements, type ShopeeSgRequirementRemote } from "../lib/product-registration/shopee/provider-requirements";

function remote(data: unknown): ShopeeSgRequirementRemote {
  return { response: { ok: true }, data };
}

test("Shopee SG resolves every official requirement before returning a create body", async () => {
  const calls: string[] = [];
  const result = await prepareShopeeSgOfficialRequirements({
    body: {
      category_id: 100787,
      brand: { brand_id: 101, original_brand_name: "Lotte" },
      attribute_list: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
      seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
      days_to_ship: 1,
      weight: 0.4,
      dimension: { package_length: 28, package_width: 20, package_height: 7 },
    },
    publishItem: {
      category_id: 100787,
      brand: { brand_id: 101, original_brand_name: "Lotte" },
      attribute_list: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
      seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
      days_to_ship: 1,
      weight: 0.4,
      dimension: { package_length: 28, package_width: 20, package_height: 7 },
      logistic: [{ logistic_id: 10, enabled: true, size_id: "3" }],
    },
    targetShopId: "70000001",
    globalAttributeResponse: { error: "", response: { list: [{
      category_id: 100787,
      attribute_tree: [{
        attribute_id: 1,
        mandatory: true,
        attribute_info: { input_type: 1, max_value_count: 1 },
        attribute_value_list: [{ value_id: 11 }],
      }],
    }] } },
    readers: {
      shopGet: async (path) => {
        calls.push(`GET ${path}`);
        return remote({ error: "", response: { logistics_channel_list: [{
          logistics_channel_id: 10,
          enabled: true,
          compulsory_channel: true,
          fee_type: "SIZE_SELECTION",
          size_list: [{ size_id: "3" }],
          weight_limit: { item_min_weight: 0.1, item_max_weight: 1 },
        }] } });
      },
      merchantGet: async (path) => {
        calls.push(`GET ${path}`);
        return remote({ error: "", response: {
          brand_list: [{ brand_id: 101, display_brand_name: "Lotte" }],
          has_next_page: false,
          next_offset: 0,
          is_mandatory: true,
          input_type: "DROP_DOWN",
        } });
      },
      merchantPost: async (path) => {
        calls.push(`POST ${path}`);
        if (path.endsWith("get_merchant_warehouse_list")) {
          return remote({ error: null, response: {
            warehouse_list: [{ warehouse_id: 9001, location_id: "SG-LOC", warehouse_name: "Pickup" }],
            cursor: { next_id: null, page_size: 30 },
          } });
        }
        return remote({ error: null, response: {
          shop_list: [{ shop_id: 70000001, shop_name: "SG Shop" }],
          cursor: { next_id: null, page_size: 30 },
        } });
      },
    },
  });
  assert.deepEqual(calls, [
    "GET /api/v2/logistics/get_channel_list",
    "GET /api/v2/global_product/get_brand_list",
    "POST /api/v2/merchant/get_merchant_warehouse_list",
    "POST /api/v2/merchant/get_warehouse_eligible_shop_list",
  ]);
  assert.deepEqual(result.body.brand, { brand_id: 101, original_brand_name: "Lotte" });
  assert.deepEqual(result.body.seller_stock, [{ location_id: "SG-LOC", stock: 3 }]);
  assert.deepEqual(result.publishItem.logistic, [{ logistic_id: 10, enabled: true, size_id: 3 }]);
  assert.deepEqual(result.evidence, {
    logisticsChannelIds: [10],
    brandId: 101,
    warehouseId: "9001",
    shopId: "70000001",
    daysToShip: 1,
    attributeIds: [1],
  });
});

test("Shopee SG blocks before returning a body when the selected warehouse is not eligible for the exact shop", async () => {
  const result = prepareShopeeSgOfficialRequirements({
    body: {
      category_id: 100787,
      brand: { brand_id: 101, original_brand_name: "Lotte" },
      attribute_list: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
      normal_stock: 1,
      seller_stock: [{ location_id: "SG-LOC", stock: 1 }],
      days_to_ship: 4,
      weight: 0.4,
      dimension: { package_length: 28, package_width: 20, package_height: 7 },
    },
    publishItem: {
      category_id: 100787,
      brand: { brand_id: 101, original_brand_name: "Lotte" },
      attribute_list: [{ attribute_id: 1, attribute_value_list: [{ value_id: 11 }] }],
      normal_stock: 1,
      seller_stock: [{ location_id: "SG-LOC", stock: 1 }],
      days_to_ship: 4,
      weight: 0.4,
      dimension: { package_length: 28, package_width: 20, package_height: 7 },
      logistic: [{ logistic_id: 10, enabled: true }],
    },
    targetShopId: "70000001",
    globalAttributeResponse: { error: "", response: { list: [{
      category_id: 100787,
      attribute_tree: [{ attribute_id: 1, mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [{ value_id: 11 }] }],
    }] } },
    readers: {
      shopGet: async () => remote({ error: "", response: { logistics_channel_list: [{ logistics_channel_id: 10, enabled: true }] } }),
      merchantGet: async () => remote({ error: "", response: { brand_list: [{ brand_id: 101, display_brand_name: "Lotte" }], has_next_page: false, next_offset: 0, is_mandatory: true, input_type: "DROP_DOWN" } }),
      merchantPost: async (path) => path.endsWith("get_merchant_warehouse_list")
        ? remote({ error: null, response: { warehouse_list: [{ warehouse_id: 9001, location_id: "SG-LOC", warehouse_name: "Pickup" }], cursor: { next_id: null, page_size: 30 } } })
        : remote({ error: null, response: { shop_list: [{ shop_id: 70000002 }], cursor: { next_id: null, page_size: 30 } } }),
    },
  });
  await assert.rejects(result, /SHOPEE_SG_WAREHOUSE_SHOP_INELIGIBLE/u);
});

test("Shopee SG loads every official candidate without selecting a brand, logistics channel, or warehouse", async () => {
  const calls: string[] = [];
  const result = await loadShopeeSgOfficialRequirementCandidates({
    categoryId: 100787,
    readers: {
      merchantGet: async (path) => {
        calls.push(`GET ${path}`);
        if (path.endsWith("get_category")) {
          return remote({ error: "", response: { category_list: [
            { category_id: 100000, parent_category_id: 0, display_category_name: "Health", has_children: true },
            { category_id: 100787, parent_category_id: 100000, display_category_name: "Supplements", has_children: false },
          ] } });
        }
        if (path.endsWith("get_attribute_tree")) {
          return remote({ error: "", response: { list: [{
            category_id: 100787,
            attribute_tree: [{ attribute_id: 1, mandatory: true, attribute_info: { input_type: 1 }, attribute_value_list: [{ value_id: 11 }] }],
          }] } });
        }
        return remote({ error: "", response: {
          brand_list: [{ brand_id: 101, display_brand_name: "Lotte" }],
          has_next_page: false,
          next_offset: 0,
          is_mandatory: true,
          input_type: "DROP_DOWN",
        } });
      },
      shopGet: async (path) => {
        calls.push(`GET ${path}`);
        return remote({ error: "", response: { logistics_channel_list: [{ logistics_channel_id: 10, enabled: true }] } });
      },
      merchantPost: async (path, body) => {
        calls.push(`POST ${path}`);
        if (path.endsWith("get_merchant_warehouse_list")) {
          return remote({ error: null, response: {
            warehouse_list: [
              { warehouse_id: 9001, location_id: "SG-A", warehouse_name: "A" },
              { warehouse_id: 9002, location_id: "SG-B", warehouse_name: "B" },
            ],
            cursor: { next_id: null, page_size: 30 },
          } });
        }
        return remote({ error: null, response: {
          shop_list: [{ shop_id: body.warehouse_id === 9001 ? 70000001 : 70000002 }],
          cursor: { next_id: null, page_size: 30 },
        } });
      },
    },
  });
  assert.deepEqual(result.category, {
    categoryId: "100787",
    path: ["Health", "Supplements"],
    hasChildren: false,
  });
  assert.deepEqual(result.brand.brands, [{ brand_id: 101, display_brand_name: "Lotte" }]);
  assert.deepEqual(result.logistics.channels, [{ logistics_channel_id: 10, enabled: true }]);
  assert.deepEqual(result.warehouses.warehouses.map((item) => item.locationId), ["SG-A", "SG-B"]);
  assert.deepEqual(result.eligibleShops.byWarehouse, [
    { warehouseId: "9001", shops: [{ shop_id: 70000001 }] },
    { warehouseId: "9002", shops: [{ shop_id: 70000002 }] },
  ]);
  assert.equal(calls.filter((call) => call.endsWith("get_warehouse_eligible_shop_list")).length, 2);
});

test("Shopee SG candidate loading rejects coercible non-integer category identifiers", async () => {
  const readers = {
    merchantGet: async () => remote({}),
    shopGet: async () => remote({}),
    merchantPost: async () => remote({}),
  };
  for (const categoryId of [true, null, "", [], [100787], {}, 100787.5, Number.NaN]) {
    await assert.rejects(
      loadShopeeSgOfficialRequirementCandidates({ categoryId, readers }),
      /SHOPEE_GLOBAL_CATEGORY_MISSING/u,
    );
  }
});

test("Shopee SG blocks missing, invalid, or divergent days to ship before provider reads", async () => {
  const readers = {
    merchantGet: async () => { throw new Error("unexpected provider read"); },
    shopGet: async () => { throw new Error("unexpected provider read"); },
    merchantPost: async () => { throw new Error("unexpected provider read"); },
  };
  const packageFields = {
    category_id: 100787,
    weight: 0.4,
    dimension: { package_length: 28, package_width: 20, package_height: 7 },
  };
  for (const invalid of [undefined, 2, 3, 11, true]) {
    await assert.rejects(prepareShopeeSgOfficialRequirements({
      body: { ...packageFields, days_to_ship: invalid },
      publishItem: { ...packageFields, days_to_ship: 1 },
      targetShopId: "70000001",
      globalAttributeResponse: {},
      readers,
    }), /SHOPEE_SG_DAYS_TO_SHIP_REQUIRED/u);
  }
  await assert.rejects(prepareShopeeSgOfficialRequirements({
    body: { ...packageFields, days_to_ship: 1 },
    publishItem: { ...packageFields, days_to_ship: 4 },
    targetShopId: "70000001",
    globalAttributeResponse: {},
    readers,
  }), /SHOPEE_SG_GLOBAL_LOCAL_DAYS_TO_SHIP_MISMATCH/u);
});
