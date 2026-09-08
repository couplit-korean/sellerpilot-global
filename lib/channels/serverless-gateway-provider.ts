import { executeShippingProviderJob, serverlessShippingMatrix } from "../shipping/provider";
import { isShippingOperation, type ShippingOperationResult } from "../shipping/contracts";
// Compatibility composition root: each business domain owns its provider executor.
import { executeServerlessGatewayProviderJob as executeCommerce, serverlessGatewayOperationAllowed as commerceAllowed } from "./commerce-provider";
import { executeCsProviderJob, serverlessCsMatrix } from "../cs/operations/provider";
import { isCsOperation } from "../cs/operations/contracts";
import { executeChannelOperation } from "./operations";
import type { ServerlessGatewayProviderExecutionInput, ServerlessGatewayProviderResult as CommerceResult } from "./commerce-provider";
import type { CsOperationResult } from "../cs/operations/contracts";
import type { GatewayClaim } from "./gateway-contract";
import { SERVERLESS_GATEWAY_WRITE_MATRIX as productWrites, SERVERLESS_GATEWAY_READ_MATRIX as productReads } from "./commerce-provider";
export const SERVERLESS_GATEWAY_ORDER_CHANNELS = serverlessShippingMatrix["orders.list"];
export const SERVERLESS_GATEWAY_WRITE_MATRIX = { ...productWrites, "shipment.acknowledge": serverlessShippingMatrix["shipment.acknowledge"], "shipment.confirm": serverlessShippingMatrix["shipment.confirm"] };
export const SERVERLESS_GATEWAY_READ_MATRIX = { ...productReads, "orders.get": serverlessShippingMatrix["orders.get"] };
export type { ServerlessGatewayExecutionHooks, ServerlessGatewayProviderExecutionInput } from "./commerce-provider";
export const SERVERLESS_GATEWAY_CS_MATRIX = serverlessCsMatrix;
export type ServerlessGatewayProviderResult = CommerceResult | CsOperationResult | ShippingOperationResult;
export function serverlessGatewayOperationAllowed(channel: GatewayClaim["channel"], operation: GatewayClaim["operation"]) {
  return isCsOperation(operation) ? (serverlessCsMatrix[operation] as ReadonlySet<string>).has(channel) : isShippingOperation(operation) ? (serverlessShippingMatrix[operation] as ReadonlySet<string>).has(channel) : commerceAllowed(channel, operation);
}
export async function executeServerlessGatewayProviderJob(input: ServerlessGatewayProviderExecutionInput, executor: typeof executeChannelOperation = executeChannelOperation): Promise<ServerlessGatewayProviderResult> {
  return isCsOperation(input.job.operation) ? executeCsProviderJob(input, executor) : isShippingOperation(input.job.operation) ? executeShippingProviderJob(input, executor) : executeCommerce(input, executor);
}
