import type { CsRetryContinuation } from "../../../cs/operations/contracts";
import { isCoupangProductReplyReadbackRetry } from "./product-reply-readback";

type RpcResult = { data: unknown; error: { code?: string | null } | null };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function requireCoupangProductReplyReadbackRetryReceipt(
  rpc: RpcResult,
  expected: CsRetryContinuation,
) {
  if (["42883", "PGRST202"].includes(String(rpc.error?.code ?? ""))) {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_RETRY_SCHEMA_NOT_READY");
  }
  if (rpc.error) throw new Error("COUPANG_PRODUCT_REPLY_READBACK_RETRY_RECORDING_FAILED");
  const receipt = record(rpc.data);
  if (!isCoupangProductReplyReadbackRetry(expected)
      || receipt?.contract !== "sellerpilot-coupang-product-reply-readback-retry/1"
      || receipt.status !== "deferred"
      || receipt.retryCount !== expected.retryCount
      || receipt.retryAfterSeconds !== expected.retryAfterSeconds
      || receipt.failureCode !== "COUPANG_PRODUCT_REPLY_READBACK_PENDING"
      || typeof receipt.replayed !== "boolean") {
    throw new Error("COUPANG_PRODUCT_REPLY_READBACK_RETRY_RECEIPT_INVALID");
  }
  return receipt as Record<string, unknown> & { replayed: boolean };
}

export async function recordCoupangProductReplyReadbackRetryWithReplay(
  call: () => Promise<RpcResult>,
  expected: CsRetryContinuation,
) {
  let rpc = await call();
  if (rpc.error?.code === "transport_error") rpc = await call();
  return requireCoupangProductReplyReadbackRetryReceipt(rpc, expected);
}
