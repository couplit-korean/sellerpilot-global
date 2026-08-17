import {
  coupangRequest,
  ebayRequest,
  fetchNaverAccessToken,
  lazadaRequest,
  naverRequest,
  qoo10Request,
  shopeeMerchantRequest,
  shopeeRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";
import {
  channelCatalog,
  type ActiveChannelKey,
  type ChannelCapabilityKey,
} from "./catalog";

export const channelOperationNames = [
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.update",
  "listing.stop",
  "price.update",
  "inventory.update",
  "orders.list",
  "orders.get",
  "shipment.acknowledge",
  "shipment.confirm",
] as const;

export type ChannelOperationName = (typeof channelOperationNames)[number];

export const channelOperationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
  "price.update": "price",
  "inventory.update": "inventory",
  "orders.list": "orders",
  "orders.get": "orders",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};

export const writeChannelOperations = new Set<ChannelOperationName>([
  "listing.create",
  "listing.update",
  "listing.stop",
  "price.update",
  "inventory.update",
  "shipment.acknowledge",
  "shipment.confirm",
]);

export type ChannelOperationStep = {
  name: string;
  ok: boolean;
  status: number;
  requestId?: string;
  data: Record<string, unknown>;
};

export type ChannelOperationResult = {
  ok: boolean;
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  steps: ChannelOperationStep[];
  remoteId?: string;
  safeMessage: string;
};

type ExecuteInput = {
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
};

