import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { MAX_PROVIDER_SYNC_PAGES } from "../../channels/operation-pagination";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  nestedObject,
  stringMap,
  queryParams,
  pathSegment,
} from "../../channels/operation-values";
import { coupangRequest, textValue } from "../../channels/protocols";
import { paginationResult, result } from "../execution-shared";

export async function executeCoupang(input: ExecuteInput) {
  if (input.channel !== "coupang")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:coupang");
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  const orderBase = `/v2/providers/openapi/apis/api/v5/vendors/${pathSegment(vendorId)}`;
  if (input.operation === "orders.list") {
    const kind = stringArgument(input.arguments, "kind", false);
    const path =
      kind === "cancellations"
        ? `/v2/providers/openapi/apis/api/v6/vendors/${pathSegment(vendorId)}/returnRequests`
        : `${orderBase}/ordersheets`;
    const baseQuery = queryParams(input.arguments);
    const steps: ChannelOperationStep[] = [];
    let nextToken = baseQuery.get("nextToken")?.trim() ?? "";
    for (
      let pageIndex = 0;
      pageIndex < MAX_PROVIDER_SYNC_PAGES;
      pageIndex += 1
    ) {
      const query = new URLSearchParams(baseQuery);
      if (nextToken) query.set("nextToken", nextToken);
      else query.delete("nextToken");
      const remote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path,
        query,
      });
      const orderStep = step(
        pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`,
        remote,
      );
      steps.push(orderStep);
      if (!orderStep.ok) break;
      const responseData = nestedObject(remote.data.data);
      const candidate = String(
        remote.data.nextToken ?? responseData.nextToken ?? "",
      ).trim();
      if (!candidate || candidate === nextToken) break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: {
            ...stringMap(input.arguments, "query"),
            nextToken: candidate,
          },
        });
      }
      nextToken = candidate;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const shipmentBoxId = pathSegment(
      stringArgument(input.arguments, "shipmentBoxId"),
    );
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${orderBase}/ordersheets/${shipmentBoxId}`,
    });
    return result(input, [step("order", remote)], shipmentBoxId);
  }
  if (input.operation === "shipment.acknowledge") {
    const shipmentBoxIds = input.arguments.shipmentBoxIds;
    if (
      !Array.isArray(shipmentBoxIds) ||
      shipmentBoxIds.length < 1 ||
      shipmentBoxIds.length > 50
    )
      throw new Error("CHANNEL_ARGUMENT_INVALID:shipmentBoxIds");
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
