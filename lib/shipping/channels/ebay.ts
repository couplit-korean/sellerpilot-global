import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { MAX_PROVIDER_SYNC_PAGES } from "../../channels/operation-pagination";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  finiteCount,
  objectValue,
  stringArgument,
  objectArray,
  boundedPageSize,
  stringMap,
  queryParams,
  pathSegment,
} from "../../channels/operation-values";
import { ebayRequest, type RemoteResponse } from "../../channels/protocols";
import {
  ebayOrderMatchesShipment,
  ebayOrderPaymentAllowsShipment,
  ebayOrderReadyForShipment,
  ebayShipmentBody,
  ebayShipmentReadback,
} from "../../channels/ebay-shipment";
import { result, paginationResult } from "../execution-shared";

export async function executeEbayShipment(input: ExecuteInput) {
  const orderId = stringArgument(input.arguments, "orderId");
  const body = ebayShipmentBody(objectValue(input.arguments, "body"));
  const orderPath = `/sell/fulfillment/v1/order/${pathSegment(orderId)}`;
  const shipmentPath = `${orderPath}/shipping_fulfillment`;
  const steps: ChannelOperationStep[] = [];
  const failureStep = (
    name: string,
    code: string,
    status: number,
    reconciliationRequired = false,
  ): ChannelOperationStep => ({
    name,
    ok: false,
    status,
    data: {
      code,
      ...(reconciliationRequired
        ? { sellerpilotReconciliationRequired: true }
        : {}),
    },
  });
  const read = (path: string) =>
    ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path,
    });
  const noProviderErrors = (remote: RemoteResponse) =>
    !Object.hasOwn(remote.data, "errors") ||
    (Array.isArray(remote.data.errors) && remote.data.errors.length === 0);

  let orderRemote: RemoteResponse;
  try {
    orderRemote = await read(orderPath);
  } catch {
    return result(
      input,
      [
        failureStep(
          "shipment-order-preflight",
          "EBAY_SHIPMENT_ORDER_UNAVAILABLE",
          503,
        ),
      ],
      orderId,
    );
  }
  const orderStep = step("shipment-order-preflight", orderRemote);
  orderStep.ok =
    orderStep.ok &&
    noProviderErrors(orderRemote) &&
    ebayOrderMatchesShipment(orderRemote.data, orderId, body);
  // The fulfillment gateway only needs verified identifiers, never customer
  // addresses or buyer details from this order response.
  orderStep.data = {
    code: orderStep.ok
      ? "EBAY_SHIPMENT_ORDER_VERIFIED"
      : "EBAY_SHIPMENT_ORDER_MISMATCH",
  };
  steps.push(orderStep);
  if (!orderStep.ok) return result(input, steps, orderId);
  if (!ebayOrderPaymentAllowsShipment(orderRemote.data)) {
    return result(
      input,
      [
        ...steps,
        failureStep(
          "shipment-order-status",
          "EBAY_SHIPMENT_ORDER_NOT_READY",
          409,
        ),
      ],
      orderId,
    );
  }

  let existingRemote: RemoteResponse;
  try {
    existingRemote = await read(shipmentPath);
  } catch {
    return result(
      input,
      [
        ...steps,
        failureStep(
          "shipment-existing-readback",
          "EBAY_SHIPMENT_EXISTING_UNAVAILABLE",
          503,
        ),
      ],
      orderId,
    );
  }
  const existing = ebayShipmentReadback(existingRemote.data, body);
  const existingStep = step("shipment-existing-readback", existingRemote);
  existingStep.ok =
    existingStep.ok && noProviderErrors(existingRemote) && existing.valid;
  existingStep.data = {
    code: existingStep.ok
      ? "EBAY_SHIPMENT_EXISTING_VERIFIED"
      : "EBAY_SHIPMENT_EXISTING_INVALID",
  };
  steps.push(existingStep);
  if (!existingStep.ok) return result(input, steps, orderId);
  if (!existing.empty) {
    existingStep.ok = existing.verified;
    existingStep.data = existing.verified
      ? {
          code: "EBAY_SHIPMENT_ALREADY_VERIFIED",
          fulfillmentId: existing.fulfillmentId,
        }
      : {
          code: "EBAY_SHIPMENT_EXISTING_CONFLICT",
          sellerpilotReconciliationRequired: true,
        };
    return result(input, steps, orderId);
  }
  if (!ebayOrderReadyForShipment(orderRemote.data)) {
    return result(
      input,
      [
        ...steps,
        failureStep(
          "shipment-order-status",
          "EBAY_SHIPMENT_ORDER_NOT_READY",
          409,
        ),
      ],
      orderId,
    );
  }

  // At most four 15-second calls fit inside the fulfillment route's 70-second
  // operation window. Never retry POST. A lost response keeps a mutation step
  // so gateway completion requires reconciliation if the one GET cannot prove it.
  let writeStep: ChannelOperationStep;
  try {
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: shipmentPath,
      body,
    });
    writeStep = step("shipping-fulfillment", remote);
    writeStep.ok =
      writeStep.ok &&
      remote.response.status === 201 &&
      noProviderErrors(remote);
    if (
      !writeStep.ok &&
      remote.response.status !== 408 &&
      remote.response.status < 500 &&
      !remote.response.ok
    ) {
      return result(input, [...steps, writeStep], orderId);
    }
    if (!writeStep.ok)
      writeStep.data = {
        ...writeStep.data,
        sellerpilotReconciliationRequired: true,
      };
  } catch {
    writeStep = failureStep(
      "shipping-fulfillment",
      "EBAY_SHIPMENT_WRITE_UNCERTAIN",
      503,
      true,
    );
  }
  steps.push(writeStep);

  let readbackRemote: RemoteResponse;
  try {
    readbackRemote = await read(shipmentPath);
  } catch {
    return result(
      input,
      [
        ...steps,
        failureStep(
          "shipment-readback",
          "EBAY_SHIPMENT_READBACK_UNAVAILABLE",
          503,
          true,
        ),
      ],
      orderId,
    );
  }
  const readback = ebayShipmentReadback(readbackRemote.data, body);
  const readbackStep = step("shipment-readback", readbackRemote);
  readbackStep.ok =
    readbackStep.ok && noProviderErrors(readbackRemote) && readback.verified;
  readbackStep.data = readbackStep.ok
    ? {
        code: "EBAY_SHIPMENT_READBACK_VERIFIED",
        fulfillmentId: readback.fulfillmentId,
      }
    : {
        code: "EBAY_SHIPMENT_READBACK_MISMATCH",
        sellerpilotReconciliationRequired: true,
      };
  if (readbackStep.ok && !writeStep.ok) {
    // Exact remote recovery also resolves a lost POST response; it does not
    // issue another mutation or infer success merely from HTTP acceptance.
    writeStep.ok = true;
    writeStep.data = {
      code: "EBAY_SHIPMENT_WRITE_RECOVERED",
      sellerpilotMutation: "accepted",
    };
  }
  return result(input, [...steps, readbackStep], orderId);
}

