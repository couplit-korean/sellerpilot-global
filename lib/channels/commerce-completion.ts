import { gatewayWorkerCompletionSchema, gatewayJobCompletionStatusAtJobBoundary, gatewayResultRequiresAdditionalEvidence, type GatewayWorkerCompletion } from "./gateway-contract";
import type { ProviderJob as ServerlessGatewayClaim } from "./provider-execution-contract";
import { callRpc, completionContext, recordValue, type CompletionDependencies as ServerlessCsGatewayDependencies, type CompletionResult } from "./gateway-completion-runtime";
import {
  gateLazadaGatewayCreateCompletion,
  lazadaGatewayCreateArgumentsFromJobRequest,
} from "../product-registration/lazada/my-create-gateway-receipt";
const COMPLETE_TRANSACTION_RPC = "sellerpilot_service_complete_serverless_cs_transaction";
const COMPLETE_LISTING_LINEAGE_RPC = "sellerpilot_complete_listing_lineage_verification";
const COMPLETE_COUPANG_CREATE_RECONCILIATION_RPC = "sellerpilot_complete_coupang_create_reconciliation";
type SuccessfulGatewayResult = Extract<GatewayWorkerCompletion, { status: "succeeded" }>["result"];
type ListingLineageResult = Extract<SuccessfulGatewayResult, { operation: "listing.lineage.verify" }>;

function elevenstFreshCreateBlockedByExistingSellerPrdCd(
  operation: string,
  steps: ReadonlyArray<{
    name: string;
    ok: boolean;
    status?: number;
    data?: Record<string, unknown>;
  }> = [],
) {
  if (operation !== "listing.create") return false;
  return steps.some((step) =>
    step.name === "product-create-duplicate-detected"
    && step.status === 409
    && step.data?.sellerpilotDuplicateExistingProduct === true
    && step.data?.sellerpilotFreshCreateCompleted === false
    && step.data?.sellerpilotProviderMutationPerformed === false);
}

function listingLineageFailureReason(message: string) {
  if (message.includes("PROVIDER_ACCOUNT_IDENTITY_MISSING")) return "legacy_main_reconnect_required";
  if (/PROVIDER_ACCOUNT_IDENTITY_MISMATCH|ACCOUNT_IDENTITY_VERIFICATION_FAILED/.test(message)) {
    return "provider_identity_mismatch";
  }
  if (/SHOP_NOT_AUTHORIZED|TARGET_MISMATCH/.test(message)) return "target_mismatch";
  if (message.includes("MARKET_MISMATCH")) return "market_mismatch";
  if (message.includes("MARKETPLACE_SKU_MISSING")) return "marketplace_sku_missing";
  if (message.includes("PROVIDER_RESOURCE_MISSING")) return "provider_resource_missing";
  if (message.includes("OFFER_AMBIGUOUS")) return "provider_resource_ambiguous";
  if (message.includes("REMOTE_ID_MISMATCH")) return "remote_id_mismatch";
  if (/NOT_FOUND|404/.test(message)) return "provider_not_found";
  return "provider_readback_rejected";
}

function listingLineageFailurePayload(channel: string, reason: string) {
  return {
    ok: false,
    channel,
    operation: "listing.lineage.verify",
    evidenceVersion: "provider_listing_readback_v1",
    reason,
  };
}

