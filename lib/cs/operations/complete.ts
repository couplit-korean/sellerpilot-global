import { isEbayCaseDisputeHistoryArguments, recordEbayCaseDisputeGatewayObservation } from "../../channels/cs/ebay/case-dispute-gateway";
import { isCsOperation, type CsOperationResult as ChannelOperationResult } from "./contracts";
import type { ProviderJob } from "../../channels/provider-execution-contract";
import { callRpc, completionContext, recordValue, safeRpcCode, type CompletionDependencies, type CompletionResult } from "../../channels/gateway-completion-runtime";
import type { CredentialRefreshSnapshot } from "../../channels/protocols";
import { normalizeChannelInquiries } from "../../channels/inquiry-sync";
import { inquiryCoverageEvidence } from "../../channels/inquiry-coverage";
import { qoo10ReplyS3CompletionEvidence, qoo10ReplyS3ReadbackContext, qoo10ReplyS3StatusRpcArguments } from "../../channels/cs/qoo10/reply-readback-completion";
import { smartstoreReplyReadbackContext, smartstoreReplyReadbackResultContract } from "../../channels/cs/smartstore/reply-readback";
import { recordQoo10ReplyS3Requery } from "../../channels/cs/qoo10/reply-readback-requery-runtime";
import { qoo10HistoryGatewayCompletion, qoo10HistoryGatewayRpcArguments } from "../../channels/cs/qoo10/history-gateway";
import { parseQoo10InquiryIdentityContext, qoo10InquiryIdentityContextRpcArguments } from "../../channels/cs/qoo10/inquiry-identity-context";
import { shopeeHistoryInterruptionEvidence, shopeeHistoryPageEvidence } from "../../channels/cs/shopee/history-event-evidence";
import { shopeeReplyReadbackContext, shopeeReplyReadbackRpcArguments, verifyShopeeReplyReadback, type ShopeeReplyReadbackVerification } from "../../channels/cs/shopee/reply-readback";
import { hasProviderReplyAcceptance, inquiryReplyObservations, type InquiryReplyObservation } from "../../channels/reply-verification";
import { lazadaQuarantineReady, markLazadaImRawEvent, persistLazadaImRawEvent, type LazadaRawReceipt } from "../../channels/lazada-im-webhook";
import { lazadaImHistoryRawPages } from "../../channels/lazada-im";
import { buildElevenstCsReadObservation } from "../channels/elevenst/read-observation";
import { readElevenstCsAccountIdentity } from "../channels/elevenst/account-identity";
import { csCredentialBindingContract, csCredentialBindingEvidence } from "../../channels/cs-credential-binding";
import { coupangProductReplyReadbackContext, exactCoupangProductReplyReadbackEvidence, sanitizedCoupangProductReplyReadbackResult } from "../../channels/cs/coupang/product-reply-readback";
type CsCredentialBindingEvidence = Exclude<ReturnType<typeof csCredentialBindingEvidence>, null>;
export type CsCompletion = ({ status: "succeeded"; result: ChannelOperationResult } | { status: "failed" | "reconciliation_required"; result?: ChannelOperationResult; error: string }) & { credentialRefresh?: CredentialRefreshSnapshot; credentialBinding?: CsCredentialBindingEvidence };
const SANITIZED_INQUIRY_LIST_MARKER = "normalized_inquiries_v1";
function sanitizedInquiryListResult(
  result: ChannelOperationResult,
  normalizedInquiryCount: number,
): ChannelOperationResult {
  const finalProviderStatus = result.steps.at(-1)?.status ?? 200;
  return {
    ok: result.ok,
    channel: result.channel,
    operation: "inquiries.list",
    steps: [{
      name: "inquiries-normalized",
      ok: result.ok,
      status: finalProviderStatus,
      data: {
        sellerpilotMarker: SANITIZED_INQUIRY_LIST_MARKER,
        normalizedInquiryCount,
        providerStepCount: result.steps.length,
      },
    }],
    ...(result.continuation ? { continuation: result.continuation } : {}),
    safeMessage: "문의 동기화 결과를 정규화해 저장했습니다.",
  };
}