function objectValue(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (!required) return {};
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

function stringArgument(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!required) return "";
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

function booleanArgument(source: Record<string, unknown>, key: string, fallback = false) {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function integerArgument(source: Record<string, unknown>, key: string, options?: { min?: number; max?: number }) {
  const raw = source[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < (options?.min ?? 0) || value > (options?.max ?? Number.MAX_SAFE_INTEGER)) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function stringMap(source: Record<string, unknown>, key: string, required = false) {
  const value = objectValue(source, key, required);
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
  );
  return Object.fromEntries(entries.map(([name, item]) => [name, String(item)]));
}

function queryParams(source: Record<string, unknown>, key = "query") {
  return new URLSearchParams(stringMap(source, key));
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function requestIdentifier(data: Record<string, unknown>) {
  for (const key of ["request_id", "requestId", "traceId", "rCode"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return undefined;
}

function step(name: string, remote: RemoteResponse): ChannelOperationStep {
  const resultCode = remote.data.ResultCode ?? remote.data.ErrorCode;
  const commonCode = remote.data.code;
  const shopeeError = remote.data.error;
  const normalizedCommonCode = commonCode === undefined || commonCode === null ? "" : String(commonCode).toUpperCase();
  const commonCodeAccepted = !normalizedCommonCode
    || ["0", "SUCCESS", "SUCCES", "OK"].includes(normalizedCommonCode)
    || (/^2\d\d$/.test(normalizedCommonCode));
  const providerAccepted =
    (resultCode === undefined || resultCode === null || String(resultCode) === "0") &&
    commonCodeAccepted &&
    (shopeeError === undefined || shopeeError === null || String(shopeeError) === "");
  return {
    name,
    ok: remote.response.ok && providerAccepted,
    status: remote.response.status,
    requestId: requestIdentifier(remote.data),
    data: remote.data,
  };
}

function result(input: ExecuteInput, steps: ChannelOperationStep[], remoteId?: string): ChannelOperationResult {
  const ok = steps.length > 0 && steps.every((item) => item.ok);
  return {
    ok,
    channel: input.channel,
    operation: input.operation,
    steps,
    remoteId,
    safeMessage: ok
      ? `${channelCatalog[input.channel].name} ${input.operation} 작업이 정상 응답했습니다.`
      : `${channelCatalog[input.channel].name} ${input.operation} 작업이 원격 오류로 종료됐습니다.`,
  };
}

function lazadaXmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
}

function lazadaXmlNode(name: string, value: unknown): string {
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name)) throw new Error("LAZADA_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value)) return value.map((item) => lazadaXmlNode(name, item)).join("");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => lazadaXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${lazadaXmlEscape(String(value))}</${name}>`;
}

function lazadaPayload(argumentsValue: Record<string, unknown>) {
  const request = argumentsValue.request;
  if (typeof request === "string" && request.trim()) return request.trim();
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const root = Object.entries(request as Record<string, unknown>);
    if (root.length !== 1 || root[0][0] !== "Request") throw new Error("LAZADA_PAYLOAD_ROOT_INVALID");
    return `<?xml version="1.0" encoding="UTF-8"?>${lazadaXmlNode(root[0][0], root[0][1])}`;
  }
  throw new Error("CHANNEL_ARGUMENT_REQUIRED:request");
}

function ensureProviderSupport(channel: ActiveChannelKey, operation: ChannelOperationName) {
  if (channel === "ebay" && operation === "shipment.acknowledge") {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  }
  const capability = channelCatalog[channel].capabilities[channelOperationCapabilities[operation]];
  if (capability.mode === "unsupported") throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  if (capability.mode === "vendor_docs_required") throw new Error(`CHANNEL_VENDOR_SPEC_REQUIRED:${operation}`);
}

async function executeQoo10(input: ExecuteInput) {
  const params = stringMap(input.arguments, "params");
  const map: Partial<Record<ChannelOperationName, { service: string; method: string; version?: string }>> = {
    "categories.list": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "categories.suggest": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "categories.attributes": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "categories.validate": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "listing.create": { service: "ItemsBasic", method: "SetNewGoods", version: "1.1" },
    "listing.update": { service: "ItemsBasic", method: "UpdateGoods" },
    "listing.stop": { service: "ItemsBasic", method: "EditGoodsStatus" },
    "price.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "inventory.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "orders.list": { service: "ShippingBasic", method: "GetShippingInfo_v3" },
    "shipment.confirm": { service: "ShippingBasic", method: "SetSendingInfo" },
  };
  if (input.operation === "orders.get") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "GetShippingInfo_v3",
      params,
    });
    return result(input, [step("shipping-info", remote)]);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "SetSellerCheckYN_V2",
      params,
    });
    return result(input, [step("seller-check", remote)]);
  }
  const definition = map[input.operation];
  if (!definition) throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const remote = await qoo10Request({ payload: input.payload, ...definition, params });
  const resultObject = remote.data.ResultObject;
  const remoteId = typeof resultObject === "string" || typeof resultObject === "number"
    ? String(resultObject)
    : resultObject && typeof resultObject === "object" && !Array.isArray(resultObject)
      ? ["GdNo", "ItemCode", "itemCode"]
        .map((key) => (resultObject as Record<string, unknown>)[key])
        .find((value): value is string | number => typeof value === "string" || typeof value === "number")
        ?.toString()
      : undefined;
  return result(input, [step(definition.method, remote)], remoteId);
}

