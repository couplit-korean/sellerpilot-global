import { isShippingOperation, type ShippingOperationResult } from "./contracts";
import type { ProviderJob } from "../channels/provider-execution-contract";
import type { CredentialRefreshSnapshot } from "../channels/protocols";
import { normalizeChannelOrders } from "../channels/order-sync";
import {
  callRpc,
  completionContext,
  recordValue,
  type CompletionDependencies,
  type CompletionResult,
} from "../channels/gateway-completion-runtime";
export type ShippingCompletion = (
  | { status: "succeeded"; result: ShippingOperationResult }
  | {
      status: "failed" | "reconciliation_required";
      error: string;
      result?: ShippingOperationResult;
    }
) & { credentialRefresh?: CredentialRefreshSnapshot };
const SANITIZED_ORDER_LIST_MARKER = "normalized_orders_v1";
function sanitizedOrderListResult(
  result: ShippingOperationResult,
  normalizedOrderCount: number,
): ShippingOperationResult {
  const finalProviderStatus = result.steps.at(-1)?.status ?? 200;
  return {
    ok: result.ok,
    channel: result.channel,
    operation: "orders.list",
    steps: [
      {
        name: "orders-normalized",
        ok: result.ok,
        status: finalProviderStatus,
        data: {
          sellerpilotMarker: SANITIZED_ORDER_LIST_MARKER,
          normalizedOrderCount,
          providerStepCount: result.steps.length,
        },
      },
    ],
    ...(result.continuation ? { continuation: result.continuation } : {}),
    safeMessage: "주문 동기화 결과를 정규화해 저장했습니다.",
  };
}

export async function completeShippingClaim(
  dependencies: CompletionDependencies,
  tokenHash: string,
  job: ProviderJob,
  completion: ShippingCompletion,
  externalWorker = false,
): Promise<CompletionResult> {
  if (!isShippingOperation(job.operation)) return "ownership_lost";
  const snapshot = await completionContext(dependencies, tokenHash, job);
  if (snapshot.error) return "unavailable";
  const context = recordValue(snapshot.data);
  if (
    !context ||
    !["running", "completed_replay"].includes(String(context.status)) ||
    context.channel !== job.channel ||
    context.operation !== job.operation
  )
    return "ownership_lost";
  const result = completion.result;
  if (
    result &&
    (result.channel !== job.channel || result.operation !== job.operation)
  )
    return "ownership_lost";
  let response: unknown = result ?? null;
  let orders: ReturnType<typeof normalizeChannelOrders> | null = null;
  if (completion.status === "succeeded" && job.operation === "orders.list") {
    const timestamp =
      typeof context.normalization_timestamp === "string"
        ? new Date(context.normalization_timestamp)
        : null;
    if (!result?.ok || !timestamp || Number.isNaN(timestamp.getTime()))
      return "unavailable";
    orders = normalizeChannelOrders(
      job.channel,
      result,
      timestamp.toISOString(),
    );
    response = sanitizedOrderListResult(result, orders.length);
  }
  const args = {
    p_token_hash: tokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_status: completion.status,
    p_response_payload: response,
    p_error_message:
      completion.status === "succeeded" ? null : completion.error,
    p_credential_refresh: completion.credentialRefresh ?? null,
    p_normalized_orders: orders,
    p_normalized_inquiries: null,
    p_diagnostic: null,
  };
  const rpc = externalWorker
    ? "sellerpilot_service_complete_gateway_transaction"
    : "sellerpilot_service_complete_serverless_cs_transaction";
  let completed = await callRpc(dependencies, rpc, args);
  if (completed.error) completed = await callRpc(dependencies, rpc, args);
  if (completed.error) return "unavailable";
  if (recordValue(completed.data)?.status !== "completed")
    return "ownership_lost";
  return completion.status === "reconciliation_required"
    ? "completed_reconciliation"
    : "completed";
}
