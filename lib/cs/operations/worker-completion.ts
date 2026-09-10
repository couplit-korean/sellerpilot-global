import { isEbayCaseDisputeHistoryArguments, recordEbayCaseDisputeGatewayObservation } from "../../channels/cs/ebay/case-dispute-gateway";

import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeChannelInquiries } from "../../channels/inquiry-sync";
import { inquiryCoverageEvidence } from "../../channels/inquiry-coverage";
import { qoo10ReplyS3CompletionEvidence, qoo10ReplyS3ReadbackContext, qoo10ReplyS3StatusRpcArguments } from "../../channels/cs/qoo10/reply-readback-completion";
import { recordQoo10ReplyS3Requery } from "../../channels/cs/qoo10/reply-readback-requery-runtime";
import { qoo10HistoryGatewayCompletion, qoo10HistoryGatewayRpcArguments } from "../../channels/cs/qoo10/history-gateway";
import { parseQoo10InquiryIdentityContext, qoo10InquiryIdentityContextRpcArguments } from "../../channels/cs/qoo10/inquiry-identity-context";
import { hasProviderReplyAcceptance, inquiryReplyObservations, type InquiryReplyObservation } from "../../channels/reply-verification";
import { smartstoreReplyReadbackContext, smartstoreReplyReadbackResultContract } from "../../channels/cs/smartstore/reply-readback";
import { shopeeReplyReadbackContext, shopeeReplyReadbackRpcArguments, verifyShopeeReplyReadback, type ShopeeReplyReadbackVerification } from "../../channels/cs/shopee/reply-readback";
import { lazadaQuarantineReady, markLazadaImRawEvent, persistLazadaImRawEvent, type LazadaRawReceipt } from "../../channels/lazada-im-webhook";
import { lazadaImHistoryRawPages } from "../../channels/lazada-im";
import type { ActiveChannelKey } from "../../channels/catalog";
import type { CsOperationResult as ChannelOperationResult } from "./contracts";
import { buildElevenstCsReadObservation } from "../channels/elevenst/read-observation";
import { readElevenstCsAccountIdentity } from "../channels/elevenst/account-identity";
import { safeElevenstProductQnaBusinessFailureResult, sanitizedElevenstFailedInquiryStoredResult } from "../../channels/cs/elevenst/worker-completion";
import { workerRpcErrorMessage, workerRpcErrorStatus } from "../../worker-rpc";
import { recordTemuDetailRetryWithReplay } from "../../channels/cs/temu/retry-rpc";
import { coupangProductReplyReadbackContext, exactCoupangProductReplyReadbackEvidence, isCoupangProductReplyReadbackRetry, sanitizedCoupangProductReplyReadbackResult } from "../../channels/cs/coupang/product-reply-readback";
import { recordCoupangProductReplyReadbackRetryWithReplay } from "../../channels/cs/coupang/product-reply-readback-rpc";
const inquiryCoverageCompletionSchema = z.object({
  contract: z.literal("cs_history_coverage_v1"),
  status: z.enum(["ignored", "running", "completed", "reconciliation_required", "duplicate"]),
  jobId: z.string().uuid(),
  scanId: z.string().uuid().optional(),
  pageNumber: z.number().int().positive().optional(),
}).strip();
const replyObservationCompletionSchema = z.object({
  contract: z.literal("sellerpilot-reply-observation-result/1"),
  received: z.number().int().nonnegative(),
  stored: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
}).strip();

function completionNormalizationTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const SAFE_TEMU_DETAIL_RETRY_ERRORS = new Set([
  "TEMU_AFTER_SALES_DETAIL_RETRY_SCHEMA_NOT_READY",
  "TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED",
  "TEMU_AFTER_SALES_DETAIL_RETRY_RECEIPT_INVALID",
]);
const SAFE_COUPANG_PRODUCT_READBACK_RETRY_ERRORS = new Set([
  "COUPANG_PRODUCT_REPLY_READBACK_RETRY_SCHEMA_NOT_READY",
  "COUPANG_PRODUCT_REPLY_READBACK_RETRY_RECORDING_FAILED",
  "COUPANG_PRODUCT_REPLY_READBACK_RETRY_RECEIPT_INVALID",
]);

