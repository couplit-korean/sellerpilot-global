import {
  assertShopeeSgWarehouseEligibleShop,
  bindShopeeSgWarehouseStock,
  normalizeShopeeSgWarehouses,
  parseShopeeSgPackage,
  resolveShopeeSgBrand,
  shopeeSgOfficialBrandPage,
  shopeeSgOfficialAttributeTree,
  shopeeSgOfficialEligibleShopPage,
  shopeeSgOfficialLogisticsChannels,
  shopeeSgOfficialWarehousePage,
  validateShopeeSgLogisticsSelection,
  validateShopeeSgRequiredAttributes,
} from "./sg-requirements";
import { shopeeExactGlobalCategoryPath } from "../../channels/shopee-category-tree";
import { shopeePositiveInteger } from "./strict-numbers";

type UnknownRecord = Record<string, unknown>;

export type ShopeeSgRequirementRemote = {
  response: { ok: boolean };
  data: unknown;
};

export type ShopeeSgRequirementReaders = {
  merchantGet: (path: string, query: URLSearchParams) => Promise<ShopeeSgRequirementRemote>;
  merchantPost: (path: string, body: UnknownRecord) => Promise<ShopeeSgRequirementRemote>;
  shopGet: (path: string, query: URLSearchParams) => Promise<ShopeeSgRequirementRemote>;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function successfulData(remote: ShopeeSgRequirementRemote, errorCode: string) {
  if (!remote.response.ok) throw new Error(errorCode);
  return remote.data;
}

function exactPositiveInteger(value: unknown, errorCode: string) {
  const parsed = shopeePositiveInteger(value);
  if (parsed === null) throw new Error(errorCode);
  return parsed;
}

async function loadOfficialBrands(input: {
  categoryId: number;
  merchantGet: ShopeeSgRequirementReaders["merchantGet"];
}) {
  const brands: UnknownRecord[] = [];
  const seenOffsets = new Set<number>();
  let offset = 0;
  let mandatory: boolean | null = null;
  let inputType = "";
  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    if (seenOffsets.has(offset)) throw new Error("SHOPEE_SG_BRAND_PAGINATION_INVALID");
    seenOffsets.add(offset);
    const remote = await input.merchantGet(
      "/api/v2/global_product/get_brand_list",
      new URLSearchParams({
        category_id: String(input.categoryId),
        offset: String(offset),
        page_size: "20",
        status: "1",
      }),
    );
    const page = shopeeSgOfficialBrandPage(successfulData(remote, "SHOPEE_SG_BRAND_QUERY_FAILED"));
    if ((mandatory !== null && mandatory !== page.mandatory)
      || (inputType && inputType !== page.inputType)) {
      throw new Error("SHOPEE_SG_BRAND_RESPONSE_INVALID");
    }
    mandatory = page.mandatory;
    inputType = page.inputType;
    brands.push(...page.brands);
    if (!page.hasNextPage) return { brands, mandatory, inputType };
    if (page.nextOffset <= offset) throw new Error("SHOPEE_SG_BRAND_PAGINATION_INVALID");
    offset = page.nextOffset;
  }
  throw new Error("SHOPEE_SG_BRAND_PAGINATION_INCOMPLETE");
}

async function loadOfficialPickupWarehouses(
  merchantPost: ShopeeSgRequirementReaders["merchantPost"],
) {
  const warehouses = [];
  const seenNextIds = new Set<number>();
  let nextId = 0;
  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    if (seenNextIds.has(nextId)) throw new Error("SHOPEE_SG_WAREHOUSE_PAGINATION_INVALID");
    seenNextIds.add(nextId);
    const remote = await merchantPost("/api/v2/merchant/get_merchant_warehouse_list", {
      warehouse_type: 1,
      cursor: { next_id: nextId, page_size: 30 },
    });
    const page = shopeeSgOfficialWarehousePage(
      successfulData(remote, "SHOPEE_SG_WAREHOUSE_QUERY_FAILED"),
    );
    warehouses.push(...page.warehouses);
    if (page.nextId === null) return normalizeShopeeSgWarehouses(warehouses.map((warehouse) => ({
      warehouse_id: warehouse.warehouseId,
      location_id: warehouse.locationId,
      warehouse_name: warehouse.name,
    })));
    nextId = page.nextId;
  }
  throw new Error("SHOPEE_SG_WAREHOUSE_PAGINATION_INCOMPLETE");
}

