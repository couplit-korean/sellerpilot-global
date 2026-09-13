import { gatewayClaimSchema } from "./gateway-contract";
import {
  deriveServerlessCsGatewayCredentials,
  runClaimedServerlessGatewayJob,
  type ServerlessCsGatewayDependencies,
} from "./serverless-gateway";
import { resolveRuntimeReleaseIdentity } from "../internal-scheduler-auth";

export type FreshEbayOAuthOutcome = {
  status: "completed" | "in_progress" | "reconciliation_required" | "blocked";
  code: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export async function exchangeFreshEbayOAuth(input: {
  actorId: string;
  credentialId: string;
  code: string;
  includeMessages: boolean;
}, dependencies: ServerlessCsGatewayDependencies): Promise<FreshEbayOAuthOutcome> {
  const identity = resolveRuntimeReleaseIdentity({
    sellerpilotReleaseSha: dependencies.releaseId,
    vercelGitCommitSha: dependencies.vercelGitCommitSha,
  });
  if (!dependencies.rpc || !dependencies.cronSecret || identity.status !== "valid") {
    return { status: "blocked", code: "runtime_unavailable" };
  }
  const { gatewayTokenHash } = deriveServerlessCsGatewayCredentials(dependencies.cronSecret);
  const claim = await dependencies.rpc("sellerpilot_service_claim_ebay_fresh_oauth", {
    p_token_hash: gatewayTokenHash, p_release_id: identity.release,
    p_actor_id: input.actorId, p_credential_id: input.credentialId,
    p_code: input.code, p_include_messages: input.includeMessages,
  });
  const value = record(claim.data);
  if (claim.error || !value) return { status: "blocked", code: "claim_unavailable" };
  if (value.status === "already_submitted") {
    // A lost callback response must not execute the single-use grant twice.
    if (value.jobStatus === "succeeded" && value.finalized === true) {
      return { status: "completed", code: "same_seller_authorization_stored" };
    }
    return value.jobStatus === "queued" || value.jobStatus === "running"
      ? { status: "in_progress", code: "already_submitted" }
      : { status: "reconciliation_required", code: "existing_result_requires_readback" };
  }
  const parsed = gatewayClaimSchema.safeParse(value.job);
  if (value.status !== "claimed" || !parsed.success
    || parsed.data.channel !== "ebay" || parsed.data.operation !== "oauth.exchange"
    || parsed.data.credential_id !== input.credentialId
    || parsed.data.request.code !== input.code.trim()
    || parsed.data.request.includeMessages !== input.includeMessages) {
    const safe = new Set(["runtime_unavailable", "source_unavailable", "other_uncertainty_pending"]);
    return { status: "blocked", code: safe.has(String(value.status)) ? String(value.status) : "claim_contract_invalid" };
  }
  const job = parsed.data;
  const execution = await runClaimedServerlessGatewayJob(dependencies, gatewayTokenHash, job);
  const result = record(await execution.json().catch(() => null));
  if (!execution.ok || result?.status !== "succeeded") {
    return { status: "reconciliation_required", code: "exchange_result_requires_readback" };
  }
  const finalized = await dependencies.rpc("sellerpilot_service_finalize_ebay_fresh_oauth", {
    p_token_hash: gatewayTokenHash, p_job_id: job.id, p_claim_token: job.claim_token,
  });
  if (finalized.error || record(finalized.data)?.status !== "finalized") {
    return { status: "reconciliation_required", code: "finalization_requires_readback" };
  }
  return { status: "completed", code: "same_seller_authorization_stored" };
}
