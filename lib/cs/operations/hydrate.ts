import { gatewayClaimSchema, gatewayCsCredentialBindingContextSchema, type GatewayClaim } from "../../channels/gateway-contract";
import { temuBuyerChatRuntimeEvidenceSchema } from "../../channels/cs/temu/runtime-readiness";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

// The same authenticated DB evidence must reach both the Mac and Vercel
// executors before provider access; browser/credential payload flags cannot grant it.
export async function hydrateCsProviderJob(job: GatewayClaim, tokenHash: string, rpc: Rpc): Promise<GatewayClaim> {
  if (job.channel !== "temu" || job.operation !== "inquiries.list") return job;
  const args = { p_token_hash: tokenHash, p_job_id: job.id, p_claim_token: job.claim_token };
  const context = await rpc("sellerpilot_service_serverless_cs_completion_context", args);
  const value = context.data as Record<string, unknown> | null;
  if (context.error || !value || value.id !== job.id || value.credential_id !== job.credential_id
    || value.channel !== job.channel || value.operation !== job.operation || value.status !== "running") {
    throw new Error("TEMU_CS_EXECUTION_CONTEXT_UNVERIFIED");
  }
  const binding = gatewayCsCredentialBindingContextSchema.safeParse(value.credential_binding_context);
  if (!binding.success || binding.data.status !== "verified" || binding.data.credentialId !== job.credential_id) {
    throw new Error("TEMU_CS_EXECUTION_BINDING_UNVERIFIED");
  }
  const hydrated = { ...job, credential_binding_context: binding.data, temu_buyer_chat_readiness_context: undefined };
  const argumentsValue = job.request.arguments as Record<string, unknown> | undefined;
  if (argumentsValue?.kind === "buyer_chat") {
    const evidence = await rpc("sellerpilot_service_get_temu_buyer_chat_readiness_v1", args);
    if (evidence.error) throw new Error("TEMU_BUYER_CHAT_EVIDENCE_READ_UNAVAILABLE");
    const parsed = temuBuyerChatRuntimeEvidenceSchema.nullable().safeParse(evidence.data);
    if (!parsed.success) throw new Error("TEMU_BUYER_CHAT_EVIDENCE_INVALID");
    return gatewayClaimSchema.parse({ ...hydrated, temu_buyer_chat_readiness_context: parsed.data });
  }
  return gatewayClaimSchema.parse(hydrated);
}
