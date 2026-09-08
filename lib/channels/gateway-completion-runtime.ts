import type { ProviderJob } from "./provider-execution-contract";
export type CompletionResult = "completed" | "completed_reconciliation" | "ownership_lost" | "unavailable";
export type RpcResult = { data: unknown; error: { code?: string | null } | null };
export type CompletionDependencies = {
 rpc?: (name: string, arguments_?: Record<string, unknown>) => Promise<RpcResult>;
 logError?: (stage: string, details: Record<string, string | number | boolean>) => void;
};
export async function callRpc(
  dependencies: CompletionDependencies,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<RpcResult> {
  if (!dependencies.rpc) return { data: null, error: { code: "server_configuration_missing" } };
  try {
    return await dependencies.rpc(name, arguments_);
  } catch {
    return { data: null, error: { code: "transport_error" } };
  }
}

export async function completionContext(
  dependencies: CompletionDependencies,
  gatewayTokenHash: string,
  job: ProviderJob,
) {
  const arguments_ = {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  };
  let result = await callRpc(dependencies, "sellerpilot_service_serverless_cs_completion_context", arguments_);
  if (result.error) {
    result = await callRpc(dependencies, "sellerpilot_service_serverless_cs_completion_context", arguments_);
  }
  return result;
}

export function recordValue(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function safeRpcCode(error: RpcResult["error"]) { return typeof error?.code === "string" ? error.code : "unknown"; }