export async function completeCsClaim(
  dependencies: CompletionDependencies,
  gatewayTokenHash: string,
  job: ProviderJob,
  completionInput: CsCompletion,
): Promise<CompletionResult> {
  if (!isCsOperation(job.operation)) return "ownership_lost";
  const parsed = { data: completionInput };

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
  const caseArguments = recordValue(job.request.arguments) ?? {};
  const caseDispute = job.channel === "ebay" && job.operation === "inquiries.list" && isEbayCaseDisputeHistoryArguments(caseArguments);
  if (caseDispute && completionProviderResult) {
    try { await recordEbayCaseDisputeGatewayObservation({ jobId: job.id, claimToken: job.claim_token, tokenHash: gatewayTokenHash,
      arguments: caseArguments, result: completionProviderResult as Parameters<typeof recordEbayCaseDisputeGatewayObservation>[0]["result"],
      rpc: (name, args) => callRpc(dependencies, name, args),
    }); } catch { return "unavailable"; }
  }
  const qoo10ReadbackContext = qoo10ReplyS3ReadbackContext(job.request);
  if (qoo10ReadbackContext
      && (job.channel !== "qoo10" || job.operation !== "inquiries.list")) {
    return "ownership_lost";
  }
  const qoo10ReadbackCompletion = qoo10ReadbackContext
    ? qoo10ReplyS3CompletionEvidence({
        context: qoo10ReadbackContext,
        result: completionProviderResult as ChannelOperationResult | undefined,
      })
    : null;
  let smartstoreReadbackContext;
  try {
    smartstoreReadbackContext = smartstoreReplyReadbackContext(job.request);
  } catch {
    return "ownership_lost";
  }
  if (smartstoreReadbackContext
      && (job.channel !== "smartstore" || job.operation !== "inquiries.list")) {
    return "ownership_lost";
  }
  let shopeeReadbackContext;
  try {
    shopeeReadbackContext = shopeeReplyReadbackContext(job.request);
  } catch {
    return "ownership_lost";
  }
  if (shopeeReadbackContext
      && (job.channel !== "shopee" || job.operation !== "inquiries.list")) {
    return "ownership_lost";
  }
  let coupangProductReadbackContext;
  try {
    coupangProductReadbackContext = coupangProductReplyReadbackContext(job.request);
  } catch {
    return "ownership_lost";
  }
  if (coupangProductReadbackContext
      && (job.channel !== "coupang" || job.operation !== "inquiries.list")) {
    return "ownership_lost";
  }
  let effectiveCompletionStatus = parsed.data.status;
  const replyAcceptanceMissing = parsed.data.status === "succeeded"
    && parsed.data.result.operation === "inquiries.reply"
    && parsed.data.result.ok
    && !hasProviderReplyAcceptance(parsed.data.result as ChannelOperationResult);
  if (replyAcceptanceMissing) effectiveCompletionStatus = "reconciliation_required";
  const effectiveCompletionError = replyAcceptanceMissing
    ? "INQUIRY_REPLY_PROVIDER_ACCEPTANCE_EVIDENCE_MISSING"
    : effectiveCompletionStatus === "reconciliation_required"
      && parsed.data.status === "succeeded"
    ? "INQUIRY_REPLY_PROVIDER_ACCEPTANCE_EVIDENCE_MISSING"
    : parsed.data.status === "succeeded"
      ? null
      : parsed.data.error;
  let normalizedInquiries: ReturnType<typeof normalizeChannelInquiries> | null = null;
  const shopeeHistoryArguments = recordValue(job.request.arguments) ?? {};
  let shopeeHistoryEvent: ReturnType<typeof shopeeHistoryPageEvidence> | ReturnType<typeof shopeeHistoryInterruptionEvidence> | null = null;
  let projectedInquiryCount = 0;
  let inquiryCoverage: ReturnType<typeof inquiryCoverageEvidence> | null = null;
  let qoo10HistoryCompletion: NonNullable<ReturnType<typeof qoo10HistoryGatewayCompletion>> | null = null;
  let replyObservations: InquiryReplyObservation[] = [];
  let shopeeReadbackVerification: ShopeeReplyReadbackVerification | null = null;
  let elevenstReadReceipt: ReturnType<typeof buildElevenstCsReadObservation> | null = null;
  const lazadaRawPages: Array<LazadaRawReceipt & { targetStatus: "normalized" | "unsupported" }> = [];
  let storedResponse: unknown = null;
  if (parsed.data.status === "succeeded") {
    storedResponse = parsed.data.result;
    if (job.operation === "inquiries.list" && !caseDispute) {
      const syncResponse = parsed.data.result as ChannelOperationResult;
      const normalizationTimestamp = typeof context.normalization_timestamp === "string"
        ? new Date(context.normalization_timestamp)
        : null;
      if (!normalizationTimestamp || Number.isNaN(normalizationTimestamp.getTime())) return "unavailable";
      const stableNormalizationTimestamp = normalizationTimestamp.toISOString();
      if (!syncResponse.ok) {
        return "unavailable";
      }
      if (job.channel === "qoo10" && !qoo10ReadbackContext) {
        try {
          qoo10HistoryCompletion = qoo10HistoryGatewayCompletion({
            arguments: recordValue(job.request.arguments) ?? {},
            result: syncResponse,
          });
        } catch {
          return "unavailable";
        }
      }
      if (!qoo10ReadbackContext) {
        const qoo10Identity = job.channel === "qoo10"
          ? await (async () => {
              const identity = await callRpc(
                dependencies,
                "sellerpilot_service_qoo10_inquiry_identity_context_v1",
                qoo10InquiryIdentityContextRpcArguments({
                  tokenHash: gatewayTokenHash,
                  jobId: job.id,
                  claimToken: job.claim_token,
                }),
              );
              if (identity.error) throw new Error("QOO10_INQUIRY_IDENTITY_CONTEXT_UNAVAILABLE");
              return parseQoo10InquiryIdentityContext(identity.data, {
                credentialId: job.credential_id,
                environment: job.environment,
              });
            })().catch(() => null)
          : undefined;
        if (job.channel === "qoo10" && !qoo10Identity) {
          return "unavailable";
        }
        if (job.channel === "lazada") {
          for (const rawPage of lazadaImHistoryRawPages(syncResponse.steps)) {
            const stored = await persistLazadaImRawEvent(job.credential_id, rawPage.rawBody, (arguments_) => (
              callRpc(dependencies, "sellerpilot_service_store_lazada_im_raw_event_v1", arguments_)
            ), "history_page");
            if (!stored.ok) return "unavailable";
            lazadaRawPages.push({ ...stored.receipt, targetStatus: rawPage.processingStatus });
          }
        }
        normalizedInquiries = normalizeChannelInquiries(
          job.channel,
          syncResponse as unknown as Parameters<typeof normalizeChannelInquiries>[1],
          stableNormalizationTimestamp,
          {
            lazadaRawStorageReady: job.channel === "lazada",
            ...(qoo10Identity ? { qoo10Identity } : {}),
          },
        );
        if (coupangProductReadbackContext) {
          let exactEvidence;
          try {
            exactEvidence = exactCoupangProductReplyReadbackEvidence(
              coupangProductReadbackContext,
              syncResponse,
              normalizedInquiries,
            );
          } catch {
            return "unavailable";
          }
          replyObservations = inquiryReplyObservations("coupang", exactEvidence);
          normalizedInquiries = [];
          storedResponse = sanitizedCoupangProductReplyReadbackResult(
            coupangProductReadbackContext,
            syncResponse,
            exactEvidence.length,
          );
        }
        if (shopeeReadbackContext) {
          shopeeReadbackVerification = verifyShopeeReplyReadback({
            context: shopeeReadbackContext,
            result: syncResponse,
            normalizedInquiries,
          });
        }
        if (job.channel === "shopee"
            && typeof shopeeHistoryArguments.sellerpilotShopeeHistoryRunId === "string") {
          shopeeHistoryEvent = shopeeHistoryPageEvidence({
            jobId: job.id,
            arguments: shopeeHistoryArguments,
            result: syncResponse,
            normalizedInquiries,
          });
        }
        projectedInquiryCount = normalizedInquiries.length;
        const historyRunId = recordValue(job.request.arguments)?.sellerpilotHistoryRunId;
        if ((typeof job.request.periodicKey === "string"
              && job.request.periodicKey.startsWith("inquiries:history:"))
            || (typeof historyRunId === "string" && historyRunId.length > 0)) {
          if (!qoo10HistoryCompletion) {
            inquiryCoverage = inquiryCoverageEvidence(job.channel, syncResponse, normalizedInquiries);
          }
        }
        if (!coupangProductReadbackContext) {
          replyObservations = inquiryReplyObservations(job.channel, normalizedInquiries);
        }
        if (smartstoreReadbackContext) {
          // The bounded readback may return an older copy of the buyer's
          // question. It is evidence for the seller reply only and must never
          // overwrite a newer inbound generation.
          normalizedInquiries = [];
        }
        if (job.channel !== "lazada") {
          normalizedInquiries = normalizedInquiries.filter((inquiry) => inquiry.senderRole !== "seller");
        }
        if (job.channel === "elevenst") {
          let identity;
          try {
            identity = await readElevenstCsAccountIdentity(job.credential_id, (name, args) => (
              callRpc(dependencies, name, args)
            ));
          } catch {
            return "unavailable";
          }
          elevenstReadReceipt = buildElevenstCsReadObservation({
            result: syncResponse, arguments: recordValue(job.request.arguments) ?? {},
            checkedAt: stableNormalizationTimestamp,
            normalizedInquiries,
            identity,
          });
        }
      }
      if (qoo10ReadbackCompletion) {
        storedResponse = qoo10ReadbackCompletion.storedResponse;
      }
    }
  } else if (caseDispute && parsed.data.result) {
    storedResponse = parsed.data.result;

  } else if (parsed.data.status === "failed" && parsed.data.result) {
    const normalizationTimestamp = typeof context.normalization_timestamp === "string"
      ? new Date(context.normalization_timestamp)
      : null;
    if (!normalizationTimestamp || Number.isNaN(normalizationTimestamp.getTime())) return "unavailable";
    let identity;
    try {
      identity = await readElevenstCsAccountIdentity(job.credential_id, (name, args) => (
        callRpc(dependencies, name, args)
      ));
    } catch {
      return "unavailable";
    }
    elevenstReadReceipt = buildElevenstCsReadObservation({
      result: parsed.data.result,
      arguments: recordValue(job.request.arguments) ?? {},
      checkedAt: normalizationTimestamp.toISOString(),
      normalizedInquiries: [],
      identity,
    });
    storedResponse = parsed.data.result;
  } else if (parsed.data.status === "reconciliation_required" && parsed.data.result) {
    storedResponse = parsed.data.result;
    if (qoo10ReadbackCompletion) {
      storedResponse = qoo10ReadbackCompletion.storedResponse;
    } else if (coupangProductReadbackContext) {
      storedResponse = sanitizedCoupangProductReplyReadbackResult(
        coupangProductReadbackContext,
        parsed.data.result,
        0,
      );
    }
  }
  if (!shopeeHistoryEvent && job.channel === "shopee"
      && job.operation === "inquiries.list"
      && parsed.data.status !== "succeeded"
      && typeof shopeeHistoryArguments.sellerpilotShopeeHistoryRunId === "string") {
    shopeeHistoryEvent = shopeeHistoryInterruptionEvidence({
      jobId: job.id,
      arguments: shopeeHistoryArguments,
      error: effectiveCompletionError ?? "SHOPEE_HISTORY_FAILED",
    });
  }
  // The dedicated page ledger is already persisted; generic completion requires an array.
  if (caseDispute && parsed.data.status === "succeeded" && parsed.data.result.ok) normalizedInquiries = [];
  if (job.channel === "lazada" && normalizedInquiries) {
    const v3Ready = await callRpc(dependencies, "sellerpilot_service_lazada_im_ingest_ready_v3", {
      p_credential_id: job.credential_id,
    });
    if (v3Ready.error || v3Ready.data !== true) return "unavailable";
    if (!await lazadaQuarantineReady(normalizedInquiries, () => callRpc(dependencies, "sellerpilot_service_lazada_quarantine_ready_v3", {}))) return "unavailable";
    const ingestion = await callRpc(dependencies, "sellerpilot_service_ingest_lazada_gateway_v3", {
      p_token_hash: gatewayTokenHash, p_job_id: job.id, p_claim_token: job.claim_token,
      p_inquiries: normalizedInquiries,
    });
    const receipt = recordValue(ingestion.data);
    if (ingestion.error || receipt?.contract !== "lazada_ingest_v3" || receipt.status !== "complete") return "unavailable";
    normalizedInquiries = []; // Already committed; the job itself is still ownership/receipt checked below.
    for (const rawPage of lazadaRawPages) {
      const marked = await markLazadaImRawEvent(job.credential_id, rawPage.id, rawPage.targetStatus, (arguments_) => (
        callRpc(dependencies, "sellerpilot_service_mark_lazada_im_raw_event_v1", arguments_)
      ));
      if (!marked) return "unavailable";
    }
  }
  if (job.operation === "inquiries.list" && storedResponse && !qoo10ReadbackContext
      && !coupangProductReadbackContext && !caseDispute) {
    storedResponse = sanitizedInquiryListResult(
      storedResponse as ChannelOperationResult,
      projectedInquiryCount,
    );
  }

  const completionArguments = {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_status: effectiveCompletionStatus,
    p_response_payload: storedResponse,
    p_error_message: effectiveCompletionError,
    p_credential_refresh: parsed.data.credentialRefresh ?? null,
    p_normalized_orders: null,
    p_normalized_inquiries: normalizedInquiries,
    p_diagnostic: null,
  };
  const completionRpc = shopeeHistoryEvent
    ? "sellerpilot_service_complete_serverless_cs_shopee_history_v1"
    : "sellerpilot_service_complete_serverless_cs_transaction";
  const atomicCompletionArguments = shopeeHistoryEvent ? {
    ...completionArguments,
    p_history_run_id: shopeeHistoryArguments.sellerpilotShopeeHistoryRunId,
    p_history_event: shopeeHistoryEvent,
  } : completionArguments;
  let completed = await callRpc(
    dependencies,
    completionRpc,
    atomicCompletionArguments,
  );
  if (completed.error) {
    completed = await callRpc(
      dependencies,
      completionRpc,
      atomicCompletionArguments,
    );
  }
  if (completed.error) return "unavailable";
  const completion = recordValue(completed.data);
  if (completion?.status !== "completed"
      && !(qoo10HistoryCompletion && completion?.status === "completed_replay")) {
    return "ownership_lost";
  }
  if (shopeeHistoryEvent
      && !["recorded", "duplicate"].includes(String(completion.shopeeHistoryEventStatus))) {
    return "unavailable";
  }
  const temuHistoryRunId = job.channel === "temu" && job.operation === "inquiries.list"
    ? recordValue(job.request.arguments)?.sellerpilotTemuHistoryRunId
    : null;
  if (typeof temuHistoryRunId === "string") {
    const recorded = await callRpc(
      dependencies,
      "sellerpilot_service_record_temu_history_checkpoint_v1",
      {
        p_token_hash: gatewayTokenHash,
        p_job_id: job.id,
        p_claim_token: job.claim_token,
      },
    );
    const checkpoint = recordValue(recorded.data);
    const retention = recordValue(checkpoint?.providerRetention);
    if (recorded.error
        || checkpoint?.contract !== "sellerpilot-temu-history-checkpoint/1"
        || checkpoint.runId !== temuHistoryRunId
        || checkpoint.credentialId !== job.credential_id
        || checkpoint.completedPagesPreserved !== true
        || retention?.status !== "unverified"
        || retention.earliestSupportedDate !== null) {
      return "unavailable";
    }
  }
  if (qoo10ReadbackContext && qoo10ReadbackCompletion) {
    const recorded = await callRpc(
      dependencies,
      "sellerpilot_service_record_qoo10_reply_s3_readback_v1",
      qoo10ReplyS3StatusRpcArguments({
        tokenHash: gatewayTokenHash,
        jobId: job.id,
        claimToken: job.claim_token,
        context: qoo10ReadbackContext,
        verification: qoo10ReadbackCompletion.verification,
      }),
    );
    const evidence = recordValue(recorded.data);
    if (recorded.error
        || evidence?.contract !== "sellerpilot-qoo10-s3-readback-result/1"
        || evidence.deliveryId !== qoo10ReadbackContext.deliveryId
        || evidence.state !== qoo10ReadbackCompletion.verification.state
        || evidence.replyContentObserved !== false
        || evidence.automaticResendAllowed !== false) {
      return "unavailable";
    }
    try {
      await recordQoo10ReplyS3Requery({
        rpc: (name, arguments_) => callRpc(dependencies, name, arguments_),
        tokenHash: gatewayTokenHash,
        jobId: job.id,
        claimToken: job.claim_token,
        verification: qoo10ReadbackCompletion.verification,
      });
    } catch (error) {
      dependencies.logError?.("qoo10_s3_requery", {
        error: error instanceof Error ? error.message : "QOO10_REPLY_REQUERY_UNKNOWN",
      });
      return "unavailable";
    }
  }
  if (qoo10HistoryCompletion) {
    const history = await callRpc(
      dependencies,
      "sellerpilot_service_record_qoo10_history_window_v1",
      qoo10HistoryGatewayRpcArguments({
        tokenHash: gatewayTokenHash,
        jobId: job.id,
        claimToken: job.claim_token,
        completion: qoo10HistoryCompletion,
      }),
    );
    const receipt = recordValue(history.data);
    if (history.error
        || receipt?.contract !== "sellerpilot-qoo10-history-window-record/1"
        || !["recorded", "duplicate"].includes(String(receipt.status))
        || receipt.jobId !== job.id
        || receipt.windowKey !== qoo10HistoryCompletion.windowKey
        || receipt.completionState !== qoo10HistoryCompletion.state
        || receipt.refinementCount !== qoo10HistoryCompletion.refinementRequests.length) {
      return "unavailable";
    }
  }
  if (elevenstReadReceipt) {
    const observationArguments = {
      p_credential_id: job.credential_id,
      p_observation: elevenstReadReceipt.observation,
      p_inquiries: elevenstReadReceipt.inquiries,
    };
    let readObservation = await callRpc(
      dependencies,
      "sellerpilot_service_record_elevenst_cs_read_v1",
      observationArguments,
    );
    let receipt = recordValue(readObservation.data);
    if (readObservation.error || receipt?.contract !== "sellerpilot-elevenst-cs-read-record/1") {
      readObservation = await callRpc(
        dependencies,
        "sellerpilot_service_record_elevenst_cs_read_v1",
        observationArguments,
      );
      receipt = recordValue(readObservation.data);
    }
    if (readObservation.error || receipt?.contract !== "sellerpilot-elevenst-cs-read-record/1") {
      return "unavailable";
    }
  }
  if (effectiveCompletionStatus === "succeeded"
      && (job.operation === "inquiries.list" || job.operation === "inquiries.reply")) {
    const bindingEvidence = parsed.data.credentialBinding ?? csCredentialBindingEvidence({
      channel: job.channel,
      operation: job.operation,
      credential: job.credential,
      request: job.request,
      providerResult: parsed.data.result,
      credentialBindingContext: job.credential_binding_context ?? null,
    });
    if (job.channel === "temu" && job.operation === "inquiries.list" && !bindingEvidence) {
      return "unavailable";
    }
    if (bindingEvidence) {
      const binding = await callRpc(dependencies, "sellerpilot_service_record_cs_credential_binding_v1", {
        p_token_hash: gatewayTokenHash,
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_evidence: bindingEvidence,
      });
      const receipt = recordValue(binding.data);
      if (binding.error || receipt?.contract !== csCredentialBindingContract
          || receipt.status !== "recorded") {
        dependencies.logError?.("credential_binding", {
          status: 503,
          channel: job.channel,
          operation: job.operation,
          code: safeRpcCode(binding.error),
        });
        if (job.channel === "temu") return "unavailable";
      }
    }
  }
  if (replyObservations.length) {
    const observation = await callRpc(dependencies, "sellerpilot_service_observe_inquiry_replies_v1", {
      p_credential_id: job.credential_id,
      p_channel: job.channel,
      p_observations: replyObservations,
    });
    const observed = recordValue(observation.data);
    if (observation.error
        || observed?.contract !== "sellerpilot-reply-observation-result/1"
        || observed.received !== replyObservations.length) return "unavailable";
  }
  if (shopeeReadbackContext && shopeeReadbackVerification) {
    const readback = await callRpc(
      dependencies,
      "sellerpilot_service_record_shopee_reply_readback_v1",
      shopeeReplyReadbackRpcArguments({
        tokenHash: gatewayTokenHash,
        jobId: job.id,
        claimToken: job.claim_token,
        context: shopeeReadbackContext,
        verification: shopeeReadbackVerification,
      }),
    );
    const evidence = recordValue(readback.data);
    if (readback.error
        || evidence?.contract !== "sellerpilot-shopee-reply-readback-result/1"
        || evidence.deliveryId !== shopeeReadbackContext.deliveryId
        || evidence.attempt !== shopeeReadbackContext.attempt
        || evidence.state !== shopeeReadbackVerification.state
        || evidence.automaticResendAllowed !== false) return "unavailable";
  }
  let smartstoreReadbackRequiresAttention = false;
  if (smartstoreReadbackContext) {
    const readback = await callRpc(dependencies,
      "sellerpilot_service_record_smartstore_reply_readback_v1", {
        p_token_hash: gatewayTokenHash,
        p_job_id: job.id,
        p_claim_token: job.claim_token,
      });
    const receipt = recordValue(readback.data);
    if (readback.error
        || receipt?.contract !== smartstoreReplyReadbackResultContract
        || receipt.deliveryId !== smartstoreReadbackContext.deliveryId
        || !["verified", "unverified", "failed"].includes(String(receipt.state))
        || receipt.automaticResendAllowed !== false) return "unavailable";
    smartstoreReadbackRequiresAttention = receipt.state !== "verified";
  }
  if (inquiryCoverage) {
    const coverage = await callRpc(dependencies, "sellerpilot_service_record_cs_history_page_v1", {
      p_token_hash: gatewayTokenHash,
      p_job_id: job.id,
      p_claim_token: job.claim_token,
      p_provider_contract_version: inquiryCoverage.contractVersion,
      p_provider_row_count: inquiryCoverage.providerRowCount,
      p_projected_event_count: inquiryCoverage.projectedEventCount,
      p_observation_digests: inquiryCoverage.observationDigests,
      p_excluded_count: inquiryCoverage.excludedCount,
      p_event_row_comparable: inquiryCoverage.eventRowComparable,
      p_has_continuation: inquiryCoverage.hasContinuation,
    });
    const recorded = recordValue(coverage.data);
    if (coverage.error || recorded?.contract !== "cs_history_coverage_v1"
        || recorded.jobId !== job.id) return "unavailable";
  }
  return effectiveCompletionStatus === "reconciliation_required"
      || smartstoreReadbackRequiresAttention
    ? "completed_reconciliation"
    : "completed";
}
