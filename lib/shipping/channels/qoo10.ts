import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { step } from "../../channels/operation-step";
import { stringMap } from "../../channels/operation-values";
import { qoo10Request } from "../../channels/protocols";
import { result } from "../execution-shared";

export async function executeQoo10(input: ExecuteInput) {
  if (input.channel !== "qoo10")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:qoo10");
  const suppliedParams = stringMap(input.arguments, "params");
  if (input.operation === "orders.get") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "GetShippingInfo_v3",
      params: suppliedParams,
    });
    return result(input, [step("shipping-info", remote)]);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "SetSellerCheckYN_V2",
      params: suppliedParams,
    });
    return result(input, [step("seller-check", remote)]);
  }
  const method =
    input.operation === "orders.list" ? "GetShippingInfo_v3" : "SetSendingInfo";
  const remote = await qoo10Request({
    payload: input.payload,
    service: "ShippingBasic",
    method,
    params: suppliedParams,
  });
  return result(input, [step(method, remote)]);
}
