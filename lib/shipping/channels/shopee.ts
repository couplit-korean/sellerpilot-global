import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { MAX_PROVIDER_SYNC_PAGES } from "../../channels/operation-pagination";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  objectArray,
  nestedObject,
  stringMap,
  queryParams,
} from "../../channels/operation-values";
import {
  shopeeRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "../../channels/protocols";
import { result, providerBoolean, paginationResult } from "../execution-shared";

export function shopeeOrderPageWithCredentialIdentity(
  remote: RemoteResponse,
  payload: SecretPayload,
): RemoteResponse {
  const shopId = textValue(payload, "shop_id");
  if (!/^[1-9][0-9]{0,31}$/.test(shopId)) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_SHOP_ID_INVALID");
  }
  const merchantId = textValue(payload, "merchant_id");
  if (merchantId && !/^[1-9][0-9]{0,31}$/.test(merchantId)) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_MERCHANT_ID_INVALID");
  }
  const providerIdentityVersion = textValue(
    payload,
    "provider_account_identity_version",
  );
  const providerSubject = textValue(payload, "provider_account_subject");
  const mainAccountId = textValue(payload, "main_account_id");
  const targetIds = (key: "shop_ids" | "merchant_ids") =>
    Array.isArray(payload[key])
      ? payload[key].map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
  const targets = objectArray(payload.shopee_targets);
  const mainIdentity =
    providerIdentityVersion === "v1" &&
    /^[1-9][0-9]{0,31}$/.test(mainAccountId) &&
    providerSubject === `shopee:main:${mainAccountId}`;
  if (providerIdentityVersion || providerSubject) {
    const directShopIdentity =
      providerIdentityVersion === "v1" &&
      providerSubject === `shopee:shop:${shopId}`;
    const mainShopAuthorized =
      mainIdentity &&
      targetIds("shop_ids").includes(shopId) &&
      targets.some(
        (target) =>
          target.type === "shop" && String(target.id ?? "").trim() === shopId,
      );
    if (!directShopIdentity && !mainShopAuthorized) {
      throw new Error("SHOPEE_ORDER_CREDENTIAL_LINEAGE_MISMATCH");
    }
  }
  if (
    merchantId &&
    (!mainIdentity ||
      !targetIds("merchant_ids").includes(merchantId) ||
      !targets.some(
        (target) =>
          target.type === "merchant" &&
          String(target.id ?? "").trim() === merchantId,
      ))
  ) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_MERCHANT_LINEAGE_MISMATCH");
  }

  const response = nestedObject(remote.data.response);
  const pageShopIds = [
    remote.data.shop_id,
    remote.data.shopId,
    response.shop_id,
    response.shopId,
  ]
    .concat(
      objectArray(response.order_list).flatMap((order) => [
        order.shop_id,
        order.shopId,
      ]),
    )
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (pageShopIds.some((value) => value !== shopId)) {
    throw new Error("SHOPEE_ORDER_CREDENTIAL_LINEAGE_MISMATCH");
  }

  return {
    ...remote,
    data: {
      ...remote.data,
      sellerpilotProviderContext: {
        shopId,
        ...(merchantId ? { merchantId } : {}),
      },
    },
  };
}

export async function executeShopee(input: ExecuteInput) {
  if (input.channel !== "shopee")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:shopee");
  if (input.operation === "shipment.confirm") {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/api/v2/logistics/ship_order",
      body: objectValue(input.arguments, "body"),
    });
    return result(input, [step("shipment.confirm", remote)]);
  }
  if (input.operation === "orders.list") {
    const baseQuery = queryParams(input.arguments);
    const steps: ChannelOperationStep[] = [];
    let cursor = baseQuery.get("cursor")?.trim() ?? "";
    for (
      let pageIndex = 0;
      pageIndex < MAX_PROVIDER_SYNC_PAGES;
      pageIndex += 1
    ) {
      const query = new URLSearchParams(baseQuery);
      if (cursor) query.set("cursor", cursor);
      else query.delete("cursor");
      const remote = shopeeOrderPageWithCredentialIdentity(
        await shopeeRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/order/get_order_list",
          query,
        }),
        input.payload,
      );
      const pageStep = step(
        pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`,
        remote,
      );
      steps.push(pageStep);
      if (!pageStep.ok) break;
      const responseData = nestedObject(remote.data.response);
      const pageOrders = objectArray(responseData.order_list);
      const nextCursor = String(responseData.next_cursor ?? "").trim();
      if (
        !providerBoolean(responseData.more) ||
        pageOrders.length === 0 ||
        !nextCursor ||
        nextCursor === cursor
      )
        break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: { ...stringMap(input.arguments, "query"), cursor: nextCursor },
        });
      }
      cursor = nextCursor;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const query = queryParams(input.arguments);
    if (!query.has("order_sn_list"))
      query.set("order_sn_list", stringArgument(input.arguments, "orderSn"));
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/order/get_order_detail",
      query,
    });
    return result(
      input,
      [step("order", remote)],
      stringArgument(input.arguments, "orderSn", false) || undefined,
    );
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
