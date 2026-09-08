import { shippingChannelAdapters } from "./channel-adapters";
import {
  isShippingOperation,
  type ShippingOperationResult as ChannelOperationResult,
  type ShippingExecuteInput as ExecuteInput,
} from "./contracts";
import { MAX_PROVIDER_SYNC_CONTINUATIONS } from "../channels/operation-pagination";
import { finiteCount } from "../channels/operation-values";
import {
  ensureProviderSupport,
  paginationSafetyStop,
} from "./execution-shared";

export async function executeShippingOperation(
  input: ExecuteInput,
): Promise<ChannelOperationResult> {
  if (!isShippingOperation(input.operation))
    throw new Error(`SHIPPING_OPERATION_UNSUPPORTED:${input.operation}`);
  ensureProviderSupport(input.channel, input.operation);
  if (
    input.operation === "orders.list" &&
    (finiteCount(input.arguments.sellerpilotPaginationDepth) ?? 0) >=
      MAX_PROVIDER_SYNC_CONTINUATIONS
  )
    return paginationSafetyStop(input);
  return shippingChannelAdapters[input.channel](input);
}

export type { ChannelOperationStep } from "../channels/operation-step";
