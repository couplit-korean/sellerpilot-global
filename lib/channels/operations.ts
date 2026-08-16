import {
  coupangRequest,
  ebayRequest,
  fetchNaverAccessToken,
  lazadaRequest,
  naverRequest,
  qoo10Request,
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
  const providerAccepted =
    (resultCode === undefined || resultCode === null || String(resultCode) === "0") &&
    (commonCode === undefined || commonCode === null || ["", "0", "SUCCESS", "SUCCES", "OK"].includes(String(commonCode).toUpperCase()));
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

function lazadaPayload(argumentsValue: Record<string, unknown>) {
  const request = argumentsValue.request;
  if (typeof request === "string" && request.trim()) return request.trim();
  if (request && typeof request === "object") return JSON.stringify(request);
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
  const map: Record<Exclude<ChannelOperationName, "orders.get" | "shipment.acknowledge">, { service: string; method: string; version?: string }> = {
    "categories.list": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "listing.create": { service: "ItemsBasic", method: "SetNewGoods" },
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
  const remote = await qoo10Request({ payload: input.payload, ...definition, params });
  const remoteId = typeof remote.data.ResultObject === "string" ? remote.data.ResultObject : undefined;
  return result(input, [step(definition.method, remote)], remoteId);
}

async function executeLazada(input: ExecuteInput) {
  const query = stringMap(input.arguments, "query");
  const pathMap: Record<Exclude<ChannelOperationName, "orders.get" | "shipment.acknowledge">, string> = {
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
  const write = writeChannelOperations.has(input.operation);
  const params = write ? { ...query, payload: lazadaPayload(input.arguments) } : query;
  const remote = await lazadaRequest({ payload: input.payload, path, method: write ? "POST" : "GET", params });
  const dataValue = remote.data.data;
  const remoteId = dataValue && typeof dataValue === "object" && !Array.isArray(dataValue) && "item_id" in dataValue
    ? String((dataValue as Record<string, unknown>).item_id)
    : undefined;
  return result(input, [step(path, remote)], remoteId);
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
  const token = await fetchNaverAccessToken(input.payload);
  if (input.operation === "categories.list") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await naverRequest({ accessToken: token.accessToken, method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` });
    return result(input, [step("category", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const remote = await naverRequest({ accessToken: token.accessToken, method: "POST", path: "/v2/products", body: objectValue(input.arguments, "body") });
    const remoteId = remote.data.originProductNo === undefined ? undefined : String(remote.data.originProductNo);
    return result(input, [step("product-create", remote)], remoteId);
  }
  if (input.operation === "listing.update") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await naverRequest({ accessToken: token.accessToken, method: "PUT", path: `/v2/products/origin-products/${originProductNo}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("product-update", remote)], originProductNo);
  }
  if (input.operation === "listing.stop") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await naverRequest({
      accessToken: token.accessToken,
      method: "PUT",
      path: `/v1/products/origin-products/${originProductNo}/change-status`,
      body: { ...objectValue(input.arguments, "body", false), statusType: "SUSPENSION" },
    });
    return result(input, [step("status-stop", remote)], originProductNo);
  }
  if (input.operation === "price.update") {
    const remote = await naverRequest({ accessToken: token.accessToken, method: "PUT", path: "/v1/products/origin-products/bulk-update", body: objectValue(input.arguments, "body") });
    return result(input, [step("bulk-price", remote)]);
  }
  if (input.operation === "inventory.update") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await naverRequest({ accessToken: token.accessToken, method: "PUT", path: `/v1/products/origin-products/${originProductNo}/option-stock`, body: objectValue(input.arguments, "body") });
    return result(input, [step("option-stock", remote)], originProductNo);
  }
  if (input.operation === "orders.list") {
    const remote = await naverRequest({ accessToken: token.accessToken, method: "GET", path: "/v1/pay-order/seller/product-orders/last-changed-statuses", query: queryParams(input.arguments) });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const productOrderId = stringArgument(input.arguments, "productOrderId");
    const remote = await naverRequest({
      accessToken: token.accessToken,
      method: "POST",
      path: "/v1/pay-order/seller/product-orders/query",
      body: { productOrderIds: [productOrderId], quantityClaimCompatibility: true },
    });
    return result(input, [step("order", remote)], productOrderId);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await naverRequest({ accessToken: token.accessToken, method: "POST", path: "/v1/pay-order/seller/product-orders/confirm", body: objectValue(input.arguments, "body") });
    return result(input, [step("confirm", remote)]);
  }
  const remote = await naverRequest({ accessToken: token.accessToken, method: "POST", path: "/v1/pay-order/seller/product-orders/dispatch", body: objectValue(input.arguments, "body") });
  return result(input, [step("dispatch", remote)]);
}

async function executeEbay(input: ExecuteInput) {
  if (input.operation === "categories.list") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}` });
    return result(input, [step("taxonomy", remote)], categoryTreeId);
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
  if (input.channel === "lazada") return executeLazada(input);
  if (input.channel === "coupang") return executeCoupang(input);
  if (input.channel === "smartstore") return executeSmartstore(input);
  if (input.channel === "ebay") return executeEbay(input);
  throw new Error("CHANNEL_VENDOR_SPEC_REQUIRED:elevenst");
}
