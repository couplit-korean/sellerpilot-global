import type { TemuInquiryRetryContinuation } from "../../temu-inquiries";

type RetryRpcError = { code?: string | null } | null;
type RetryRpcResult = { data: unknown; error: RetryRpcError };

const SCHEMA_NOT_READY_CODES = new Set(["42883", "PGRST202"]);
const RESPONSE_UNCERTAIN_CODES = new Set(["transport_error"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Verifies the atomic DB receipt. A missing RPC is a release blocker, never a
 * reason to reinterpret the failed provider read as pagination success.
 */
export function requireTemuDetailRetryReceipt(
  rpc: RetryRpcResult,
  expected: TemuInquiryRetryContinuation,
) {
  const errorCode = typeof rpc.error?.code === "string" ? rpc.error.code : "";
  if (SCHEMA_NOT_READY_CODES.has(errorCode)) {
    throw new Error("TEMU_AFTER_SALES_DETAIL_RETRY_SCHEMA_NOT_READY");
  }
  if (rpc.error) throw new Error("TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED");
  const receipt = record(rpc.data);
  if (receipt?.contract !== "temu-after-sales-detail-retry-v2"
      || receipt.status !== "deferred"
      || receipt.retryCount !== expected.retryCount
      || receipt.retryAfterSeconds !== expected.retryAfterSeconds
      || receipt.deferredCount !== expected.deferredCount
      || receipt.replayCount !== expected.replayCount
      || receipt.failureCode !== "TEMU_AFTER_SALES_DETAIL_READ_FAILED"
      || typeof receipt.replayed !== "boolean") {
    throw new Error("TEMU_AFTER_SALES_DETAIL_RETRY_RECEIPT_INVALID");
  }
  return receipt as {
    contract: "temu-after-sales-detail-retry-v2";
    status: "deferred";
    retryCount: number;
    retryAfterSeconds: number;
    deferredCount: number;
    replayCount: number;
    failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED";
    replayed: boolean;
  };
}

/**
 * Replays the exact atomic RPC once only when its response is uncertain. The
 * database contract makes the second call read-only if the first one committed.
 */
export async function recordTemuDetailRetryWithReplay(
  call: () => Promise<RetryRpcResult>,
  expected: TemuInquiryRetryContinuation,
) {
  let rpc = await call();
  const errorCode = typeof rpc.error?.code === "string" ? rpc.error.code : "";
  if (RESPONSE_UNCERTAIN_CODES.has(errorCode)) rpc = await call();
  return requireTemuDetailRetryReceipt(rpc, expected);
}