function listingLineageSuccessPayload(result: ListingLineageResult) {
  const evidence = result.evidence;
  if (!("expectedRemoteId" in evidence)
      || !("verifiedRemoteId" in evidence)
      || !("market" in evidence)
      || !("targetId" in evidence)) {
    return null;
  }
  const coupangEvidence = result.channel === "coupang"
    && "reconciliationContract" in evidence
    && evidence.reconciliationContract === "coupang_durable_create_reconciliation_v1"
    ? {
      reconciliationContract: evidence.reconciliationContract,
      sourceJobId: evidence.sourceJobId,
      sourceAttemptId: evidence.sourceAttemptId,
      listingId: evidence.listingId,
      sourceRequestSha256: evidence.sourceRequestSha256,
      sellerSkus: evidence.sellerSkus,
      vendorId: evidence.vendorId,
      sellerProductItemIds: evidence.sellerProductItemIds,
      ...(result.publicationStateContract
        && result.publicationIntent
        && result.publicationFulfilled !== undefined
        && result.remoteState
        ? {
          publicationStateContract: result.publicationStateContract,
          publicationIntent: result.publicationIntent,
          publicationFulfilled: result.publicationFulfilled,
          remoteState: result.remoteState,
        }
        : {}),
    }
    : {};
  return {
    ok: true,
    channel: result.channel,
    operation: result.operation,
    evidenceVersion: "provider_listing_readback_v1",
    expectedRemoteId: evidence.expectedRemoteId,
    verifiedRemoteId: evidence.verifiedRemoteId,
    market: evidence.market,
    targetId: evidence.targetId,
    verification: "exact_provider_readback",
    ...coupangEvidence,
    ...("marketplaceSku" in evidence
      && "providerResourceId" in evidence
      && evidence.marketplaceSku
      && evidence.providerResourceId
      ? {
        marketplaceSku: evidence.marketplaceSku,
        providerResourceId: evidence.providerResourceId,
      }
      : {}),
    ...(result.channel === "shopee" && "shopeeAdoption" in evidence
        && evidence.shopeeAdoption
      ? { shopeeAdoption: evidence.shopeeAdoption }
      : {}),
  };
}

async function completeListingLineageClaim(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
  completion: GatewayWorkerCompletion,
): Promise<CompletionResult> {
  let status: "succeeded" | "failed" | "retryable";
  let responsePayload: Record<string, unknown> | null;
  let errorMessage: string | null = null;
  if (completion.status === "succeeded") {
    if (completion.result.operation !== "listing.lineage.verify"
        || completion.result.channel !== job.channel) {
      return "ownership_lost";
    }
    const result = completion.result;
    if (result.channel === "smartstore") {
      return "ownership_lost";
    }
    if (result.verificationStatus === "verified") {
      status = "succeeded";
      const successPayload = listingLineageSuccessPayload(result);
      if (!successPayload) return "ownership_lost";
      responsePayload = successPayload;
    } else {
      const reason = result.evidence.reasonCode === "EBAY_MARKETPLACE_SKU_MISSING"
        ? "marketplace_sku_missing"
        : "provider_resource_ambiguous";
      status = "failed";
      responsePayload = listingLineageFailurePayload(job.channel, reason);
      errorMessage = reason;
    }
  } else if (completion.status === "reconciliation_required") {
    status = "retryable";
    responsePayload = null;
    errorMessage = "provider_readback_retryable";
  } else {
    const reason = listingLineageFailureReason(completion.error);
    status = "failed";
    responsePayload = listingLineageFailurePayload(job.channel, reason);
    errorMessage = reason;
  }

  const arguments_ = {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_status: status,
    p_response_payload: responsePayload,
    p_error_message: errorMessage,
  };
  const completionRpc = job.channel === "coupang"
    ? COMPLETE_COUPANG_CREATE_RECONCILIATION_RPC
    : COMPLETE_LISTING_LINEAGE_RPC;
  let completed = await callRpc(dependencies, completionRpc, arguments_);
  if (completed.error) {
    completed = await callRpc(dependencies, completionRpc, arguments_);
  }
  if (completed.error) return "unavailable";
  const result = recordValue(completed.data);
  if (result?.job_id !== job.id) return "ownership_lost";
  if (result.status === "lease_lost") return "ownership_lost";
  return ["bound", "verified", "queued", "manual_required"].includes(String(result.status))
    ? "completed"
    : "unavailable";
}

