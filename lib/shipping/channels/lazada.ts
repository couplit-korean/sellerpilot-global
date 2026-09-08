import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  finiteCount,
  objectValue,
  stringArgument,
  objectArray,
  boundedPageSize,
  stringMap,
} from "../../channels/operation-values";
import { lazadaRequest, type RemoteResponse } from "../../channels/protocols";
import { providerBoolean, result, paginationResult } from "../execution-shared";

export function lazadaResultData(data: Record<string, unknown>) {
  const providerResult = objectValue(data, "result", false);
  const nestedData = objectValue(providerResult, "data", false);
  return Object.keys(nestedData).length
    ? nestedData
    : objectValue(data, "data", false);
}

export function lazadaFulfillmentStep(
  name: string,
  remote: RemoteResponse,
  verification: string,
) {
  const base = step(name, remote);
  const providerResult = objectValue(remote.data, "result", false);
  const providerErrorCode = String(providerResult.error_code ?? "").trim();
  const packages = objectArray(lazadaResultData(remote.data).packages);
  const packageErrors = packages.filter((item) => {
    const itemErrorCode = String(
      item.item_err_code ?? item.error_code ?? "",
    ).trim();
    return itemErrorCode !== "" && itemErrorCode !== "0";
  });
  const accepted =
    base.ok &&
    (providerResult.success === undefined ||
      providerBoolean(providerResult.success)) &&
    (!providerErrorCode || providerErrorCode === "0") &&
    packageErrors.length === 0;
  return {
    ...base,
    ok: accepted,
    data: {
      ...base.data,
      sellerpilotVerification: accepted
        ? verification
        : "LAZADA_FULFILLMENT_REJECTED",
    },
  };
}