function shopeeResponseId(data: Record<string, unknown>, key: string) {
  const response = data.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const value = (response as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

async function executeShopee(input: ExecuteInput) {
  const globalProduct = booleanArgument(input.arguments, "globalProduct");
  if (globalProduct && (input.operation === "categories.list" || input.operation === "categories.suggest")) {
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("global-categories", remote)]);
  }
  if (globalProduct && (input.operation === "categories.attributes" || input.operation === "categories.validate")) {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list")) query.set("category_id_list", categoryId);
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_attribute_tree",
      query,
    });
    return result(input, [step("global-category-attribute-tree", remote)], categoryId);
  }
  if (globalProduct && input.operation === "listing.create") {
    let globalItemId = stringArgument(input.arguments, "globalItemId", false);
    const steps: ChannelOperationStep[] = [];
    if (!globalItemId) {
      const createRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/add_global_item",
        body: objectValue(input.arguments, "body"),
      });
      const createStep = step("global-item-create", createRemote);
      globalItemId = shopeeResponseId(createRemote.data, "global_item_id") ?? "";
      steps.push(createStep);
      if (!createStep.ok || !globalItemId) return result(input, steps, globalItemId || undefined);
    }

    const readbackRemote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_global_item_info",
      query: new URLSearchParams({ global_item_id_list: globalItemId }),
    });
    steps.push(step("global-item-readback", readbackRemote));
    const publish = objectValue(input.arguments, "publish", false);
    const publishedItem = async (maxAttempts = 1) => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3_000));
        const remote = await shopeeMerchantRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/global_product/get_published_list",
          query: new URLSearchParams({ global_item_id: globalItemId }),
        });
        const publishedStep = step(attempt === 0 ? "published-item-readback" : `published-item-readback-${attempt + 1}`, remote);
        steps.push(publishedStep);
        const response = remote.data.response;
        const rows = response && typeof response === "object" && !Array.isArray(response)
          && Array.isArray((response as Record<string, unknown>).published_item)
          ? (response as { published_item: unknown[] }).published_item
          : [];
        const requestedShopId = String(publish.shop_id ?? "");
        const row = rows.find((item) => item && typeof item === "object" && !Array.isArray(item)
          && (!requestedShopId || String((item as Record<string, unknown>).shop_id ?? "") === requestedShopId)) as Record<string, unknown> | undefined;
        const itemId = row?.item_id;
        if (typeof itemId === "string" || typeof itemId === "number") return { itemId: String(itemId), ok: publishedStep.ok };
        if (!publishedStep.ok) return { itemId: "", ok: false };
      }
      return { itemId: "", ok: true };
    };
    if (booleanArgument(input.arguments, "recoverPublished")) {
      const published = await publishedItem();
      return result(input, steps, published.itemId || globalItemId);
    }
    let publishTaskId = stringArgument(input.arguments, "publishTaskId", false);
    if (!publishTaskId) {
      if (!Object.keys(publish).length) return result(input, steps, globalItemId);
      const publishRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/create_publish_task",
        body: { ...publish, global_item_id: Number(globalItemId) },
      });
      const publishStep = step("publish-task-create", publishRemote);
      steps.push(publishStep);
      publishTaskId = shopeeResponseId(publishRemote.data, "publish_task_id") ?? "";
      if (!publishStep.ok || !publishTaskId) {
        const alreadyPublished = String(publishRemote.data.message ?? "").toLowerCase().includes("published this global item");
        if (!alreadyPublished) return result(input, steps, globalItemId);
        const published = await publishedItem();
        if (published.ok && published.itemId) publishStep.ok = true;
        return result(input, steps, published.itemId || globalItemId);
      }
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const taskRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_publish_task_result",
        query: new URLSearchParams({ publish_task_id: publishTaskId }),
      });
      const taskStep = step(`publish-task-result-${attempt + 1}`, taskRemote);
      const transientNotFound = String(taskRemote.data.message ?? "").toLowerCase().includes("task not found");
      if (transientNotFound && attempt < 5) continue;
      const response = taskRemote.data.response;
      const responseRecord = response && typeof response === "object" && !Array.isArray(response)
        ? response as Record<string, unknown>
        : {};
      const status = String(responseRecord.publish_status ?? responseRecord.status ?? "").toUpperCase();
      if (["FAILED", "FAIL"].includes(status)) taskStep.ok = false;
      const terminal = ["SUCCESS", "FAILED", "FAIL", "COMPLETED", "DONE"].includes(status);
      if (terminal || !taskStep.ok || attempt === 5) {
        if (!terminal && taskStep.ok) taskStep.ok = false;
        steps.push(taskStep);
        break;
      }
    }
    const published = await publishedItem(4);
    if (published.ok && published.itemId) {
      for (const item of steps) if (item.name.startsWith("publish-task-result-")) item.ok = true;
    }
    return result(input, steps, published.itemId || globalItemId);
  }
  if (input.operation === "categories.list" || input.operation === "categories.suggest") {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list")) query.set("category_id_list", categoryId);
    const treeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_attribute_tree",
      query,
    });
    const treeStep = step("category-attribute-tree", treeRemote);
    if (treeStep.ok) return result(input, [treeStep], categoryId);
    const error = String(treeRemote.data.error ?? "");
    if (!new Set(["api_suspended", "error_not_found", "wrong_path"]).has(error)) {
      return result(input, [treeStep], categoryId);
    }
    query.delete("category_id_list");
    query.set("category_id", categoryId);
    const legacyRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_attributes",
      query,
    });
    return result(input, [step("category-attributes-compatibility", legacyRemote)], categoryId);
  }
  const writePaths: Partial<Record<ChannelOperationName, string>> = {
    "listing.create": "/api/v2/product/add_item",
    "listing.update": "/api/v2/product/update_item",
    "listing.stop": "/api/v2/product/unlist_item",
    "price.update": "/api/v2/product/update_price",
    "inventory.update": "/api/v2/product/update_stock",
    "shipment.confirm": "/api/v2/logistics/ship_order",
  };
  const writePath = writePaths[input.operation];
  if (writePath) {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: writePath,
      body: objectValue(input.arguments, "body"),
    });
    const remoteId = shopeeResponseId(remote.data, input.operation === "listing.create" ? "item_id" : "request_id");
    const writeStep = step(input.operation, remote);
    if (input.operation === "listing.create" && writeStep.ok && remoteId) {
      const readback = await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_item_base_info",
        query: new URLSearchParams({ item_id_list: remoteId }),
      });
      return result(input, [writeStep, step("listing-readback", readback)], remoteId);
    }
    return result(input, [writeStep], remoteId);
  }
  if (input.operation === "orders.list") {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/order/get_order_list",
      query: queryParams(input.arguments),
    });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const query = queryParams(input.arguments);
    if (!query.has("order_sn_list")) query.set("order_sn_list", stringArgument(input.arguments, "orderSn"));
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/order/get_order_detail",
      query,
    });
    return result(input, [step("order", remote)], stringArgument(input.arguments, "orderSn", false) || undefined);
  }
  const remote = await shopeeRequest({
    payload: input.payload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/logistics/get_shipping_parameter",
    query: queryParams(input.arguments),
  });
  return result(input, [step("shipping-parameter", remote)]);
}