export async function completeCommerceClaim(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
  completionInput: GatewayWorkerCompletion,
): Promise<CompletionResult> {
  if (/^(orders|shipment)\./.test(job.operation) || job.operation === "inquiries.list" || job.operation === "inquiries.reply") return "ownership_lost";
  if (job.channel === "shopee" && job.operation === "listing.create") {
    const rawCompletion = recordValue(completionInput);
    if (rawCompletion?.status === "succeeded") {
      const map = recordValue(recordValue(rawCompletion.result)?.shopeeSgCreateCompletionMap);
      if (map?.sameTransactionAsLocalPublish !== true
          || !String(map.globalItemId ?? "").trim()
          || !String(map.localItemId ?? "").trim()) {
        return "unavailable";
      }
      return "completed";
    }
  }
  const parsed = gatewayWorkerCompletionSchema.safeParse(completionInput);
  if (!parsed.success) return "unavailable";

  const snapshot = await completionContext(dependencies, gatewayTokenHash, job);
  if (snapshot.error) return "unavailable";
  const context = recordValue(snapshot.data);
  if (!context
      || (context.status !== "running" && context.status !== "completed_replay")
      || context.channel !== job.channel
      || context.operation !== job.operation) {
    return "ownership_lost";
  }

  const completionProviderResult = parsed.data.status === "succeeded"
    ? parsed.data.result
    : parsed.data.status === "reconciliation_required"
      ? parsed.data.result
      : parsed.data.result;
  if (completionProviderResult
      && (completionProviderResult.channel !== job.channel
        || completionProviderResult.operation !== job.operation)) {
    return "ownership_lost";
  }
  const completionSteps = completionProviderResult && "steps" in completionProviderResult
    && Array.isArray(completionProviderResult.steps)
    ? completionProviderResult.steps as Array<{
      name: string;
      ok: boolean;
      status?: number;
      data?: Record<string, unknown>;
    }>
    : [];
  let effectiveCompletionStatus = gatewayJobCompletionStatusAtJobBoundary(parsed.data.status,
    completionProviderResult as unknown as Record<string, unknown> | undefined, context.publication_verification_boundary);
  let effectiveCompletionError = effectiveCompletionStatus === "reconciliation_required" && parsed.data.status === "succeeded"
    ? (gatewayResultRequiresAdditionalEvidence("steps" in parsed.data.result ? parsed.data.result.steps : [])
      ? "LISTING_ADDITIONAL_EVIDENCE_REQUIRED"
      : "LISTING_REMOTE_STATE_PROVIDER_MUTATION_BOUNDARY_MISMATCH") : parsed.data.status === "succeeded" ? null : parsed.data.error;
  if (job.channel === "elevenst"
    && job.operation === "listing.create"
    && elevenstFreshCreateBlockedByExistingSellerPrdCd(job.operation, completionSteps)) {
    effectiveCompletionStatus = "failed";
    effectiveCompletionError = "ELEVENST_EXISTING_SELLER_PRODUCT_CODE";
  }
  if (job.operation === "listing.lineage.verify") return completeListingLineageClaim(dependencies, gatewayTokenHash, job, parsed.data);
  if (job.channel === "lazada" && job.operation === "listing.create") {
    const gated = gateLazadaGatewayCreateCompletion({
      status: parsed.data.status,
      result: parsed.data.result,
      argumentsValue: lazadaGatewayCreateArgumentsFromJobRequest(job.request),
      jobId: job.id,
      listingId: typeof (job as unknown as { listing_id?: unknown }).listing_id === "string"
        ? (job as unknown as { listing_id: string }).listing_id
        : undefined,
    });
    if (!gated.ok) return "unavailable";
    if (gated.store) {
      const storedReceipt = await callRpc(dependencies, gated.store.rpc, gated.store.arguments);
      if (storedReceipt.error) return "unavailable";
    }
    if (gated.cas) {
      const storedCas = await callRpc(dependencies, gated.cas.rpc, gated.cas.arguments);
      if (storedCas.error) return "unavailable";
    }
  }
  const storedResponse: unknown = parsed.data.result ?? null;
  const arguments_ = {
    p_token_hash: gatewayTokenHash, p_job_id: job.id, p_claim_token: job.claim_token,
    p_status: effectiveCompletionStatus, p_response_payload: storedResponse, p_error_message: effectiveCompletionError,
    p_credential_refresh: parsed.data.credentialRefresh ?? null, p_normalized_orders: null, p_normalized_inquiries: null,
    p_diagnostic: parsed.data.status === "succeeded" && parsed.data.result.operation === "diagnostic.test" ? parsed.data.result.diagnostic : null,
  };
  let completed = await callRpc(dependencies, COMPLETE_TRANSACTION_RPC, arguments_);
  if (completed.error) completed = await callRpc(dependencies, COMPLETE_TRANSACTION_RPC, arguments_);
  if (completed.error) return "unavailable";
  if (recordValue(completed.data)?.status !== "completed") return "ownership_lost";
  return effectiveCompletionStatus === "reconciliation_required" ? "completed_reconciliation" : "completed";
}