export async function executeLazada(input: ExecuteInput) {
  if (input.channel !== "lazada")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:lazada");
  const query = stringMap(input.arguments, "queryParams");
  if (input.operation === "orders.list") {
    const limit = boundedPageSize(query.limit, 50, 100);
    const offset = Math.max(0, finiteCount(query.offset) ?? 0);
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/orders/get",
      params: { ...query, limit: String(limit), offset: String(offset) },
    });
    const orderStep = step("orders", remote);
    if (!orderStep.ok) return result(input, [orderStep]);
    const responseData = objectValue(remote.data, "data", false);
    const orders = objectArray(responseData.orders);
    const actionableOrders = orders.filter((order) => {
      const statusText = (
        Array.isArray(order.statuses)
          ? order.statuses.join(" ")
          : String(order.status ?? "")
      ).toLocaleLowerCase();
      const terminal =
        /(?:^|[\s_-])(?:cancelled?|refunded?|returned?|shipped|delivered|completed?)(?:$|[\s_-])/i.test(
          statusText,
        );
      return !terminal && stringArgument(order, "order_id", false);
    });
    const detailSteps: ChannelOperationStep[] = [];
    for (let offset = 0; offset < actionableOrders.length; offset += 5) {
      const batch = actionableOrders.slice(offset, offset + 5);
      const remotes = await Promise.all(
        batch.map(async (order) => {
          const orderId = stringArgument(order, "order_id");
          const detail = await lazadaRequest({
            payload: input.payload,
            path: "/order/items/get",
            params: { order_id: orderId },
          });
          return step(`order-items:${orderId}`, detail);
        }),
      );
      detailSteps.push(...remotes);
    }
    const completedSteps = [orderStep, ...detailSteps];
    const total = finiteCount(
      responseData.countTotal ??
        responseData.total_count ??
        responseData.totalCount,
    );
    const nextOffset = offset + orders.length;
    const hasMore =
      orders.length > 0 &&
      (total !== null ? nextOffset < total : orders.length === limit);
    return hasMore
      ? paginationResult(input, completedSteps, {
          ...input.arguments,
          queryParams: {
            ...query,
            limit: String(limit),
            offset: String(nextOffset),
          },
        })
      : result(input, completedSteps);
  }
  if (input.operation === "orders.get") {
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/get",
      params: {
        ...query,
        order_id: stringArgument(input.arguments, "orderId"),
      },
    });
    return result(input, [step("order", remote)]);
  }
  if (input.operation === "shipment.acknowledge") {
    const packRequest = objectValue(input.arguments, "packReq");
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { ...query, packReq: JSON.stringify(packRequest) },
    });
    return result(input, [
      lazadaFulfillmentStep("pack", remote, "LAZADA_PACKAGE_CREATED"),
    ]);
  }
  if (input.operation === "shipment.confirm") {
    const orderId = stringArgument(input.arguments, "orderId");
    const carrierCode = stringArgument(input.arguments, "carrierCode");
    const providerContext = objectValue(input.arguments, "providerContext");
    const contextOrderId = stringArgument(providerContext, "orderId");
    if (contextOrderId !== orderId)
      throw new Error("CHANNEL_ARGUMENT_INVALID:providerContext.orderId");
    const orderItemIds = Array.isArray(providerContext.orderItemIds)
      ? [
          ...new Set(
            providerContext.orderItemIds
              .map((value) => String(value).trim())
              .filter(Boolean),
          ),
        ].slice(0, 100)
      : [];
    if (!orderItemIds.length)
      throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.orderItemIds");
    const deliveryType = stringArgument(providerContext, "deliveryType");
    const providerRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/shipment/providers/get",
      method: "POST",
      params: {
        getShipmentProvidersReq: JSON.stringify({
          orders: [{ order_id: orderId, order_item_ids: orderItemIds }],
        }),
      },
    });
    const providerStep = lazadaFulfillmentStep(
      "shipment-providers",
      providerRemote,
      "LAZADA_SHIPMENT_PROVIDERS_VERIFIED",
    );
    if (!providerStep.ok) return result(input, [providerStep]);
    const providerData = lazadaResultData(providerRemote.data);
    const shipmentProviders = objectArray(providerData.shipment_providers);
    const normalizedCarrierCode = carrierCode.toLowerCase();
    const selectedProvider = shipmentProviders.find((provider) =>
      [provider.provider_code, provider.name].some(
        (value) =>
          String(value ?? "")
            .trim()
            .toLowerCase() === normalizedCarrierCode,
      ),
    );
    if (!selectedProvider)
      throw new Error("CHANNEL_ARGUMENT_INVALID:carrierCode");
    const shipmentProviderCode = stringArgument(
      selectedProvider,
      "provider_code",
    );
    const shippingAllocateType = stringArgument(
      providerData,
      "shipping_allocate_type",
    );
    const packReq = {
      pack_order_list: [{ order_id: orderId, order_item_list: orderItemIds }],
      delivery_type: deliveryType,
      shipment_provider_code: shipmentProviderCode,
      shipping_allocate_type: shippingAllocateType,
    };
    const shipmentHooks = input.providerMutationHooks;
    if (!shipmentHooks)
      throw new Error("LAZADA_SHIPMENT_MUTATION_HOOKS_REQUIRED");
    const authorizeShipmentWrite = async () => {
      await shipmentHooks.assertLeaseHealthy();
      await shipmentHooks.begin();
      await shipmentHooks.assertLeaseHealthy();
    };
    await authorizeShipmentWrite();
    const packRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { packReq: JSON.stringify(packReq) },
    });
    const packPackages = objectArray(
      lazadaResultData(packRemote.data).packages,
    );
    const packageIds = [
      ...new Set(
        packPackages
          .map((item) => stringArgument(item, "package_id", false))
          .filter(Boolean),
      ),
    ];
    const basePackStep = lazadaFulfillmentStep(
      "pack",
      packRemote,
      "LAZADA_PACKAGE_CREATED",
    );
    const packStep: ChannelOperationStep = packageIds.length
      ? basePackStep
      : {
          ...basePackStep,
          ok: false,
          data: {
            ...basePackStep.data,
            sellerpilotVerification: "LAZADA_PACKAGE_ID_MISSING",
          },
        };
    if (!packStep.ok) return result(input, [providerStep, packStep]);
    // Pack and RTS are separate mutations. A pack success never authorizes RTS
    // after cancellation, ownership conflict, context change or a lost lease.
    await authorizeShipmentWrite();
    const readyRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/package/rts",
      method: "POST",
      params: {
        readyToShipReq: JSON.stringify({
          packages: packageIds.map((package_id) => ({ package_id })),
        }),
      },
    });
    const readyStep = lazadaFulfillmentStep(
      "ready-to-ship",
      readyRemote,
      "LAZADA_READY_TO_SHIP_CONFIRMED",
    );
    const trackingNumber = packPackages
      .map((item) => stringArgument(item, "tracking_number", false))
      .find(Boolean);
    return result(
      input,
      [providerStep, packStep, readyStep],
      trackingNumber ?? packageIds[0],
    );
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