export async function executeEbay(input: ExecuteInput) {
  if (input.channel !== "ebay")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:ebay");
  if (input.operation === "orders.list") {
    const baseQuery = queryParams(input.arguments);
    const limit = boundedPageSize(baseQuery.get("limit"), 50, 200);
    let offset = Math.max(0, finiteCount(baseQuery.get("offset")) ?? 0);
    const steps: ChannelOperationStep[] = [];
    for (
      let pageIndex = 0;
      pageIndex < MAX_PROVIDER_SYNC_PAGES;
      pageIndex += 1
    ) {
      const query = new URLSearchParams(baseQuery);
      query.set("limit", String(limit));
      query.set("offset", String(offset));
      const remote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/sell/fulfillment/v1/order",
        query,
      });
      const orderStep = step(
        pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`,
        remote,
      );
      steps.push(orderStep);
      if (!orderStep.ok) break;
      const pageOrders = objectArray(remote.data.orders);
      const total = finiteCount(remote.data.total);
      const nextUrl =
        typeof remote.data.next === "string" ? remote.data.next : "";
      if (
        pageOrders.length === 0 ||
        pageOrders.length < limit ||
        (total !== null && offset + pageOrders.length >= total)
      )
        break;
      let nextOffset = offset + pageOrders.length;
      if (nextUrl) {
        try {
          nextOffset =
            finiteCount(new URL(nextUrl).searchParams.get("offset")) ??
            nextOffset;
        } catch {
          // Provider links are advisory; the documented numeric offset remains authoritative.
        }
      }
      if (nextOffset <= offset) break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: {
            ...stringMap(input.arguments, "query"),
            limit,
            offset: nextOffset,
          },
        });
      }
      offset = nextOffset;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const orderId = pathSegment(stringArgument(input.arguments, "orderId"));
    const remote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/fulfillment/v1/order/${orderId}`,
    });
    return result(input, [step("order", remote)], orderId);
  }
  if (input.operation === "shipment.confirm") return executeEbayShipment(input);
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
