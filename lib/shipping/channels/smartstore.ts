import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { MAX_PROVIDER_SYNC_PAGES } from "../../channels/operation-pagination";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  nestedObject,
  stringMap,
  queryParams,
} from "../../channels/operation-values";
import {
  fetchNaverAccessToken,
  naverRequest,
  readStoredNaverAccessToken,
  textValue,
} from "../../channels/protocols";
import { paginationResult, result } from "../execution-shared";

export async function executeSmartstore(input: ExecuteInput) {
  if (input.channel !== "smartstore")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:smartstore");
  const storedAccessToken = readStoredNaverAccessToken(input.payload);
  let token = storedAccessToken
    ? { accessToken: storedAccessToken }
    : await fetchNaverAccessToken(input.payload);
  const request = async (
    requestInput: Omit<Parameters<typeof naverRequest>[0], "accessToken">,
  ) => {
    let remote = await naverRequest({
      ...requestInput,
      accessToken: token.accessToken,
    });
    if (
      remote.response.status === 401 &&
      textValue(remote.data, "code") === "GW.AUTHN"
    ) {
      token = await fetchNaverAccessToken(input.payload);
      remote = await naverRequest({
        ...requestInput,
        accessToken: token.accessToken,
      });
    }
    return remote;
  };
  if (input.operation === "orders.list") {
    const baseQuery = queryParams(input.arguments);
    const steps: ChannelOperationStep[] = [];
    let moreFrom = baseQuery.get("lastChangedFrom")?.trim() ?? "";
    let moreSequence = baseQuery.get("moreSequence")?.trim() ?? "";
    for (
      let pageIndex = 0;
      pageIndex < MAX_PROVIDER_SYNC_PAGES;
      pageIndex += 1
    ) {
      const query = new URLSearchParams(baseQuery);
      if (moreFrom) query.set("lastChangedFrom", moreFrom);
      if (moreSequence) query.set("moreSequence", moreSequence);
      const remote = await request({
        method: "GET",
        path: "/v1/pay-order/seller/product-orders/last-changed-statuses",
        query,
      });
      const orderStep = step(
        pageIndex === 0 ? "orders" : `orders:${pageIndex + 1}`,
        remote,
      );
      steps.push(orderStep);
      if (!orderStep.ok) break;
      const root = Object.keys(nestedObject(remote.data.data)).length
        ? nestedObject(remote.data.data)
        : remote.data;
      const more = nestedObject(root.more);
      const nextFrom = String(more.moreFrom ?? root.moreFrom ?? "").trim();
      const nextSequence = String(
        more.moreSequence ?? root.moreSequence ?? "",
      ).trim();
      if (
        !nextFrom ||
        !nextSequence ||
        (nextFrom === moreFrom && nextSequence === moreSequence)
      )
        break;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return paginationResult(input, steps, {
          ...input.arguments,
          query: {
            ...stringMap(input.arguments, "query"),
            lastChangedFrom: nextFrom,
            moreSequence: nextSequence,
          },
        });
      }
      moreFrom = nextFrom;
      moreSequence = nextSequence;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const productOrderId = stringArgument(input.arguments, "productOrderId");
    const remote = await request({
      method: "POST",
      path: "/v1/pay-order/seller/product-orders/query",
      body: {
        productOrderIds: [productOrderId],
        quantityClaimCompatibility: true,
      },
    });
    return result(input, [step("order", remote)], productOrderId);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await request({
      method: "POST",
      path: "/v1/pay-order/seller/product-orders/confirm",
      body: objectValue(input.arguments, "body"),
    });
    return result(input, [step("confirm", remote)]);
  }
  const remote = await request({
    method: "POST",
    path: "/v1/pay-order/seller/product-orders/dispatch",
    body: objectValue(input.arguments, "body"),
  });
  return result(input, [step("dispatch", remote)]);
}