async function executeLazada(input: ExecuteInput) {
  const query = stringMap(input.arguments, "queryParams");
  if (input.operation === "categories.suggest") {
    const params = { ...query, product_name: stringArgument(input.arguments, "query") };
    const remote = await lazadaRequest({ payload: input.payload, path: "/product/category/suggestion/get", params });
    return result(input, [step("category-suggestion", remote)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const params = { ...query, primary_category_id: stringArgument(input.arguments, "categoryId") };
    const remote = await lazadaRequest({ payload: input.payload, path: "/category/attributes/get", params });
    return result(input, [step("category-attributes", remote)], params.primary_category_id);
  }
  const pathMap: Partial<Record<ChannelOperationName, string>> = {
    "categories.list": "/category/tree/get",
    "listing.create": "/product/create",
    "listing.update": "/product/update",
    "listing.stop": "/product/deactivate",
    "price.update": "/product/price_quantity/update",
    "inventory.update": "/product/price_quantity/update",
    "orders.list": "/orders/get",
    "shipment.confirm": "/order/package/rts",
  };
  if (input.operation === "orders.get") {
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/get",
      params: { ...query, order_id: stringArgument(input.arguments, "orderId") },
    });
    return result(input, [step("order", remote)]);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { ...query, payload: lazadaPayload(input.arguments) },
    });
    return result(input, [step("pack", remote)]);
  }
  const path = pathMap[input.operation];
  if (!path) throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const write = writeChannelOperations.has(input.operation);
  const params = write ? { ...query, payload: lazadaPayload(input.arguments) } : query;
  const remote = await lazadaRequest({ payload: input.payload, path, method: write ? "POST" : "GET", params });
  const dataValue = remote.data.data;
  const remoteId = dataValue && typeof dataValue === "object" && !Array.isArray(dataValue) && "item_id" in dataValue
    ? String((dataValue as Record<string, unknown>).item_id)
    : undefined;
  const writeStep = step(path, remote);
  if (input.operation === "listing.create" && writeStep.ok && remoteId) {
    const readback = await lazadaRequest({
      payload: input.payload,
      path: "/product/item/get",
      params: { item_id: remoteId },
    });
    return result(input, [writeStep, step("listing-readback", readback)], remoteId);
  }
  return result(input, [writeStep], remoteId);
}