async function loadOfficialEligibleShops(input: {
  warehouseId: string;
  merchantPost: ShopeeSgRequirementReaders["merchantPost"];
}) {
  const warehouseId = exactPositiveInteger(input.warehouseId, "SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID");
  const shops: UnknownRecord[] = [];
  const seenNextIds = new Set<number>();
  let nextId = 0;
  for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
    if (seenNextIds.has(nextId)) throw new Error("SHOPEE_SG_WAREHOUSE_ELIGIBILITY_PAGINATION_INVALID");
    seenNextIds.add(nextId);
    const remote = await input.merchantPost("/api/v2/merchant/get_warehouse_eligible_shop_list", {
      warehouse_id: warehouseId,
      warehouse_type: 1,
      cursor: { next_id: nextId, page_size: 30 },
    });
    const page = shopeeSgOfficialEligibleShopPage(
      successfulData(remote, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_QUERY_FAILED"),
    );
    shops.push(...page.shops);
    if (page.nextId === null) return shops;
    nextId = page.nextId;
  }
  throw new Error("SHOPEE_SG_WAREHOUSE_ELIGIBILITY_PAGINATION_INCOMPLETE");
}

export async function loadShopeeSgOfficialRequirementCandidates(input: {
  categoryId: unknown;
  readers: ShopeeSgRequirementReaders;
}) {
  const categoryId = exactPositiveInteger(input.categoryId, "SHOPEE_GLOBAL_CATEGORY_MISSING");
  const categoryQuery = new URLSearchParams({ language: "en" });
  const attributeQuery = new URLSearchParams({
    category_id_list: String(categoryId),
    language: "en",
  });
  const [categoryRemote, attributeRemote, logisticsRemote, brand, warehouses] = await Promise.all([
    input.readers.merchantGet("/api/v2/global_product/get_category", categoryQuery),
    input.readers.merchantGet("/api/v2/global_product/get_attribute_tree", attributeQuery),
    input.readers.shopGet("/api/v2/logistics/get_channel_list", new URLSearchParams()),
    loadOfficialBrands({ categoryId, merchantGet: input.readers.merchantGet }),
    loadOfficialPickupWarehouses(input.readers.merchantPost),
  ]);
  const categoryData = successfulData(categoryRemote, "SHOPEE_SG_CATEGORY_QUERY_FAILED");
  const path = shopeeExactGlobalCategoryPath(categoryData, String(categoryId));
  if (!path) throw new Error("SHOPEE_SG_CATEGORY_NOT_EXACT_LEAF");
  const attributes = shopeeSgOfficialAttributeTree(
    successfulData(attributeRemote, "SHOPEE_SG_ATTRIBUTE_QUERY_FAILED"),
    categoryId,
  );
  const logistics = shopeeSgOfficialLogisticsChannels(
    successfulData(logisticsRemote, "SHOPEE_SG_LOGISTICS_QUERY_FAILED"),
  );
  const eligibleByWarehouse = await Promise.all(warehouses.map(async (warehouse) => ({
    warehouseId: warehouse.warehouseId,
    shops: await loadOfficialEligibleShops({
      warehouseId: warehouse.warehouseId,
      merchantPost: input.readers.merchantPost,
    }),
  })));
  return {
    category: {
      categoryId: String(categoryId),
      path: path.names,
      hasChildren: false,
    },
    brand: {
      brands: brand.brands,
      mandatory: brand.mandatory ?? false,
      inputType: brand.inputType,
    },
    attributes: { attributeTree: attributes },
    logistics: { channels: logistics },
    warehouses: { warehouses },
    eligibleShops: { byWarehouse: eligibleByWarehouse },
  };
}

