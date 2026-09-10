import { type ShippingExecuteInput as ExecuteInput } from "../contracts";
import { step } from "../../channels/operation-step";
import { stringArgument } from "../../channels/operation-values";
import { elevenstOrderRequest } from "../../channels/protocols";
import { result } from "../execution-shared";

export async function executeElevenst(input: ExecuteInput) {
  if (input.channel !== "elevenst")
    throw new Error("SHIPPING_CHANNEL_MISMATCH:elevenst");
  if (input.operation === "orders.list") {
    const remote = await elevenstOrderRequest({
      payload: input.payload,
      startTime: stringArgument(input.arguments, "startTime"),
      endTime: stringArgument(input.arguments, "endTime"),
    });
    return result(input, [step("orders", remote)]);
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