function safeTemuDetailRetryError(error: unknown) {
  return error instanceof Error && SAFE_TEMU_DETAIL_RETRY_ERRORS.has(error.message)
    ? error.message
    : "TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED";
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CsCompletion } from "./complete";
import { isCsOperation, type CsRetryContinuation } from "./contracts";
export type CsWorkerCompletion = CsCompletion & { jobId: string; claimToken: string; retryContinuation?: CsRetryContinuation };
type CsWorkerContext = { serviceClient: SupabaseClient; tokenHash: string; job: Record<string, unknown>; completion: CsWorkerCompletion };
export async function completeCsWorker({ serviceClient, tokenHash, job, completion: completionInput }: CsWorkerContext) {
  if (!isCsOperation(String(job.operation))) return NextResponse.json({ message: "CS 작업 계보가 일치하지 않습니다." }, { status: 409 });
  const parsed = { data: completionInput };
  const normalizationTimestamp = completionNormalizationTimestamp(job.normalization_timestamp)
    ?? completionNormalizationTimestamp(job.started_at)
    ?? new Date().toISOString();
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

  let storedResponse: Record<string, unknown> | null = null;
  let normalizedInquiries: ReturnType<typeof normalizeChannelInquiries> | null = null;
  let inquiryCoverage: ReturnType<typeof inquiryCoverageEvidence> | null = null;
  let qoo10HistoryCompletion: NonNullable<ReturnType<typeof qoo10HistoryGatewayCompletion>> | null = null;
  let replyObservations: InquiryReplyObservation[] = [];
  let shopeeReadbackVerification: ShopeeReplyReadbackVerification | null = null;
  let elevenstReadReceipt: ReturnType<typeof buildElevenstCsReadObservation> | null = null;
  const lazadaRawPages: Array<LazadaRawReceipt & { targetStatus: "normalized" | "unsupported" }> = [];
  const completionResult = parsed.data.status === "succeeded"
    ? parsed.data.result
    : parsed.data.status === "reconciliation_required"
      ? parsed.data.result
      : parsed.data.result;
  if (completionResult
      && (job.channel !== completionResult.channel || job.operation !== completionResult.operation)) {
    return NextResponse.json({ message: "채널 작업 결과가 요청과 일치하지 않습니다." }, { status: 409 });
  }
  const requestRecord = job.request && typeof job.request === "object" && !Array.isArray(job.request) ? job.request as Record<string, unknown> : {};
  const caseArguments = requestRecord.arguments && typeof requestRecord.arguments === "object" && !Array.isArray(requestRecord.arguments) ? requestRecord.arguments as Record<string, unknown> : {};
  const caseDispute = job.channel === "ebay" && job.operation === "inquiries.list" && isEbayCaseDisputeHistoryArguments(caseArguments);
  if (caseDispute && completionResult) {
    try { await recordEbayCaseDisputeGatewayObservation({ jobId: parsed.data.jobId, claimToken: parsed.data.claimToken, tokenHash,
      arguments: caseArguments, result: completionResult as Parameters<typeof recordEbayCaseDisputeGatewayObservation>[0]["result"],
      rpc: async (name, args) => { const value = await serviceClient.rpc(name, args); return { data: value.data, error: value.error }; },
    }); } catch { return NextResponse.json({ message: "eBay 분쟁 조회 원장을 저장하지 못했습니다." }, { status: 503 }); }
  }
  let qoo10ReadbackContext;
  try {
    qoo10ReadbackContext = qoo10ReplyS3ReadbackContext(job);
  } catch {
    return NextResponse.json({ message: "Qoo10 S3 조회 계보가 올바르지 않습니다." }, { status: 409 });
  }
  if (qoo10ReadbackContext
      && (job.channel !== "qoo10" || job.operation !== "inquiries.list")) {
    return NextResponse.json({ message: "Qoo10 S3 조회 계보가 현재 작업과 일치하지 않습니다." }, { status: 409 });
  }
  const qoo10ReadbackCompletion = qoo10ReadbackContext
    ? qoo10ReplyS3CompletionEvidence({
        context: qoo10ReadbackContext,
        result: completionResult as ChannelOperationResult | undefined,
      })
    : null;
  let smartstoreReadbackContext;
  try {
    smartstoreReadbackContext = smartstoreReplyReadbackContext(job.request);
  } catch {
    return NextResponse.json({ message: "스마트스토어 답변 재조회 계보가 올바르지 않습니다." }, { status: 409 });
  }
  if (smartstoreReadbackContext
      && (job.channel !== "smartstore" || job.operation !== "inquiries.list")) {
    return NextResponse.json({ message: "스마트스토어 답변 재조회 계보가 현재 작업과 일치하지 않습니다." }, { status: 409 });
  }
  let shopeeReadbackContext;
  try {
    shopeeReadbackContext = shopeeReplyReadbackContext(job.request);
  } catch {
    return NextResponse.json({ message: "Shopee 답변 재조회 계보가 올바르지 않습니다." }, { status: 409 });
  }
  if (shopeeReadbackContext
      && (job.channel !== "shopee" || job.operation !== "inquiries.list")) {
    return NextResponse.json({ message: "Shopee 답변 재조회 계보가 현재 작업과 일치하지 않습니다." }, { status: 409 });
  }
  let coupangProductReadbackContext;
  try {
    coupangProductReadbackContext = coupangProductReplyReadbackContext(job.request);
  } catch {
    return NextResponse.json({ message: "쿠팡 상품문의 답변 재조회 계보가 올바르지 않습니다." }, { status: 409 });
  }
  if (coupangProductReadbackContext
      && (job.channel !== "coupang" || job.operation !== "inquiries.list")) {
    return NextResponse.json({ message: "쿠팡 상품문의 답변 재조회 계보가 현재 작업과 일치하지 않습니다." }, { status: 409 });
  }
  const credentialRefresh = parsed.data.credentialRefresh;
  if (credentialRefresh
      && job.channel !== "shopee"
      && job.channel !== "lazada"
      && job.channel !== "ebay") {
    return NextResponse.json({ message: "이 채널에는 OAuth 인증값 갱신을 적용할 수 없습니다." }, { status: 409 });
  }

  if (parsed.data.status === "succeeded") {
    if (parsed.data.result.operation === "inquiries.list" && !qoo10ReadbackContext && !caseDispute) {
      const inquiryResult = parsed.data.result as ChannelOperationResult;
      if (inquiryResult.ok) {
        if (job.channel === "qoo10") {
          try {
            qoo10HistoryCompletion = qoo10HistoryGatewayCompletion({
              arguments: caseArguments,
              result: inquiryResult,
            });
          } catch {
            return NextResponse.json({ message: "Qoo10 history completion evidence is invalid." }, { status: 503 });
          }
        }
        if (!normalizationTimestamp) {
          console.error("channel gateway inquiry completion has no stable normalization timestamp");
          return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
        }
        const qoo10Identity = job.channel === "qoo10"
          ? await (async () => {
              const identity = await serviceClient.rpc(
                "sellerpilot_service_qoo10_inquiry_identity_context_v1",
                qoo10InquiryIdentityContextRpcArguments({
                  tokenHash,
                  jobId: parsed.data.jobId,
                  claimToken: parsed.data.claimToken,
                }),
              );
              if (identity.error) throw new Error("QOO10_INQUIRY_IDENTITY_CONTEXT_UNAVAILABLE");
              return parseQoo10InquiryIdentityContext(identity.data, {
                credentialId: String(job.credential_id ?? ""),
                environment: job.environment === "sandbox" ? "sandbox" : "production",
              });
            })().catch(() => null)
          : undefined;
        if (job.channel === "qoo10" && !qoo10Identity) {
          return NextResponse.json({ message: "Qoo10 account identity context is unavailable." }, { status: 503 });
        }
        if (job.channel === "lazada") {
          for (const rawPage of lazadaImHistoryRawPages(inquiryResult.steps)) {
            const stored = await persistLazadaImRawEvent(String(job.credential_id ?? ""), rawPage.rawBody, (arguments_) => (
              serviceClient.rpc("sellerpilot_service_store_lazada_im_raw_event_v1", arguments_)
            ), "history_page");
            if (!stored.ok) return NextResponse.json({ message: "Lazada history storage unavailable" }, { status: 503 });
            lazadaRawPages.push({ ...stored.receipt, targetStatus: rawPage.processingStatus });
          }
        }
        normalizedInquiries = normalizeChannelInquiries(
          job.channel as ActiveChannelKey,
          inquiryResult as unknown as Parameters<typeof normalizeChannelInquiries>[1],
          normalizationTimestamp,
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
              inquiryResult,
              normalizedInquiries,
            );
          } catch {
            return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
          }
          replyObservations = inquiryReplyObservations("coupang", exactEvidence);
          normalizedInquiries = [];
          inquiryCoverage = null;
          storedResponse = sanitizedCoupangProductReplyReadbackResult(
            coupangProductReadbackContext,
            inquiryResult,
            exactEvidence.length,
          ) as unknown as Record<string, unknown>;
        }
        if (shopeeReadbackContext) {
          shopeeReadbackVerification = verifyShopeeReplyReadback({
            context: shopeeReadbackContext,
            result: inquiryResult,
            normalizedInquiries,
          });
        }
        if (!coupangProductReadbackContext && !smartstoreReadbackContext && !qoo10HistoryCompletion) {
          inquiryCoverage = inquiryCoverageEvidence(
            job.channel as ActiveChannelKey,
            inquiryResult,
            normalizedInquiries,
          );
          replyObservations = inquiryReplyObservations(
            job.channel as ActiveChannelKey,
            normalizedInquiries,
          );
        }
        if (smartstoreReadbackContext) {
          replyObservations = inquiryReplyObservations(
            job.channel as ActiveChannelKey,
            normalizedInquiries,
          );
          // A bounded readback can contain an older buyer question. Keep it as
          // reply evidence only so it cannot replace a newer inbound generation.
          normalizedInquiries = [];
        }
        if (job.channel !== "lazada") {
          // Seller observations are timeline/readback evidence. They must not
          // replace the latest customer generation in the legacy ticket
          // upsert that owns reply deduplication.
          normalizedInquiries = normalizedInquiries.filter((inquiry) => inquiry.senderRole !== "seller");
        }
      }
      if (job.channel === "elevenst") {
        if (!normalizationTimestamp) {
          return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
        }
        let identity;
        try {
          identity = await readElevenstCsAccountIdentity(String(job.credential_id ?? ""), (name, args) => (
            serviceClient.rpc(name, args)
          ));
        } catch {
          return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
        }
        elevenstReadReceipt = buildElevenstCsReadObservation({
          result: inquiryResult,
          arguments: (job.request as { arguments: Record<string, unknown> }).arguments,
          checkedAt: normalizationTimestamp,
          normalizedInquiries: normalizedInquiries ?? [],
          identity,
        });
      }
    }
    storedResponse = qoo10ReadbackCompletion
        ? qoo10ReadbackCompletion.storedResponse as unknown as Record<string, unknown>
        : coupangProductReadbackContext
          ? storedResponse
          : parsed.data.result;
  } else if (caseDispute && parsed.data.result) {
    storedResponse = parsed.data.result;

  } else if (parsed.data.status === "failed" && parsed.data.result) {
    if (!normalizationTimestamp) {
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    const safeFailedRead = safeElevenstProductQnaBusinessFailureResult(
      { channel: String(job.channel), operation: String(job.operation) },
      parsed.data.result,
    );
    if (!safeFailedRead) {
      return NextResponse.json({ message: "11번가 상품 Q&A 실패 증거 형식이 올바르지 않습니다." }, { status: 409 });
    }
    let identity;
    try {
      identity = await readElevenstCsAccountIdentity(String(job.credential_id ?? ""), (name, args) => (
        serviceClient.rpc(name, args)
      ));
    } catch {
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    elevenstReadReceipt = buildElevenstCsReadObservation({
      result: safeFailedRead,
      arguments: (job.request as { arguments: Record<string, unknown> }).arguments,
      checkedAt: normalizationTimestamp,
      normalizedInquiries: [],
      identity,
    });
    storedResponse = sanitizedElevenstFailedInquiryStoredResult(safeFailedRead) as unknown as Record<string, unknown>;
  } else if (parsed.data.status === "reconciliation_required" && parsed.data.result) {
    storedResponse = parsed.data.result;
    if (qoo10ReadbackCompletion) {
      storedResponse = qoo10ReadbackCompletion.storedResponse as unknown as Record<string, unknown>;
    } else if (coupangProductReadbackContext) {
      storedResponse = sanitizedCoupangProductReplyReadbackResult(
        coupangProductReadbackContext,
        parsed.data.result,
        0,
      ) as unknown as Record<string, unknown>;
    }
  }

  // The dedicated page ledger is already persisted; generic completion requires an array.
  if (caseDispute && parsed.data.status === "succeeded" && parsed.data.result.ok) normalizedInquiries = [];
  if (job.channel === "lazada" && normalizedInquiries) {
    const v3Ready = await serviceClient.rpc("sellerpilot_service_lazada_im_ingest_ready_v3", {
      p_credential_id: String(job.credential_id ?? ""),
    });
    if (v3Ready.error || v3Ready.data !== true) {
      return NextResponse.json({ message: "Lazada IM ingest V3 is not ready" }, { status: 503 });
    }
    if (!await lazadaQuarantineReady(normalizedInquiries, () => serviceClient.rpc("sellerpilot_service_lazada_quarantine_ready_v3"))) {
      return NextResponse.json({ message: "Lazada unordered message storage is not ready" }, { status: 503 });
    }
    const ingestion = await serviceClient.rpc("sellerpilot_service_ingest_lazada_gateway_v3", {
      p_token_hash: tokenHash, p_job_id: parsed.data.jobId, p_claim_token: parsed.data.claimToken,
      p_inquiries: normalizedInquiries,
    });
    const receipt = ingestion.data && typeof ingestion.data === "object" ? ingestion.data as Record<string, unknown> : null;
    if (ingestion.error || receipt?.contract !== "lazada_ingest_v3" || receipt.status !== "complete") {
      return NextResponse.json({ message: "Lazada partial ingestion: quarantine storage/review pending", partial: true, retryAfterSeconds: 300 }, { status: 503, headers: { "retry-after": "300" } });
    }
    normalizedInquiries = [];
    for (const rawPage of lazadaRawPages) {
      const marked = await markLazadaImRawEvent(String(job.credential_id ?? ""), rawPage.id, rawPage.targetStatus, (arguments_) => (
        serviceClient.rpc("sellerpilot_service_mark_lazada_im_raw_event_v1", arguments_)
      ));
      if (!marked) return NextResponse.json({ message: "Lazada history storage unavailable" }, { status: 503 });
    }
  }
  const temuBindingRequired = effectiveCompletionStatus === "succeeded"
    && job.channel === "temu"
    && job.operation === "inquiries.list";
  if (temuBindingRequired
      && (!("credentialBinding" in parsed.data) || !parsed.data.credentialBinding)) {
    return NextResponse.json(
      { message: "Temu 계정 결속 증거가 없어 조회 완료를 저장할 수 없습니다." },
      { status: 409 },
    );
  }
  const { data, error } = await serviceClient.rpc("sellerpilot_service_complete_gateway_transaction", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
    p_status: effectiveCompletionStatus,
    p_response_payload: storedResponse,
    p_error_message: effectiveCompletionError,
    p_credential_refresh: credentialRefresh ?? null,
    p_normalized_orders: null,
    p_normalized_inquiries: normalizedInquiries,
    p_diagnostic: null,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("channel gateway final completion RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  const completion = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (completion?.status !== "completed"
      && !(qoo10HistoryCompletion && completion?.status === "completed_replay")) {
    return NextResponse.json({ message: "실행 중인 채널 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }
  const historyArguments = job.request && typeof job.request === "object" && !Array.isArray(job.request)
    ? (job.request as { arguments?: unknown }).arguments
    : null;
  const requestHistoryRunId = job.channel === "temu"
    && job.operation === "inquiries.list"
    && historyArguments
    && typeof historyArguments === "object"
    && !Array.isArray(historyArguments)
    ? (historyArguments as Record<string, unknown>).sellerpilotTemuHistoryRunId
    : null;
  const temuHistoryRunId = typeof job.temuHistoryRunId === "string"
    ? job.temuHistoryRunId
    : requestHistoryRunId;
  if (typeof temuHistoryRunId === "string") {
    const recorded = await serviceClient.rpc(
      "sellerpilot_service_record_temu_history_checkpoint_v1",
      {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
      },
    );
    const checkpoint = recorded.data && typeof recorded.data === "object" && !Array.isArray(recorded.data)
      ? recorded.data as Record<string, unknown>
      : null;
    const retention = checkpoint?.providerRetention
      && typeof checkpoint.providerRetention === "object"
      && !Array.isArray(checkpoint.providerRetention)
      ? checkpoint.providerRetention as Record<string, unknown>
      : null;
    if (recorded.error
        || checkpoint?.contract !== "sellerpilot-temu-history-checkpoint/1"
        || checkpoint.runId !== temuHistoryRunId
        || checkpoint.credentialId !== job.credential_id
        || checkpoint.completedPagesPreserved !== true
        || retention?.status !== "unverified"
        || retention.earliestSupportedDate !== null) {
      console.error("Temu history checkpoint recording failed", {
        code: recorded.error?.code ?? "invalid_contract",
      });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
  }
  if (qoo10ReadbackContext && qoo10ReadbackCompletion) {
    const recorded = await serviceClient.rpc(
      "sellerpilot_service_record_qoo10_reply_s3_readback_v1",
      qoo10ReplyS3StatusRpcArguments({
        tokenHash,
        jobId: parsed.data.jobId,
        claimToken: parsed.data.claimToken,
        context: qoo10ReadbackContext,
        verification: qoo10ReadbackCompletion.verification,
      }),
    );
    const evidence = recorded.data && typeof recorded.data === "object" && !Array.isArray(recorded.data)
      ? recorded.data as Record<string, unknown>
      : null;
    if (recorded.error
        || evidence?.contract !== "sellerpilot-qoo10-s3-readback-result/1"
        || evidence.deliveryId !== qoo10ReadbackContext.deliveryId
        || evidence.state !== qoo10ReadbackCompletion.verification.state
        || evidence.replyContentObserved !== false
        || evidence.automaticResendAllowed !== false) {
      console.error("Qoo10 S3 status-only readback recording failed", {
        code: recorded.error?.code ?? "invalid_contract",
      });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
    try {
      await recordQoo10ReplyS3Requery({
        rpc: async (name, arguments_) => {
          const result = await serviceClient.rpc(name, arguments_);
          return { data: result.data, error: result.error };
        },
        tokenHash,
        jobId: parsed.data.jobId,
        claimToken: parsed.data.claimToken,
        verification: qoo10ReadbackCompletion.verification,
      });
    } catch (error) {
      console.error("Qoo10 bounded S3 requery recording failed", {
        code: error instanceof Error ? error.message : "QOO10_REPLY_REQUERY_UNKNOWN",
      });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
  }
  if (qoo10HistoryCompletion) {
    const history = await serviceClient.rpc(
      "sellerpilot_service_record_qoo10_history_window_v1",
      qoo10HistoryGatewayRpcArguments({
        tokenHash,
        jobId: parsed.data.jobId,
        claimToken: parsed.data.claimToken,
        completion: qoo10HistoryCompletion,
      }),
    );
    const receipt = history.data && typeof history.data === "object" && !Array.isArray(history.data)
      ? history.data as Record<string, unknown>
      : null;
    if (history.error
        || receipt?.contract !== "sellerpilot-qoo10-history-window-record/1"
        || !["recorded", "duplicate"].includes(String(receipt.status))
        || receipt.jobId !== parsed.data.jobId
        || receipt.windowKey !== qoo10HistoryCompletion.windowKey
        || receipt.completionState !== qoo10HistoryCompletion.state
        || receipt.refinementCount !== qoo10HistoryCompletion.refinementRequests.length) {
      const status = history.error ? workerRpcErrorStatus(history.error) : 503;
      console.error("Qoo10 history window recording failed", {
        code: history.error?.code ?? "invalid_contract",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
  }
  if (elevenstReadReceipt) {
    const observationArguments = {
      p_credential_id: job.credential_id,
      p_observation: elevenstReadReceipt.observation,
      p_inquiries: elevenstReadReceipt.inquiries,
    };
    let readObservation = await serviceClient.rpc(
      "sellerpilot_service_record_elevenst_cs_read_v1",
      observationArguments,
    );
    let receipt = readObservation.data
      && typeof readObservation.data === "object"
      && !Array.isArray(readObservation.data)
      ? readObservation.data as Record<string, unknown>
      : null;
    if (readObservation.error || receipt?.contract !== "sellerpilot-elevenst-cs-read-record/1") {
      readObservation = await serviceClient.rpc(
        "sellerpilot_service_record_elevenst_cs_read_v1",
        observationArguments,
      );
      receipt = readObservation.data
        && typeof readObservation.data === "object"
        && !Array.isArray(readObservation.data)
        ? readObservation.data as Record<string, unknown>
        : null;
    }
    if (readObservation.error || receipt?.contract !== "sellerpilot-elevenst-cs-read-record/1") {
      console.error("11st CS read observation RPC failed", {
        code: readObservation.error?.code ?? "invalid_contract",
      });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
  }
  if ("credentialBinding" in parsed.data && parsed.data.credentialBinding) {
    const binding = await serviceClient.rpc("sellerpilot_service_record_cs_credential_binding_v1", {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_evidence: parsed.data.credentialBinding,
    });
    const receipt = binding.data && typeof binding.data === "object" && !Array.isArray(binding.data)
      ? binding.data as Record<string, unknown> : null;
    if (binding.error || receipt?.contract !== "sellerpilot-cs-credential-binding/1" || receipt.status !== "recorded") {
      console.error("channel CS credential binding evidence RPC failed", {
        code: binding.error?.code ?? "invalid_contract",
        channel: job.channel,
        operation: job.operation,
      });
      if (temuBindingRequired) {
        return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
      }
    }
  }
  if (replyObservations.length) {
    const observation = await serviceClient.rpc("sellerpilot_service_observe_inquiry_replies_v1", {
      p_credential_id: job.credential_id,
      p_channel: job.channel,
      p_observations: replyObservations,
    });
    const observationCompletion = replyObservationCompletionSchema.safeParse(observation.data);
    if (observation.error || !observationCompletion.success
        || observationCompletion.data.received !== replyObservations.length) {
      const status = observation.error ? workerRpcErrorStatus(observation.error) : 503;
      console.error("channel inquiry reply observation RPC failed", {
        code: observation.error?.code ?? "invalid_contract",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
  }
  if (shopeeReadbackContext && shopeeReadbackVerification) {
    const readback = await serviceClient.rpc(
      "sellerpilot_service_record_shopee_reply_readback_v1",
      shopeeReplyReadbackRpcArguments({
        tokenHash,
        jobId: parsed.data.jobId,
        claimToken: parsed.data.claimToken,
        context: shopeeReadbackContext,
        verification: shopeeReadbackVerification,
      }),
    );
    const evidence = readback.data && typeof readback.data === "object" && !Array.isArray(readback.data)
      ? readback.data as Record<string, unknown> : null;
    if (readback.error
        || evidence?.contract !== "sellerpilot-shopee-reply-readback-result/1"
        || evidence.deliveryId !== shopeeReadbackContext.deliveryId
        || evidence.attempt !== shopeeReadbackContext.attempt
        || evidence.state !== shopeeReadbackVerification.state
        || evidence.automaticResendAllowed !== false) {
      console.error("Shopee exact reply readback recording failed", {
        code: readback.error?.code ?? "invalid_contract",
      });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
  }
  if (smartstoreReadbackContext) {
    const readback = await serviceClient.rpc(
      "sellerpilot_service_record_smartstore_reply_readback_v1", {
        p_token_hash: tokenHash,
        p_job_id: parsed.data.jobId,
        p_claim_token: parsed.data.claimToken,
      });
    const receipt = readback.data && typeof readback.data === "object" && !Array.isArray(readback.data)
      ? readback.data as Record<string, unknown> : null;
    if (readback.error
        || receipt?.contract !== smartstoreReplyReadbackResultContract
        || receipt.deliveryId !== smartstoreReadbackContext.deliveryId
        || !["verified", "unverified", "failed"].includes(String(receipt.state))
        || receipt.automaticResendAllowed !== false) {
      console.error("SmartStore exact reply readback recording failed", {
        code: readback.error?.code ?? "invalid_contract",
      });
      return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
    }
  }
  if (inquiryCoverage) {
    const coverage = await serviceClient.rpc("sellerpilot_service_record_cs_history_page_v1", {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_provider_contract_version: inquiryCoverage.contractVersion,
      p_provider_row_count: inquiryCoverage.providerRowCount,
      p_projected_event_count: inquiryCoverage.projectedEventCount,
      p_observation_digests: inquiryCoverage.observationDigests,
      p_excluded_count: inquiryCoverage.excludedCount,
      p_event_row_comparable: inquiryCoverage.eventRowComparable,
      p_has_continuation: inquiryCoverage.hasContinuation,
    });
    const coverageCompletion = inquiryCoverageCompletionSchema.safeParse(coverage.data);
    if (coverage.error || !coverageCompletion.success
        || coverageCompletion.data.jobId !== parsed.data.jobId) {
      const status = coverage.error ? workerRpcErrorStatus(coverage.error) : 503;
      console.error("channel inquiry history coverage RPC failed", {
        code: coverage.error?.code ?? "invalid_contract",
        status,
      });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
  }
  return NextResponse.json({
    message: effectiveCompletionStatus === "reconciliation_required"
      ? "채널 작업을 수동 확인 필요 상태로 안전하게 보존했습니다."
      : "채널 작업 결과가 안전하게 저장됐습니다.",
  });
}

export async function completeCsWorkerRetry(serviceClient: SupabaseClient, tokenHash: string, completion: CsWorkerCompletion) {
 const parsed = { data: completion };
  if (parsed.data.status === "failed" && parsed.data.retryContinuation) {
    const retry = parsed.data.retryContinuation;
    const coupangReadbackRetry = isCoupangProductReplyReadbackRetry(retry);
    const retryArguments = {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_retry_arguments: retry.arguments,
      p_retry_count: retry.retryCount,
      p_retry_after_seconds: retry.retryAfterSeconds,
      p_deferred_count: retry.deferredCount,
      p_replay_count: retry.replayCount,
      p_provider_status: retry.providerStatus,
    };
    try {
      const receipt = await (coupangReadbackRetry
        ? recordCoupangProductReplyReadbackRetryWithReplay
        : recordTemuDetailRetryWithReplay)(async () => {
        const rpc = await serviceClient.rpc(
          coupangReadbackRetry
            ? "sellerpilot_service_requeue_coupang_product_reply_readback_v1"
            : "sellerpilot_service_requeue_temu_after_sales_detail_v2",
          retryArguments,
        );
        return { data: rpc.data, error: rpc.error };
      }, retry);
      return NextResponse.json({
        message: coupangReadbackRetry
          ? "쿠팡 상품문의 답변 확인을 성공으로 오인하지 않고 같은 작업에 재조회 예약했습니다."
          : "Temu 상세 조회 실패를 성공으로 완료하지 않고 같은 작업에 재조회 예약했습니다.",
        completionStatus: "retry_scheduled",
        jobCompleted: false,
        providerReadSucceeded: false,
        retryScheduled: true,
        retryReceiptReplayed: receipt.replayed,
        retryCount: retry.retryCount,
        retryAfterSeconds: retry.retryAfterSeconds,
        deferredCount: retry.deferredCount,
        replayCount: retry.replayCount,
      }, {
        status: 202,
        headers: { "retry-after": String(retry.retryAfterSeconds) },
      });
    } catch (error) {
      const code = coupangReadbackRetry
        ? error instanceof Error && SAFE_COUPANG_PRODUCT_READBACK_RETRY_ERRORS.has(error.message)
          ? error.message
          : "COUPANG_PRODUCT_REPLY_READBACK_RETRY_RECORDING_FAILED"
        : safeTemuDetailRetryError(error);
      console.error(coupangReadbackRetry
        ? "Coupang product reply readback retry completion RPC failed"
        : "Temu detail retry completion RPC failed", { code });
      return NextResponse.json({ message: workerRpcErrorMessage(503), code }, { status: 503 });
    }
  }

 return null;
}
"Temu detail retry completion RPC failed", { code });
      return NextResponse.json({ message: workerRpcErrorMessage(503), code }, { status: 503 });
    }
  }

 return null;
}