export async function prepareShopeeSgOfficialRequirements(input: {
  body: unknown;
  publishItem: unknown;
  targetShopId: unknown;
  globalAttributeResponse: unknown;
  readers: ShopeeSgRequirementReaders;
}) {
  const body = structuredClone(record(input.body));
  const publishItem = structuredClone(record(input.publishItem));
  const categoryId = exactPositiveInteger(body.category_id, "SHOPEE_GLOBAL_CATEGORY_MISSING");
  const packageValue = parseShopeeSgPackage(body);
  const publishPackage = parseShopeeSgPackage(publishItem);
  if (JSON.stringify(packageValue) !== JSON.stringify(publishPackage)) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_PACKAGE_MISMATCH");
  }

  const logisticsRemote = await input.readers.shopGet(
    "/api/v2/logistics/get_channel_list",
    new URLSearchParams(),
  );
  const logistics = validateShopeeSgLogisticsSelection({
    selected: publishItem.logistic,
    officialChannels: shopeeSgOfficialLogisticsChannels(
      successfulData(logisticsRemote, "SHOPEE_SG_LOGISTICS_QUERY_FAILED"),
    ),
    package: packageValue,
  });

  const brandPage = await loadOfficialBrands({
    categoryId,
    merchantGet: input.readers.merchantGet,
  });
  const brand = resolveShopeeSgBrand({
    selected: body.brand,
    officialBrands: brandPage.brands,
    mandatory: brandPage.mandatory,
    inputType: brandPage.inputType,
  });
  const publishBrand = resolveShopeeSgBrand({
    selected: publishItem.brand,
    officialBrands: brandPage.brands,
    mandatory: brandPage.mandatory,
    inputType: brandPage.inputType,
  });
  if (JSON.stringify(brand) !== JSON.stringify(publishBrand)) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_BRAND_MISMATCH");
  }
  const attributes = validateShopeeSgRequiredAttributes({
    supplied: body.attribute_list,
    metadata: shopeeSgOfficialAttributeTree(input.globalAttributeResponse, categoryId),
  });
  const publishAttributes = validateShopeeSgRequiredAttributes({
    supplied: publishItem.attribute_list,
    metadata: shopeeSgOfficialAttributeTree(input.globalAttributeResponse, categoryId),
  });
  if (JSON.stringify(attributes) !== JSON.stringify(publishAttributes)) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_ATTRIBUTES_MISMATCH");
  }

  const warehouses = await loadOfficialPickupWarehouses(input.readers.merchantPost);
  const sellerStockRows = Array.isArray(body.seller_stock) ? body.seller_stock : [];
  const storedTotalStock = body.normal_stock ?? (sellerStockRows.length === 1
    ? record(sellerStockRows[0]).stock
    : undefined);
  const stock = bindShopeeSgWarehouseStock({
    sellerStock: body.seller_stock,
    totalStock: storedTotalStock,
    warehouses,
  });
  const publishSellerStockRows = Array.isArray(publishItem.seller_stock) ? publishItem.seller_stock : [];
  const publishTotalStock = publishItem.normal_stock ?? (publishSellerStockRows.length === 1
    ? record(publishSellerStockRows[0]).stock
    : undefined);
  const publishStock = bindShopeeSgWarehouseStock({
    sellerStock: publishItem.seller_stock,
    totalStock: publishTotalStock,
    warehouses,
  });
  if (JSON.stringify(stock.sellerStock) !== JSON.stringify(publishStock.sellerStock)
    || stock.warehouse.warehouseId !== publishStock.warehouse.warehouseId) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_WAREHOUSE_MISMATCH");
  }
  const eligibleShops = await loadOfficialEligibleShops({
    warehouseId: stock.warehouse.warehouseId,
    merchantPost: input.readers.merchantPost,
  });
  const eligibility = assertShopeeSgWarehouseEligibleShop({
    warehouse: stock.warehouse,
    targetShopId: input.targetShopId,
    eligibleShops,
  });

  return {
    body: {
      ...body,
      brand,
      attribute_list: attributes,
      seller_stock: stock.sellerStock,
    },
    publishItem: {
      ...publishItem,
      brand: publishBrand,
      attribute_list: publishAttributes,
      seller_stock: publishStock.sellerStock,
      logistic: logistics,
    },
    evidence: {
      logisticsChannelIds: logistics.map((item) => item.logistic_id),
      brandId: brand.brand_id,
      warehouseId: eligibility.warehouseId,
      shopId: eligibility.shopId,
      attributeIds: attributes.map((item) => item.attribute_id),
    },
  };
}
