type UnknownRecord = Record<string, unknown>;

import {
  shopeeFiniteNonNegative,
  shopeeNonNegativeInteger,
  shopeePositiveInteger,
} from "./strict-numbers";

export type ShopeeSgPackage = {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type ShopeeSgWarehouse = {
  warehouseId: string;
  locationId: string;
  name: string;
};

export function parseShopeeSgDaysToShip(value: unknown) {
  const days = positiveInteger(value);
  if (days === null || (days !== 1 && (days < 4 || days > 10))) {
    throw new Error("SHOPEE_SG_DAYS_TO_SHIP_REQUIRED");
  }
  return days;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((row): row is UnknownRecord => Boolean(row))
    : [];
}

function exactRecords(value: unknown, errorCode: string) {
  if (!Array.isArray(value)) throw new Error(errorCode);
  const rows = value.map(record);
  if (rows.some((row) => row === null)) throw new Error(errorCode);
  return rows as UnknownRecord[];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveInteger(value: unknown) {
  return shopeePositiveInteger(value);
}

function nonNegativeInteger(value: unknown) {
  return shopeeNonNegativeInteger(value);
}

function finiteNonNegative(value: unknown) {
  return shopeeFiniteNonNegative(value);
}

function enabled(value: unknown) {
  return value === true || value === 1 || value === "1" || text(value).toLowerCase() === "true";
}

function exactShopId(value: unknown) {
  const shopId = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(shopId) ? shopId : null;
}

function officialResponse(value: unknown, errorCode: string) {
  const root = record(value);
  const response = root ? record(root.response) : null;
  const providerError = root?.error;
  const hasProviderError = providerError !== undefined
    && providerError !== null
    && !(typeof providerError === "string" && providerError.trim() === "");
  if (!root || hasProviderError || !response) throw new Error(errorCode);
  return response;
}

export function shopeeSgOfficialLogisticsChannels(value: unknown) {
  const response = officialResponse(value, "SHOPEE_SG_LOGISTICS_RESPONSE_INVALID");
  return exactRecords(response.logistics_channel_list, "SHOPEE_SG_LOGISTICS_RESPONSE_INVALID");
}

export function shopeeSgOfficialBrandPage(value: unknown) {
  const response = officialResponse(value, "SHOPEE_SG_BRAND_RESPONSE_INVALID");
  const brands = exactRecords(response.brand_list, "SHOPEE_SG_BRAND_RESPONSE_INVALID");
  const inputType = text(response.input_type).toUpperCase();
  const hasNextPage = response.has_next_page;
  const nextOffset = nonNegativeInteger(response.next_offset);
  if (typeof response.is_mandatory !== "boolean" || !inputType
    || typeof hasNextPage !== "boolean" || nextOffset === null) {
    throw new Error("SHOPEE_SG_BRAND_RESPONSE_INVALID");
  }
  return {
    brands,
    mandatory: response.is_mandatory,
    inputType,
    hasNextPage,
    nextOffset,
  };
}

export function shopeeSgOfficialAttributeTree(value: unknown, categoryIdValue: unknown) {
  const categoryId = positiveInteger(categoryIdValue);
  const response = officialResponse(value, "SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
  const results = exactRecords(response.list, "SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
  const matches = categoryId === null ? [] : results.filter((row) => (
    positiveInteger(row.category_id) === categoryId
  ));
  if (matches.length !== 1) throw new Error("SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
  return exactRecords(matches[0].attribute_tree, "SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
}

export function shopeeSgOfficialWarehousePage(value: unknown) {
  const response = officialResponse(value, "SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID");
  const cursor = record(response.cursor);
  if (!cursor || positiveInteger(cursor.page_size) === null) {
    throw new Error("SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID");
  }
  const nextId = cursor.next_id === null ? null : nonNegativeInteger(cursor.next_id);
  if (nextId === null && cursor.next_id !== null) {
    throw new Error("SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID");
  }
  return {
    warehouses: normalizeShopeeSgWarehouses(response.warehouse_list),
    nextId,
    pageSize: positiveInteger(cursor.page_size)!,
  };
}

export function shopeeSgOfficialEligibleShopPage(value: unknown) {
  const response = officialResponse(value, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_INVALID");
  const cursor = record(response.cursor);
  if (!cursor || positiveInteger(cursor.page_size) === null) {
    throw new Error("SHOPEE_SG_WAREHOUSE_ELIGIBILITY_INVALID");
  }
  const nextId = cursor.next_id === null ? null : nonNegativeInteger(cursor.next_id);
  if (nextId === null && cursor.next_id !== null) {
    throw new Error("SHOPEE_SG_WAREHOUSE_ELIGIBILITY_INVALID");
  }
  return {
    shops: exactRecords(response.shop_list, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_INVALID"),
    nextId,
    pageSize: positiveInteger(cursor.page_size)!,
  };
}

export function parseShopeeSgPackage(bodyValue: unknown): ShopeeSgPackage {
  const body = record(bodyValue) ?? {};
  const dimension = record(body.dimension) ?? {};
  const values = {
    weightKg: shopeeFiniteNonNegative(body.weight),
    lengthCm: shopeeFiniteNonNegative(dimension.package_length),
    widthCm: shopeeFiniteNonNegative(dimension.package_width),
    heightCm: shopeeFiniteNonNegative(dimension.package_height),
  };
  if (Object.values(values).some((value) => value === null || value <= 0)) {
    throw new Error("SHOPEE_SG_PACKAGE_REQUIRED");
  }
  return values as ShopeeSgPackage;
}

function packageFitsChannel(packageValue: ShopeeSgPackage, channel: UnknownRecord) {
  const weightLimit = record(channel.weight_limit) ?? {};
  const minWeight = finiteNonNegative(weightLimit.item_min_weight);
  const maxWeight = finiteNonNegative(weightLimit.item_max_weight);
  if ((minWeight !== null && packageValue.weightKg < minWeight)
      || (maxWeight !== null && maxWeight > 0 && packageValue.weightKg > maxWeight)) return false;
  const dimension = record(channel.item_max_dimension) ?? {};
  for (const [key, actual] of [
    ["length", packageValue.lengthCm],
    ["width", packageValue.widthCm],
    ["height", packageValue.heightCm],
  ] as const) {
    const maximum = finiteNonNegative(dimension[key]);
    if (maximum !== null && maximum > 0 && actual > maximum) return false;
  }
  const maximumSum = finiteNonNegative(dimension.dimension_sum);
  return maximumSum === null || maximumSum === 0
    || packageValue.lengthCm + packageValue.widthCm + packageValue.heightCm <= maximumSum;
}

export function validateShopeeSgLogisticsSelection(input: {
  selected: unknown;
  officialChannels: unknown;
  package: ShopeeSgPackage;
}) {
  const selected = exactRecords(input.selected, "SHOPEE_SG_LOGISTICS_SELECTION_INVALID");
  if (!selected.length) throw new Error("SHOPEE_SG_LOGISTICS_SELECTION_REQUIRED");
  const official = exactRecords(input.officialChannels, "SHOPEE_SG_LOGISTICS_RESPONSE_INVALID")
    .filter((row) => enabled(row.enabled));
  const officialById = new Map<number, UnknownRecord>();
  for (const row of official) {
    const id = positiveInteger(row.logistics_channel_id ?? row.logistic_id);
    if (id === null || officialById.has(id)) throw new Error("SHOPEE_SG_LOGISTICS_RESPONSE_INVALID");
    officialById.set(id, row);
  }
  if (!officialById.size) throw new Error("SHOPEE_SG_LOGISTICS_UNAVAILABLE");
  const seen = new Set<number>();
  const logistics = selected.map((row) => {
    const logisticId = positiveInteger(row.logistic_id);
    const channel = logisticId === null ? null : officialById.get(logisticId) ?? null;
    if (!channel || logisticId === null || seen.has(logisticId) || !enabled(row.enabled)) {
      throw new Error("SHOPEE_SG_LOGISTICS_SELECTION_INVALID");
    }
    seen.add(logisticId);
    if (!packageFitsChannel(input.package, channel)) {
      throw new Error("SHOPEE_SG_LOGISTICS_PACKAGE_UNSUPPORTED");
    }
    const feeType = text(channel.fee_type).toUpperCase();
    const sizeId = text(row.size_id);
    const shippingFee = finiteNonNegative(row.shipping_fee);
    if (feeType === "SIZE_SELECTION") {
      const available = new Set(records(channel.size_list).map((item) => text(item.size_id)).filter(Boolean));
      if (!sizeId || !available.has(sizeId)) throw new Error("SHOPEE_SG_LOGISTICS_SIZE_REQUIRED");
    }
    if (feeType === "CUSTOM_PRICE" && shippingFee === null) {
      throw new Error("SHOPEE_SG_LOGISTICS_FEE_REQUIRED");
    }
    const numericSizeId = positiveInteger(sizeId);
    return {
      logistic_id: logisticId,
      enabled: true,
      ...(sizeId ? { size_id: numericSizeId ?? sizeId } : {}),
      ...(shippingFee !== null ? { shipping_fee: shippingFee } : {}),
      ...(typeof row.is_free === "boolean" ? { is_free: row.is_free } : {}),
    };
  });
  const compulsoryIds = official
    .filter((row) => enabled(row.compulsory_channel))
    .map((row) => positiveInteger(row.logistics_channel_id ?? row.logistic_id))
    .filter((id): id is number => id !== null);
  if (compulsoryIds.some((id) => !seen.has(id))) {
    throw new Error("SHOPEE_SG_COMPULSORY_LOGISTICS_REQUIRED");
  }
  return logistics;
}

export function resolveShopeeSgBrand(input: {
  selected: unknown;
  officialBrands: unknown;
  mandatory: unknown;
  inputType: unknown;
}) {
  const selected = record(input.selected) ?? {};
  const brandId = positiveInteger(selected.brand_id);
  const selectedName = text(selected.original_brand_name);
  const official = exactRecords(input.officialBrands, "SHOPEE_SG_BRAND_RESPONSE_INVALID");
  const officialBrandIds = official.map((row) => positiveInteger(row.brand_id));
  if (officialBrandIds.some((id) => id === null)
    || new Set(officialBrandIds).size !== officialBrandIds.length) {
    throw new Error("SHOPEE_SG_BRAND_RESPONSE_INVALID");
  }
  const matches = official.filter((row) => {
    const id = positiveInteger(row.brand_id);
    const name = text(row.display_brand_name ?? row.brand_name);
    if (brandId !== null) {
      return id === brandId
        && (!selectedName || name.toLocaleLowerCase() === selectedName.toLocaleLowerCase());
    }
    return Boolean(selectedName
      && name.toLocaleLowerCase() === selectedName.toLocaleLowerCase());
  });
  if (matches.length === 1) {
    const id = positiveInteger(matches[0].brand_id);
    const name = text(matches[0].display_brand_name ?? matches[0].brand_name);
    if (id === null || !name) throw new Error("SHOPEE_SG_BRAND_INVALID");
    return { brand_id: id, original_brand_name: name };
  }
  const freeTextAllowed = ["TEXT_FILED", "TEXT_FIELD", "FREE_TEXT"]
    .includes(text(input.inputType).toUpperCase());
  if (!enabled(input.mandatory) && freeTextAllowed && selectedName && (brandId === null || brandId === 0)) {
    return { brand_id: 0, original_brand_name: selectedName };
  }
  throw new Error(enabled(input.mandatory)
    ? "SHOPEE_SG_BRAND_REQUIRED"
    : "SHOPEE_SG_BRAND_INVALID");
}

export function validateShopeeSgRequiredAttributes(input: {
  supplied: unknown;
  metadata: unknown;
}) {
  const metadata = exactRecords(input.metadata, "SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
  const supplied = exactRecords(input.supplied, "SHOPEE_SG_ATTRIBUTE_INVALID");
  const suppliedById = new Map<number, UnknownRecord>();
  for (const row of supplied) {
    const id = positiveInteger(row.attribute_id);
    if (id === null || suppliedById.has(id)) throw new Error("SHOPEE_SG_ATTRIBUTE_INVALID");
    suppliedById.set(id, row);
  }
  const activeIds = new Set<number>();
  const normalizedById = new Map<number, { attribute_id: number; attribute_value_list: Array<{ value_id: number } | { original_value_name: string }> }>();
  const missing: number[] = [];

  const visit = (nodesValue: unknown) => {
    const nodes = exactRecords(nodesValue, "SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
    for (const meta of nodes) {
      const id = positiveInteger(meta.attribute_id);
      const info = record(meta.attribute_info);
      const inputType = positiveInteger(info?.input_type);
      if (id === null || inputType === null || inputType > 5 || activeIds.has(id)) {
        throw new Error("SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
      }
      activeIds.add(id);
      const mandatoryRegions = info && Array.isArray(info.mandatory_region)
        ? info.mandatory_region.map(text).map((region) => region.toUpperCase())
        : [];
      const required = enabled(meta.is_mandatory ?? meta.mandatory)
        || mandatoryRegions.includes("SG");
      const selected = suppliedById.get(id);
      if (!selected) {
        if (required) missing.push(id);
        continue;
      }

      const allowedRows = exactRecords(meta.attribute_value_list, "SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
      const allowedById = new Map<number, UnknownRecord>();
      for (const allowed of allowedRows) {
        const valueId = positiveInteger(allowed.value_id);
        if (valueId === null || allowedById.has(valueId)) {
          throw new Error("SHOPEE_SG_ATTRIBUTE_METADATA_INVALID");
        }
        allowedById.set(valueId, allowed);
      }
      const suppliedValues = exactRecords(selected.attribute_value_list, "SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
      const maxValueCount = nonNegativeInteger(info?.max_value_count);
      const singleValueInput = [1, 2, 3].includes(inputType);
      if (!suppliedValues.length || (singleValueInput && suppliedValues.length > 1)
        || (maxValueCount !== null && maxValueCount > 0
        && suppliedValues.length > maxValueCount)) {
        throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_REQUIRED");
      }
      const selectedAllowed: UnknownRecord[] = [];
      const selectedValueIdentities = new Set<string>();
      const selectedValueNames = new Set<string>();
      const normalizedValues = suppliedValues.map((value) => {
        const valueId = positiveInteger(value.value_id);
        const originalValueName = text(value.original_value_name);
        if (valueId !== null) {
          const allowed = allowedById.get(valueId);
          if (!allowed) throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
          const identity = `id:${valueId}`;
          if (selectedValueIdentities.has(identity)) throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
          selectedValueIdentities.add(identity);
          const officialName = text(allowed.display_value_name ?? allowed.original_value_name ?? allowed.name).toLocaleLowerCase();
          if (officialName && selectedValueNames.has(officialName)) throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
          if (officialName) selectedValueNames.add(officialName);
          selectedAllowed.push(allowed);
          return { value_id: valueId };
        }
        if (![2, 3, 5].includes(inputType) || !originalValueName) {
          throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
        }
        const identity = `name:${originalValueName.toLocaleLowerCase()}`;
        if (selectedValueIdentities.has(identity)) throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
        selectedValueIdentities.add(identity);
        if (selectedValueNames.has(originalValueName.toLocaleLowerCase())) throw new Error("SHOPEE_SG_ATTRIBUTE_VALUE_INVALID");
        selectedValueNames.add(originalValueName.toLocaleLowerCase());
        return { original_value_name: originalValueName };
      });
      normalizedById.set(id, { attribute_id: id, attribute_value_list: normalizedValues });
      for (const allowed of selectedAllowed) {
        const children = allowed.child_attribute_list;
        if (children !== undefined) visit(children);
      }
    }
  };

  visit(metadata);
  if (missing.length) throw new Error(`SHOPEE_SG_REQUIRED_ATTRIBUTES_MISSING:${missing.join(",")}`);
  if ([...suppliedById.keys()].some((id) => !activeIds.has(id))) {
    throw new Error("SHOPEE_SG_ATTRIBUTE_INVALID");
  }
  return supplied.map((row) => normalizedById.get(positiveInteger(row.attribute_id)!)!);
}

export function normalizeShopeeSgWarehouses(value: unknown): ShopeeSgWarehouse[] {
  const rows = exactRecords(value, "SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID").map((row) => ({
    warehouseId: text(row.warehouse_id),
    locationId: text(row.location_id),
    name: text(row.warehouse_name),
  }));
  if (rows.some((row) => !row.warehouseId || !row.locationId)) {
    throw new Error("SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID");
  }
  const identities = rows.map((row) => `${row.warehouseId}:${row.locationId}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("SHOPEE_SG_WAREHOUSE_RESPONSE_INVALID");
  }
  return rows;
}

export function bindShopeeSgWarehouseStock(input: {
  sellerStock: unknown;
  totalStock: unknown;
  warehouses: readonly ShopeeSgWarehouse[];
}) {
  const stock = positiveInteger(input.totalStock);
  if (stock === null) throw new Error("SHOPEE_SG_STOCK_REQUIRED");
  const supplied = exactRecords(input.sellerStock, "SHOPEE_SG_WAREHOUSE_SELECTION_INVALID");
  if (supplied.length > 1 || supplied.some((row) => row.stock !== undefined && positiveInteger(row.stock) !== stock)) {
    throw new Error("SHOPEE_SG_WAREHOUSE_SELECTION_INVALID");
  }
  const requestedLocation = text(supplied[0]?.location_id);
  if (!input.warehouses.length) {
    throw new Error("SHOPEE_SG_WAREHOUSE_UNAVAILABLE");
  }
  if (!requestedLocation) throw new Error("SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED");
  const matches = input.warehouses.filter((warehouse) => warehouse.locationId === requestedLocation);
  if (matches.length !== 1) throw new Error("SHOPEE_SG_WAREHOUSE_SELECTION_REQUIRED");
  return { sellerStock: [{ location_id: requestedLocation, stock }], warehouse: matches[0] };
}

export function assertShopeeSgWarehouseEligibleShop(input: {
  warehouse: ShopeeSgWarehouse;
  targetShopId: unknown;
  eligibleShops: unknown;
}) {
  const shopId = exactShopId(input.targetShopId);
  if (!shopId) throw new Error("SHOPEE_SG_SHOP_ID_INVALID");
  const shopIds = exactRecords(input.eligibleShops, "SHOPEE_SG_WAREHOUSE_ELIGIBILITY_INVALID")
    .map((row) => exactShopId(row.shop_id));
  if (shopIds.some((value) => value === null) || new Set(shopIds).size !== shopIds.length) {
    throw new Error("SHOPEE_SG_WAREHOUSE_ELIGIBILITY_INVALID");
  }
  if (!shopIds.includes(shopId)) throw new Error("SHOPEE_SG_WAREHOUSE_SHOP_INELIGIBLE");
  return { warehouseId: input.warehouse.warehouseId, shopId };
}

export function shopeeSgRequirementInputPaths(error: unknown) {
  const code = error instanceof Error ? error.message : text(error);
  if (code.includes("DAYS_TO_SHIP")) {
    return [["body", "days_to_ship"], ["publish", "item", "days_to_ship"]];
  }
  if (code.includes("BRAND")) return [["body", "brand", "original_brand_name"]];
  if (code.includes("LOGISTICS")) return [["publish", "item", "logistic"]];
  if (code.includes("WAREHOUSE")) return [["body", "seller_stock", "0", "location_id"]];
  if (code.includes("ATTRIBUTE")) return [["body", "attribute_list"]];
  if (code.includes("PACKAGE")) return [["body", "weight"], ["body", "dimension"]];
  return [];
}