async function executeCoupang(input: ExecuteInput) {
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  const sellerProductsPath = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
  if (input.operation === "categories.list") {
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: "/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories",
      query: queryParams(input.arguments),
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.suggest") {
    const body = objectValue(input.arguments, "body", false);
    const productName = stringArgument(input.arguments, "query", false) || stringArgument(body, "productName");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: "/v2/providers/openapi/apis/api/v1/categorization/predict",
      body: { ...body, productName },
    });
    return result(input, [step("category-suggestion", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId"));
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${categoryId}`,
    });
    return result(input, [step("category-metadata", remote)], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId"));
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}/status`,
    });
    return result(input, [step("category-status", remote)], categoryId);
  }
  if (input.operation === "listing.create" || input.operation === "listing.update") {
    const body = { ...objectValue(input.arguments, "body"), vendorId };
    const remote = await coupangRequest({
      payload: input.payload,
      method: input.operation === "listing.create" ? "POST" : "PUT",
      path: sellerProductsPath,
      body,
    });
    const remoteId = typeof remote.data.data === "number" || typeof remote.data.data === "string" ? String(remote.data.data) : undefined;
    return result(input, [step(input.operation, remote)], remoteId);
  }
  if (input.operation === "listing.stop") {
    const vendorItemId = pathSegment(stringArgument(input.arguments, "vendorItemId"));
    const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/sales/stop` });
    return result(input, [step("sales-stop", remote)], vendorItemId);
  }
  if (input.operation === "price.update") {
    const vendorItemId = pathSegment(stringArgument(input.arguments, "vendorItemId"));
    const price = integerArgument(input.arguments, "price", { min: 10 });
    if (price % 10 !== 0) throw new Error("CHANNEL_ARGUMENT_INVALID:price_must_be_10_won_unit");
    const query = new URLSearchParams({ forceSalePriceUpdate: String(booleanArgument(input.arguments, "forceSalePriceUpdate")) });
    const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/prices/${price}`, query });
    return result(input, [step("price", remote)], vendorItemId);
  }
  if (input.operation === "inventory.update") {
    const vendorItemId = pathSegment(stringArgument(input.arguments, "vendorItemId"));
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/quantities/${quantity}` });
    return result(input, [step("quantity", remote)], vendorItemId);
  }
  const orderBase = `/v2/providers/openapi/apis/api/v5/vendors/${pathSegment(vendorId)}`;
  if (input.operation === "orders.list") {
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path: `${orderBase}/ordersheets`, query: queryParams(input.arguments) });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const shipmentBoxId = pathSegment(stringArgument(input.arguments, "shipmentBoxId"));
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path: `${orderBase}/ordersheets/${shipmentBoxId}` });
    return result(input, [step("order", remote)], shipmentBoxId);
  }
  if (input.operation === "shipment.acknowledge") {
    const shipmentBoxIds = input.arguments.shipmentBoxIds;
    if (!Array.isArray(shipmentBoxIds) || shipmentBoxIds.length < 1 || shipmentBoxIds.length > 50) throw new Error("CHANNEL_ARGUMENT_INVALID:shipmentBoxIds");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "PATCH",
      path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/ordersheets/acknowledgement`,
      body: { vendorId, shipmentBoxIds },
    });
    return result(input, [step("acknowledgement", remote)]);
  }
  const body = { ...objectValue(input.arguments, "body"), vendorId };
  const remote = await coupangRequest({
    payload: input.payload,
    method: "POST",
    path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/orders/invoices`,
    body,
  });
  return result(input, [step("invoice", remote)]);
}

async function executeSmartstore(input: ExecuteInput) {
  let token = await fetchNaverAccessToken(input.payload);
  const request = async (requestInput: Omit<Parameters<typeof naverRequest>[0], "accessToken">) => {
    let remote = await naverRequest({ ...requestInput, accessToken: token.accessToken });
    if (remote.response.status === 401 && textValue(remote.data, "code") === "GW.AUTHN") {
      token = await fetchNaverAccessToken(input.payload);
      remote = await naverRequest({ ...requestInput, accessToken: token.accessToken });
    }
    return remote;
  };
  if (input.operation === "categories.list") {
    const categoryId = stringArgument(input.arguments, "categoryId", false);
    const query = new URLSearchParams();
    if (booleanArgument(input.arguments, "leafOnly", true)) query.set("last", "true");
    const remote = categoryId
      ? await request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` })
      : await request({ method: "GET", path: "/v1/categories", query });
    return result(input, [step("category", remote)], categoryId || undefined);
  }
  if (input.operation === "categories.suggest") {
    const remote = await request({ method: "GET", path: "/v1/categories", query: new URLSearchParams({ last: "true" }) });
    return result(input, [step("category-tree", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = new URLSearchParams({ categoryId });
    const [category, attributes, values, options] = await Promise.all([
      request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` }),
      request({ method: "GET", path: "/v1/product-attributes/attributes", query }),
      request({ method: "GET", path: "/v1/product-attributes/attribute-values", query }),
      request({ method: "GET", path: "/v1/options/standard-options", query }),
    ]);
    return result(input, [step("category", category), step("attributes", attributes), step("attribute-values", values), step("standard-options", options)], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` });
    return result(input, [step("category-validation", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const remote = await request({ method: "POST", path: "/v2/products", body: objectValue(input.arguments, "body") });
    const remoteId = remote.data.originProductNo === undefined ? undefined : String(remote.data.originProductNo);
    return result(input, [step("product-create", remote)], remoteId);
  }
  if (input.operation === "listing.update") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await request({ method: "PUT", path: `/v2/products/origin-products/${originProductNo}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("product-update", remote)], originProductNo);
  }
  if (input.operation === "listing.stop") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await request({
      method: "PUT",
      path: `/v1/products/origin-products/${originProductNo}/change-status`,
      body: { ...objectValue(input.arguments, "body", false), statusType: "SUSPENSION" },
    });
    return result(input, [step("status-stop", remote)], originProductNo);
  }
  if (input.operation === "price.update") {
    const remote = await request({ method: "PUT", path: "/v1/products/origin-products/bulk-update", body: objectValue(input.arguments, "body") });
    return result(input, [step("bulk-price", remote)]);
  }
  if (input.operation === "inventory.update") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await request({ method: "PUT", path: `/v1/products/origin-products/${originProductNo}/option-stock`, body: objectValue(input.arguments, "body") });
    return result(input, [step("option-stock", remote)], originProductNo);
  }
  if (input.operation === "orders.list") {
    const remote = await request({ method: "GET", path: "/v1/pay-order/seller/product-orders/last-changed-statuses", query: queryParams(input.arguments) });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const productOrderId = stringArgument(input.arguments, "productOrderId");
    const remote = await request({
      method: "POST",
      path: "/v1/pay-order/seller/product-orders/query",
      body: { productOrderIds: [productOrderId], quantityClaimCompatibility: true },
    });
    return result(input, [step("order", remote)], productOrderId);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await request({ method: "POST", path: "/v1/pay-order/seller/product-orders/confirm", body: objectValue(input.arguments, "body") });
    return result(input, [step("confirm", remote)]);
  }
  const remote = await request({ method: "POST", path: "/v1/pay-order/seller/product-orders/dispatch", body: objectValue(input.arguments, "body") });
  return result(input, [step("dispatch", remote)]);
}

async function executeEbay(input: ExecuteInput) {
  if (input.operation === "categories.list") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}` });
    return result(input, [step("taxonomy", remote)], categoryTreeId);
  }
  if (input.operation === "categories.suggest") {
    let categoryTreeId = stringArgument(input.arguments, "categoryTreeId", false);
    const marketplaceId = stringArgument(input.arguments, "marketplaceId", false) || textValue(input.payload, "marketplace_id") || "EBAY_US";
    const steps: ChannelOperationStep[] = [];
    if (!categoryTreeId) {
      const tree = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/commerce/taxonomy/v1/get_default_category_tree_id", query: new URLSearchParams({ marketplace_id: marketplaceId }) });
      steps.push(step("default-category-tree", tree));
      if (!tree.response.ok) return result(input, steps);
      categoryTreeId = String(tree.data.categoryTreeId ?? "");
    }
    if (!categoryTreeId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:categoryTreeId");
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${pathSegment(categoryTreeId)}/get_category_suggestions`, query: new URLSearchParams({ q: stringArgument(input.arguments, "query") }) });
    steps.push(step("category-suggestions", remote));
    return result(input, steps, categoryTreeId);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category`, query: new URLSearchParams({ category_id: categoryId }) });
    return result(input, [step("category-aspects", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const inventoryItem = objectValue(input.arguments, "inventoryItem");
    const offer = objectValue(input.arguments, "offer");
    const steps: ChannelOperationStep[] = [];
    const itemRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/inventory_item/${sku}`, body: inventoryItem });
    steps.push(step("inventory-item", itemRemote));
    if (!itemRemote.response.ok) return result(input, steps, sku);
    const offerRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: "/sell/inventory/v1/offer", body: offer });
    steps.push(step("offer", offerRemote));
    const offerId = offerRemote.data.offerId === undefined ? undefined : String(offerRemote.data.offerId);
    if (offerRemote.response.ok && offerId && booleanArgument(input.arguments, "publish")) {
      const publishRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/inventory/v1/offer/${pathSegment(offerId)}/publish` });
      steps.push(step("publish", publishRemote));
      const listingId = publishRemote.data.listingId === undefined ? undefined : String(publishRemote.data.listingId);
      return result(input, steps, listingId ?? offerId);
    }
    return result(input, steps, offerId ?? sku);
  }
  if (input.operation === "listing.update") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/offer/${offerId}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("offer-update", remote)], offerId);
  }
  if (input.operation === "listing.stop") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/inventory/v1/offer/${offerId}/withdraw` });
    return result(input, [step("offer-withdraw", remote)], offerId);
  }
  if (input.operation === "price.update") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/offer/${offerId}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("offer-price", remote)], offerId);
  }
  if (input.operation === "inventory.update") {
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/inventory_item/${sku}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("inventory-item", remote)], sku);
  }
  if (input.operation === "orders.list") {
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/fulfillment/v1/order", query: queryParams(input.arguments) });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const orderId = pathSegment(stringArgument(input.arguments, "orderId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/fulfillment/v1/order/${orderId}` });
    return result(input, [step("order", remote)], orderId);
  }
  const orderId = pathSegment(stringArgument(input.arguments, "orderId"));
  const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, body: objectValue(input.arguments, "body") });
  return result(input, [step("shipping-fulfillment", remote)], orderId);
}

export async function executeChannelOperation(input: ExecuteInput): Promise<ChannelOperationResult> {
  ensureProviderSupport(input.channel, input.operation);
  if (input.channel === "qoo10") return executeQoo10(input);
  if (input.channel === "shopee") return executeShopee(input);
  if (input.channel === "lazada") return executeLazada(input);
  if (input.channel === "coupang") return executeCoupang(input);
  if (input.channel === "smartstore") return executeSmartstore(input);
  if (input.channel === "ebay") return executeEbay(input);
  throw new Error("CHANNEL_VENDOR_SPEC_REQUIRED:elevenst");
}
