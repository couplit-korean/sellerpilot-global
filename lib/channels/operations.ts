import { isShippingOperation } from "../shipping/contracts";
import { executeShippingOperation } from "../shipping/execute";
// Compatibility dispatcher for the existing mixed gateway. Business code lives in separate executors.
import { executeChannelOperation as executeCommerceOperation, type ExecuteInput as CommerceInput, type ChannelOperationResult as CommerceResult } from "./commerce-operations";
import { executeCsOperation } from "../cs/operations/execute";
import { isCsOperation, type CsRetryContinuation } from "../cs/operations/contracts";
import type { ChannelOperationName } from "./operation-names";
export { channelOperationNames, channelOperationCapabilities, writeChannelOperations } from "./operation-names";
export type { ChannelOperationName } from "./operation-names";
export type { ChannelOperationStep } from "./operation-step";
export type ChannelOperationResult = Omit<CommerceResult, "operation"> & { operation: ChannelOperationName; retryContinuation?: CsRetryContinuation };
type ExecuteInput = Omit<CommerceInput, "operation"> & { operation: ChannelOperationName };
export async function executeChannelOperation(input: ExecuteInput): Promise<ChannelOperationResult> {
  if (isCsOperation(input.operation)) return executeCsOperation({ ...input, operation: input.operation });
  if (isShippingOperation(input.operation)) return executeShippingOperation({ ...input, operation: input.operation });
  return executeCommerceOperation({ ...input, operation: input.operation });
}
