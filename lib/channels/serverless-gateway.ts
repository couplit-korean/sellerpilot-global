import { completeShippingClaim, type ShippingCompletion } from "../shipping/complete";
import { isShippingOperation } from "../shipping/contracts";
import { enqueueCurrentInquirySyncs, type ServerlessCsEnqueueSummary } from "../cs/operations/schedule";
export { serverlessCsCurrentInquiryEnqueues, serverlessCsRepairInquiryEnqueues, SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES, SERVERLESS_CS_REPAIR_MIN_INTERVAL_MINUTES, SERVERLESS_CS_ENQUEUE_CONCURRENCY, SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS } from "../cs/operations/schedule";
export type { ServerlessCsEnqueueSummary } from "../cs/operations/schedule";
import { completeCommerceClaim } from "./commerce-completion";
import { completeCsClaim, type CsCompletion } from "../cs/operations/complete";
import { isCsOperation } from "../cs/operations/contracts";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { gatewayClaimSchema, gatewayJobCompletionStatus, gatewayWorkerCompletionSchema, type GatewayClaim, type GatewayWorkerCompletion } from "./gateway-contract";
import { executeChannelOperation, writeChannelOperations, type ChannelOperationName, type ChannelOperationResult } from "./operations";
import { listingPublicationVerificationSourceSchema } from "./listing-publication-verification";
import { LazadaOAuthProviderFailureError } from "./provider-oauth-runtime";
import { type CredentialRefreshSnapshot, type CredentialRefreshTarget } from "./protocols";
import { executeServerlessGatewayProviderJob, serverlessGatewayOperationAllowed, type ServerlessGatewayExecutionHooks, type ServerlessGatewayProviderExecutionInput, type ServerlessGatewayProviderResult } from "./serverless-gateway-provider";
import { channelPriceUpdateRelease } from "./price-update-release";
import { providerRateBudgetContract, providerRateLimitEvidence } from "./provider-rate-budget";
import { recordTemuDetailRetryWithReplay } from "./cs/temu/retry-rpc";
import { SERVERLESS_STATIC_EGRESS_CHANNELS, type ServerlessStaticEgressChannel } from "./serverless-static-egress";
import { resolveRuntimeReleaseIdentity, runtimeStatusMatchesCurrentRelease } from "../internal-scheduler-auth";

export const SERVERLESS_GATEWAY_VERSION = "sellerpilot-vercel-gateway/2.0";
export const SERVERLESS_CS_GATEWAY_VERSION = SERVERLESS_GATEWAY_VERSION;
export const SERVERLESS_CS_EXECUTION_TIMEOUT_MS = 180_000;
export const SERVERLESS_GATEWAY_RETRY_SAFE_READ_TIMEOUT_MS = 50_000;
export const SERVERLESS_CS_HEARTBEAT_INTERVAL_MS = 20_000;
export const SERVERLESS_CS_DRAIN_MODE_HEADER = "x-sellerpilot-drain-mode";
export const SERVERLESS_CS_CANARY_MODE = "canary-v1";
export const SERVERLESS_CS_DRAIN_CONCURRENCY = 10;
export const SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES = 79;

const WAKE_HMAC_LABEL = "sellerpilot:channel-gateway-drain:wake:v1";
const GATEWAY_HMAC_LABEL = "sellerpilot:channel-gateway-drain:gateway:v1";
const PRIMARY_CLAIM_RPC = "sellerpilot_claim_serverless_gateway_job";
const LEGACY_CS_CLAIM_RPC = "sellerpilot_claim_serverless_cs_job";
const LEGACY_EBAY_CLAIM_RPC = "sellerpilot_claim_ebay_asq_serverless_job";
const TOUCH_RPC = "sellerpilot_touch_serverless_cs_job";
const BEGIN_CREDENTIAL_REFRESH_RPC = "sellerpilot_service_begin_serverless_cs_credential_refresh";
const PREPARE_CREDENTIAL_REFRESH_RPC = "sellerpilot_service_prepare_serverless_cs_credential_refresh";
const BEGIN_SHOPEE_TARGET_REFRESH_RPC = "sellerpilot_service_begin_cs_shopee_target_refresh_v1";
const PREPARE_SHOPEE_TARGET_REFRESH_RPC = "sellerpilot_service_prepare_cs_shopee_target_refresh_v1";
const BEGIN_LAZADA_OAUTH_PROVIDER_CALL_RPC =
  "sellerpilot_service_mark_lazada_oauth_provider_call_started";
const BEGIN_PROVIDER_MUTATION_RPC = "sellerpilot_service_begin_serverless_gateway_provider_mutation";

const LEGACY_BEGIN_PROVIDER_MUTATION_RPC = "sellerpilot_service_begin_serverless_cs_provider_mutation";
const COMPLETION_CONTEXT_RPC = "sellerpilot_service_serverless_cs_completion_context";
const PUBLICATION_VERIFICATION_SOURCE_RPC =
  "sellerpilot_service_listing_publication_verification_source";
const RESERVE_PROVIDER_RATE_BUDGET_RPC = "sellerpilot_service_reserve_provider_rate_budget_v1";
const RESERVE_PROVIDER_REQUEST_RATE_BUDGET_RPC = "sellerpilot_service_reserve_provider_request_rate_budget_v1";
const REPORT_PROVIDER_RATE_LIMIT_RPC = "sellerpilot_service_report_provider_rate_limit_v1";
const REQUEUE_TEMU_AFTER_SALES_DETAIL_RPC =
  "sellerpilot_service_requeue_temu_after_sales_detail_v2";
const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVERLESS_GATEWAY_CHANNELS = new Set<GatewayClaim["channel"]>([
  "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu",
]);
const SAFE_NAVER_EXECUTION_ERRORS = new Set([
  "NAVER_IP_NOT_ALLOWED",
  "NAVER_AUTH_FAILED",
  "NAVER_PROVIDER_UNAVAILABLE",
  "NAVER_TOKEN_EXCHANGE_FAILED",
]);
const SAFE_TEMU_DETAIL_RETRY_ERRORS = new Set([
  "TEMU_AFTER_SALES_DETAIL_RETRY_RESULT_INVALID",
  "TEMU_AFTER_SALES_DETAIL_RETRY_SCHEMA_NOT_READY",
  "TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED",
  "TEMU_AFTER_SALES_DETAIL_RETRY_RECEIPT_INVALID",
]);
const SERVERLESS_GATEWAY_RETRY_SAFE_READ_OPERATIONS = new Set<GatewayClaim["operation"]>([
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "orders.list",
  "orders.get",
  "inquiries.list",
  "diagnostic.test",
  "shops.get",
  "competitor.search",
  "listing.publication.verify",
]);

type RpcError = { code?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };
type ServerlessGatewayClaim = GatewayClaim;

export type ServerlessCsExecutionHooks = ServerlessGatewayExecutionHooks;

export type ServerlessCsProviderExecutionInput = ServerlessGatewayProviderExecutionInput;

export type ServerlessCsGatewayDependencies = {
  cronSecret?: string;
  releaseId?: string;
  vercelGitCommitSha?: string;
  requireActiveRuntime?: boolean;
  enableHistoryRepair?: boolean;
  staticEgressChannels?: readonly ServerlessStaticEgressChannel[];
  rpc?: (name: string, arguments_?: Record<string, unknown>) => Promise<RpcResult>;
  executeProvider?: (
    input: ServerlessCsProviderExecutionInput,
  ) => Promise<ServerlessGatewayProviderResult>;
  executionTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => Date;
  logError?: (stage: string, details: Record<string, string | number | boolean>) => void;
};


class GatewayOwnershipLostError extends Error {
  constructor() {
    super("gateway_ownership_lost");
    this.name = "GatewayOwnershipLostError";
  }
}

class GatewayProviderMutationDeniedError extends Error {
  constructor() {
    super("GATEWAY_PROVIDER_MUTATION_NOT_STARTED");
    this.name = "GatewayProviderMutationDeniedError";
  }
}

class GatewayProviderMutationStateUncertainError extends Error {
  constructor() {
    super("GATEWAY_PROVIDER_MUTATION_STATE_UNCERTAIN");
    this.name = "GatewayProviderMutationStateUncertainError";
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE_HEADERS });
}

function waitForProviderBudget(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function defaultLogError(stage: string, details: Record<string, string | number | boolean>) {
  console.error("serverless CS gateway failed", { stage, ...details });
}

function safeRpcCode(error: RpcError) {
  return typeof error?.code === "string" && /^[A-Z0-9_.-]{1,32}$/i.test(error.code)
    ? error.code
    : "unknown";
}

function hmacBase64Url(secret: string, label: string) {
  return createHmac("sha256", secret).update(label, "utf8").digest("base64url");
}

export function deriveServerlessCsGatewayCredentials(cronSecret: string) {
  const normalizedSecret = cronSecret.trim();
  if (!normalizedSecret) throw new Error("serverless_cs_cron_secret_missing");
  const wakeBearer = hmacBase64Url(normalizedSecret, WAKE_HMAC_LABEL);
  const gatewayToken = `spw_${hmacBase64Url(normalizedSecret, GATEWAY_HMAC_LABEL)}`;
  return {
    wakeBearer,
    gatewayTokenHash: createHash("sha256").update(gatewayToken, "utf8").digest("hex"),
  };
}

function exactBearerMatch(authorization: string | null, expectedBearer: string) {
  const actual = Buffer.from(authorization ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${expectedBearer}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isMissingRpc(error: RpcError) {
  return error?.code === "PGRST202" || error?.code === "42883";
}

function isEligibleClaim(
  claim: GatewayClaim,
  staticEgressChannels: readonly ServerlessStaticEgressChannel[] = [],
) {
  if (!serverlessGatewayOperationAllowed(claim.channel, claim.operation)) return false;
  // Shopee only actually rejected the OAuth token exchange itself from the
  // Vercel serverless source address (2026-08-30, job
  // 177eaf2e-3e28-4757-9521-16a517ee3b93). Every other Shopee operation
  // reuses the already-active, unexpired credential and is not IP-gated the
  // same way, so only oauth.exchange keeps requiring the static-egress
  // attestation; the rest of the fixed-egress channel list is unchanged.
  if (claim.channel === "shopee" && claim.operation !== "oauth.exchange") return true;
  return !(SERVERLESS_STATIC_EGRESS_CHANNELS as readonly string[]).includes(claim.channel)
    || staticEgressChannels.includes(claim.channel as ServerlessStaticEgressChannel);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeExecutionError(error: unknown, signal: AbortSignal) {
  if (signal.aborted
    || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    return "serverless_cs_runtime_timeout";
  }
  if (error instanceof LazadaOAuthProviderFailureError) {
    const safeMessage =
      `LAZADA_OAUTH_PROVIDER_FAILURE:${error.category}:${error.providerCode}`;
    if (error.message === safeMessage
      && /^LAZADA_OAUTH_PROVIDER_FAILURE:(?:SYSTEM|ISV|ISP|HTTP_4XX|HTTP_5XX|INVALID_RESPONSE):(?:INCOMPLETE_SIGNATURE|INVALID_SIGNATURE|INVALID_TIMESTAMP|INVALID_APP_KEY|INVALID_CODE|INVALID_AUTHORIZATION_CODE|ILLEGAL_ACCESS_TOKEN|MISSING_PARAMETER|INVALID_PARAMETER|API_CALL_LIMIT|MISSING_TOKEN_FIELDS|UNRECOGNIZED|5|6|30|500|501|901|1000)$/u.test(safeMessage)) {
      return safeMessage;
    }
  }
  if (error instanceof Error) {
    if (error instanceof GatewayProviderMutationDeniedError
      || error instanceof GatewayProviderMutationStateUncertainError) {
      return error.message;
    }
    if (error.message === "LISTING_PUBLICATION_LOCALIZED_CONTENT_REQUIRED") {
      return error.message;
    }
    const shippingSetupCode = error.message.match(
      /^(LISTING_SHIPPING_CONFIRMATION_REQUIRED|COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED|SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED|QOO10_UPDATE_SHIPPING_UNVERIFIED)(?::|$)/,
    );
    if (shippingSetupCode) return shippingSetupCode[1];
    if (error.message === "SHOPEE_CATEGORY_READ_TOKEN_REFRESH_BLOCKED") {
      return error.message;
    }
    if (/^SHOPEE_(?:401|403)_AUTHORIZATION_REQUIRED$/u.test(error.message)) {
      return error.message;
    }
    if (error.message === "NAVER_CREDENTIALS_MISSING") return "NAVER_AUTH_FAILED";
    if (SAFE_NAVER_EXECUTION_ERRORS.has(error.message)) {
      return error.message;
    }
    if (SAFE_TEMU_DETAIL_RETRY_ERRORS.has(error.message)) {
      return error.message;
    }
  }
  return "serverless_cs_execution_failed";
}

export function serverlessGatewayExecutionTimeoutMs(
  operation: GatewayClaim["operation"],
  configuredTimeoutMs?: number,
) {
  // Keep the retry-safe provider phase below the next minute wake. Claim and
  // completion RPCs remain separately bounded so lease/finalization fences are
  // never abandoned. Explicit OAuth, provider writes and listing lineage
  // readback keep the full lease window because an interrupted external
  // mutation must be reconciled rather than retried. If a read refreshes a
  // credential, the existing mutation hook still moves any uncertain timeout
  // to reconciliation_required.
  const operationMaximum = SERVERLESS_GATEWAY_RETRY_SAFE_READ_OPERATIONS.has(operation)
    ? SERVERLESS_GATEWAY_RETRY_SAFE_READ_TIMEOUT_MS
    : SERVERLESS_CS_EXECUTION_TIMEOUT_MS;
  const requestedTimeout = typeof configuredTimeoutMs === "number"
    && Number.isFinite(configuredTimeoutMs)
    ? Math.max(1_000, Math.floor(configuredTimeoutMs))
    : operationMaximum;
  return Math.min(operationMaximum, requestedTimeout);
}

async function callRpc(
  dependencies: ServerlessCsGatewayDependencies,
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

async function enqueueDuePublicationReviews(
  dependencies: ServerlessCsGatewayDependencies,
) {
  const result = await callRpc(
    dependencies,
    "sellerpilot_service_enqueue_due_publication_reviews",
    { p_limit: 14 },
  );
  // Missing RPCs must remain visible: an oversized identifier previously made
  // every publication review enqueue fail while this step reported success.
  return result.error
    ? { ok: false as const, code: safeRpcCode(result.error) }
    : { ok: true as const };
}

async function claimOneJob(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
) {
  const arguments_ = {
    p_token_hash: gatewayTokenHash,
    p_worker_version: SERVERLESS_CS_GATEWAY_VERSION,
  };
  const primary = await callRpc(dependencies, PRIMARY_CLAIM_RPC, arguments_);
  if (!primary.error || !isMissingRpc(primary.error)) return primary;
  const legacyCs = await callRpc(dependencies, LEGACY_CS_CLAIM_RPC, arguments_);
  if (!legacyCs.error || !isMissingRpc(legacyCs.error)) return legacyCs;
  return callRpc(dependencies, LEGACY_EBAY_CLAIM_RPC, arguments_);
}

async function touchClaim(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
) {
  const touched = await callRpc(dependencies, TOUCH_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_worker_version: SERVERLESS_CS_GATEWAY_VERSION,
  });
  if (touched.error) throw new Error("gateway_heartbeat_unavailable");
  if (touched.data !== "running") throw new GatewayOwnershipLostError();
}

function createClaimHeartbeat(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
) {
  let heartbeatError: unknown = null;
  let heartbeatPromise: Promise<void> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleTouch = () => {
    if (heartbeatPromise || heartbeatError) return;
    heartbeatPromise = touchClaim(dependencies, gatewayTokenHash, job)
      .catch((error) => {
        heartbeatError = error;
      })
      .finally(() => {
        heartbeatPromise = null;
      });
  };

  return {
    async start() {
      await touchClaim(dependencies, gatewayTokenHash, job);
      heartbeatTimer = setInterval(
        scheduleTouch,
        dependencies.heartbeatIntervalMs ?? SERVERLESS_CS_HEARTBEAT_INTERVAL_MS,
      );
      heartbeatTimer.unref?.();
    },
    async assertHealthy() {
      if (heartbeatPromise) await heartbeatPromise;
      if (heartbeatError) throw heartbeatError;
    },
    async stop() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (heartbeatPromise) await heartbeatPromise;
      if (heartbeatError) throw heartbeatError;
    },
  };
}

async function beginCredentialMutation(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
  target?: CredentialRefreshTarget,
) {
  const begun = await callRpc(dependencies,
    target?.channel === "shopee" ? BEGIN_SHOPEE_TARGET_REFRESH_RPC : BEGIN_CREDENTIAL_REFRESH_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    ...(target?.channel === "shopee" ? {
      p_target_type: target.targetType,
      p_target_id: target.targetId,
    } : {}),
  });
  if (begun.error) throw new Error("gateway_credential_fence_unavailable");
  if (target?.channel === "shopee") {
    const value = recordValue(begun.data);
    if (value?.contract !== "sellerpilot-shopee-target-refresh-claim/1") {
      throw new GatewayOwnershipLostError();
    }
    if (value.status === "busy") throw new Error("SHOPEE_TARGET_REFRESH_BUSY");
    if (value.status !== "acquired" && value.status !== "reused") {
      throw new GatewayOwnershipLostError();
    }
  } else if (begun.data !== true) {
    throw new GatewayOwnershipLostError();
  }
}

async function stageCredentialRefresh(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
  refresh: CredentialRefreshSnapshot,
) {
  const target = refresh.target;
  const staged = await callRpc(dependencies,
    target?.channel === "shopee" ? PREPARE_SHOPEE_TARGET_REFRESH_RPC : PREPARE_CREDENTIAL_REFRESH_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    ...(target?.channel === "shopee" ? {
      p_target_type: target.targetType,
      p_target_id: target.targetId,
      p_candidate_payload: refresh.payload,
    } : { p_secret_payload: refresh.payload }),
    p_expires_at: refresh.expiresAt,
    p_recovery_only: refresh.recoveryOnly === true,
    p_oauth_complete: refresh.oauthComplete === true,
  });
  if (staged.error) throw new Error("gateway_credential_stage_unavailable");
  const value = recordValue(staged.data);
  const prepared = value?.status === "prepared"
    && typeof value.credential_id === "string"
    && UUID_PATTERN.test(value.credential_id);
  const recoveryPreserved = value?.status === "recovery_preserved" && refresh.recoveryOnly === true;
  if (!prepared && !recoveryPreserved) throw new GatewayOwnershipLostError();
}

async function beginProviderMutation(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
) {
  const arguments_ = {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  };
  let begun = await callRpc(dependencies, BEGIN_PROVIDER_MUTATION_RPC, arguments_);
  if (begun.error && isMissingRpc(begun.error)) {
    begun = await callRpc(dependencies, LEGACY_BEGIN_PROVIDER_MUTATION_RPC, arguments_);
  }
  if (begun.error) throw new Error("gateway_provider_fence_unavailable");
  if (begun.data !== true) {
    await touchClaim(dependencies, gatewayTokenHash, job);
    const contextResult = await callRpc(dependencies, COMPLETION_CONTEXT_RPC, {
      p_token_hash: gatewayTokenHash,
      p_job_id: job.id,
      p_claim_token: job.claim_token,
    });
    if (contextResult.error) throw new GatewayProviderMutationStateUncertainError();
    const context = recordValue(contextResult.data);
    if (!context
      || context.status !== "running"
      || context.channel !== job.channel
      || context.operation !== job.operation) {
      throw new GatewayOwnershipLostError();
    }
    if (context.publication_verification_boundary != null) {
      throw new GatewayProviderMutationStateUncertainError();
    }
    throw new GatewayProviderMutationDeniedError();
  }
}

async function beginLazadaOAuthProviderCall(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
) {
  if (job.channel !== "lazada" || job.operation !== "oauth.exchange") {
    throw new Error("lazada_oauth_provider_call_fence_invalid");
  }
  const begun = await callRpc(dependencies, BEGIN_LAZADA_OAUTH_PROVIDER_CALL_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  if (begun.error) throw new Error("lazada_oauth_provider_call_fence_unavailable");
  if (begun.data !== true) throw new GatewayOwnershipLostError();
}

async function hydrateListingPublicationVerificationJob(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
) {
  if (job.operation !== "listing.publication.verify") return job;
  const sourceResult = await callRpc(dependencies, PUBLICATION_VERIFICATION_SOURCE_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  const source = listingPublicationVerificationSourceSchema.safeParse(sourceResult.data);
  if (sourceResult.error
    || !source.success
    || source.data.verificationJobId !== job.id) {
    throw new Error("LISTING_PUBLICATION_VERIFY_SOURCE_CONTEXT_UNAVAILABLE");
  }
  const argumentsValue = recordValue(job.request.arguments);
  if (!argumentsValue) {
    throw new Error("LISTING_PUBLICATION_VERIFY_SOURCE_CONTEXT_UNAVAILABLE");
  }
  return {
    ...job,
    request: {
      ...job.request,
      arguments: {
        ...argumentsValue,
        sellerpilotPublicationSource: source.data,
      },
    },
  } satisfies ServerlessGatewayClaim;
}

export async function executeServerlessCsProviderJob(
  input: ServerlessCsProviderExecutionInput,
  operationExecutor: typeof executeChannelOperation = executeChannelOperation,
): Promise<ServerlessGatewayProviderResult> {
  return executeServerlessGatewayProviderJob(input, operationExecutor);
}

type CompletionResult = "completed" | "completed_reconciliation" | "ownership_lost" | "unavailable";

async function completeClaim(dependencies: ServerlessCsGatewayDependencies, gatewayTokenHash: string, job: ServerlessGatewayClaim, input: GatewayWorkerCompletion): Promise<CompletionResult> {
  if (isShippingOperation(job.operation)) return completeShippingClaim(dependencies, gatewayTokenHash, job, input as ShippingCompletion);
  if (!isCsOperation(job.operation)) return completeCommerceClaim(dependencies, gatewayTokenHash, job, input);
  const parsed = gatewayWorkerCompletionSchema.safeParse(input);
  if (!parsed.success || parsed.data.status === "succeeded" && !isCsOperation(parsed.data.result.operation)) return "ownership_lost";
  return completeCsClaim(dependencies, gatewayTokenHash, job, parsed.data as CsCompletion);
}

function terminalResponse(
  status: GatewayWorkerCompletion["status"],
  job: ServerlessGatewayClaim,
) {
  return jsonResponse({
    ok: status === "succeeded",
    status,
    claimed: 1,
    processed: 1,
    jobId: job.id,
    channel: job.channel,
    operation: job.operation,
  });
}

async function finishClaim(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessGatewayClaim,
  completion: GatewayWorkerCompletion,
  logError: (stage: string, details: Record<string, string | number | boolean>) => void,
) {
  const completed = await completeClaim(dependencies, gatewayTokenHash, job, completion);
  if (completed === "completed" || completed === "completed_reconciliation") {
    return terminalResponse(
      completed === "completed_reconciliation" ? "reconciliation_required" : completion.status,
      job,
    );
  }
  if (completed === "ownership_lost") {
    logError("complete_ownership", { status: 409, channel: job.channel, operation: job.operation });
    return jsonResponse({ message: "채널 작업 소유권이 변경되었습니다." }, 409);
  }
  logError("complete", { status: 503, channel: job.channel, operation: job.operation });
  return jsonResponse({ message: "채널 작업 완료 여부를 확인하지 못했습니다." }, 503);
}

export async function runOneServerlessCsGatewayJob(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
) {
  const logError = dependencies.logError ?? defaultLogError;
  const claimed = await claimOneJob(dependencies, gatewayTokenHash);
  if (claimed.error) {
    logError("claim", { status: 503, code: safeRpcCode(claimed.error) });
    return jsonResponse({ message: "채널 작업을 가져오지 못했습니다." }, 503);
  }
  if (claimed.data == null) {
    return jsonResponse({ ok: true, status: "idle", claimed: 0, processed: 0 });
  }

  const parsed = gatewayClaimSchema.safeParse(claimed.data);
  if (!parsed.success) {
    logError("claim_contract", { status: 503 });
    return jsonResponse({ message: "채널 작업 계약을 확인하지 못했습니다." }, 503);
  }

  const job = parsed.data;
  if (job.operation === "price.update") {
    const priceRelease = channelPriceUpdateRelease(job.channel);
    if (!priceRelease.available) {
      return finishClaim(
        dependencies,
        gatewayTokenHash,
        job,
        {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "failed",
          error: `PRICE_UPDATE_RELEASE_BLOCKED: ${priceRelease.reason}`,
        },
        logError,
      );
    }
  }
  if (!isEligibleClaim(job, dependencies.staticEgressChannels)) {
    logError("claim_scope", { status: 503, channel: job.channel, operation: job.operation });
    return jsonResponse({ message: "서버리스 채널 작업 범위를 확인하지 못했습니다." }, 503);
  }

  const rateReservation = await callRpc(dependencies, RESERVE_PROVIDER_RATE_BUDGET_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  const rateReceipt = recordValue(rateReservation.data);
  if (rateReservation.error
    || rateReceipt?.contract !== providerRateBudgetContract
    || !["reserved", "deferred"].includes(String(rateReceipt.status))) {
    logError("rate_budget", { status: 503, channel: job.channel, operation: job.operation });
    return jsonResponse({ message: "채널 호출 예산을 확인하지 못했습니다." }, 503);
  }
  if (rateReceipt.status === "deferred") {
    return jsonResponse({
      ok: true,
      status: "idle",
      claimed: 1,
      processed: 0,
      deferred: 1,
      jobId: job.id,
      channel: job.channel,
      operation: job.operation,
      retryAfterSeconds: rateReceipt.retryAfterSeconds,
    });
  }

  const heartbeat = createClaimHeartbeat(dependencies, gatewayTokenHash, job);
  const runtimeSignal = AbortSignal.timeout(serverlessGatewayExecutionTimeoutMs(
    job.operation,
    dependencies.executionTimeoutMs,
  ));
  let heartbeatStopped = false;
  let externalMutationStarted = false;
  let providerMutationFenced = false;
  let lazadaOAuthProviderCallFenced = false;
  let credentialMutationInFlight = false;
  let credentialRefresh: CredentialRefreshSnapshot | undefined;
  let initialProviderRequestReservationAvailable = true;

  const assertLeaseHealthy = () => heartbeat.assertHealthy();
  const hooks: ServerlessCsExecutionHooks = {
    assertLeaseHealthy,
    reserveProviderRequest: async () => {
      await assertLeaseHealthy();
      if (initialProviderRequestReservationAvailable) {
        initialProviderRequestReservationAvailable = false;
        return;
      }
      for (; ;) {
        const reservation = await callRpc(dependencies, RESERVE_PROVIDER_REQUEST_RATE_BUDGET_RPC, {
          p_token_hash: gatewayTokenHash,
          p_job_id: job.id,
          p_claim_token: job.claim_token,
        });
        const receipt = recordValue(reservation.data);
        if (reservation.error
          || !receipt
          || receipt.contract !== "sellerpilot-provider-request-rate-budget/1"
          || !["reserved", "waiting"].includes(String(receipt.status))) {
          throw new Error("PROVIDER_REQUEST_RATE_BUDGET_FAILED");
        }
        if (receipt.status === "reserved") return;
        const retryAfterMs = Number(receipt.retryAfterMs);
        if (!Number.isInteger(retryAfterMs) || retryAfterMs < 1 || retryAfterMs > 60_000) {
          throw new Error("PROVIDER_REQUEST_RATE_BUDGET_INVALID_WAIT");
        }
        await waitForProviderBudget(retryAfterMs, runtimeSignal);
        await assertLeaseHealthy();
      }
    },
    beginCredentialMutation: async (target) => {
      await assertLeaseHealthy();
      await beginCredentialMutation(dependencies, gatewayTokenHash, job, target);
      await assertLeaseHealthy();
      externalMutationStarted = true;
      credentialMutationInFlight = true;
    },
    beginOAuthProviderCall: async () => {
      await assertLeaseHealthy();
      if (!lazadaOAuthProviderCallFenced) {
        await beginLazadaOAuthProviderCall(dependencies, gatewayTokenHash, job);
        lazadaOAuthProviderCallFenced = true;
      }
      await assertLeaseHealthy();
      externalMutationStarted = true;
    },
    stageCredentialRefresh: async (refresh) => {
      credentialRefresh = refresh;
      await assertLeaseHealthy();
      await stageCredentialRefresh(dependencies, gatewayTokenHash, job, refresh);
      await assertLeaseHealthy();
      credentialMutationInFlight = false;
    },
    beginProviderMutation: async (options) => {
      await assertLeaseHealthy();
      // The owning provider can require a fresh durable fence for each write.
      if (options?.fresh || !providerMutationFenced) {
        await beginProviderMutation(dependencies, gatewayTokenHash, job);
        providerMutationFenced = true;
      }
      await assertLeaseHealthy();
      externalMutationStarted = true;
    },
  };

  const stopHeartbeat = async () => {
    if (heartbeatStopped) return;
    heartbeatStopped = true;
    await heartbeat.stop();
  };

  try {
    await heartbeat.start();
    await assertLeaseHealthy();
    const executionJob = await hydrateListingPublicationVerificationJob(
      dependencies,
      gatewayTokenHash,
      job,
    );
    await assertLeaseHealthy();
    const result = await (dependencies.executeProvider ?? executeServerlessCsProviderJob)({
      job: executionJob,
      signal: runtimeSignal,
      hooks,
    });
    const rateLimit = "steps" in result && Array.isArray(result.steps)
      ? providerRateLimitEvidence(result as ChannelOperationResult, dependencies.now?.() ?? new Date())
      : null;
    if (rateLimit) {
      await stopHeartbeat();
      const reported = await callRpc(dependencies, REPORT_PROVIDER_RATE_LIMIT_RPC, {
        p_token_hash: gatewayTokenHash,
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_retry_after_seconds: rateLimit.retryAfterSeconds,
      });
      const reportReceipt = recordValue(reported.data);
      if (reported.error
        || reportReceipt?.contract !== providerRateBudgetContract
        || !["deferred", "recorded"].includes(String(reportReceipt.status))) {
        throw new Error("PROVIDER_RATE_LIMIT_RECORDING_FAILED");
      }
      if (reportReceipt.status === "deferred") {
        return jsonResponse({
          ok: true,
          status: "idle",
          claimed: 1,
          processed: 0,
          deferred: 1,
          jobId: job.id,
          channel: job.channel,
          operation: job.operation,
          retryAfterSeconds: reportReceipt.retryAfterSeconds,
        });
      }
    }
    const retryContinuation = "retryContinuation" in result
      ? result.retryContinuation
      : undefined;
    if (retryContinuation) {
      if (result.ok
        || result.channel !== "temu"
        || result.operation !== "inquiries.list") {
        throw new Error("TEMU_AFTER_SALES_DETAIL_RETRY_RESULT_INVALID");
      }
      await assertLeaseHealthy();
      await stopHeartbeat();
      const retryRpcArguments = {
        p_token_hash: gatewayTokenHash,
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_retry_arguments: retryContinuation.arguments,
        p_retry_count: retryContinuation.retryCount,
        p_retry_after_seconds: retryContinuation.retryAfterSeconds,
        p_deferred_count: retryContinuation.deferredCount,
        p_replay_count: retryContinuation.replayCount,
        p_provider_status: retryContinuation.providerStatus,
      };
      const receipt = await recordTemuDetailRetryWithReplay(
        () => callRpc(dependencies, REQUEUE_TEMU_AFTER_SALES_DETAIL_RPC, retryRpcArguments),
        retryContinuation,
      );
      // The provider read failed. A durable retry is scheduled, but neither
      // this execution nor the job is reported through a success/202 path.
      return jsonResponse({
        ok: false,
        status: "failed",
        claimed: 1,
        processed: 0,
        deferred: 1,
        retryScheduled: true,
        retryState: "provider_read_failed",
        retryReceiptReplayed: receipt.replayed,
        jobId: job.id,
        channel: job.channel,
        operation: job.operation,
        providerStatus: retryContinuation.providerStatus,
        retryCount: retryContinuation.retryCount,
        retryAfterSeconds: retryContinuation.retryAfterSeconds,
        deferredCount: retryContinuation.deferredCount,
        replayCount: retryContinuation.replayCount,
      }, 503);
    }
    const resultSteps = "steps" in result && Array.isArray(result.steps)
      ? result.steps
      : [];
    const observedCompletionStatus = gatewayJobCompletionStatus(
      result.operation,
      result.ok,
      resultSteps,
    );
    const completionStatus = result.operation === "diagnostic.test"
      ? "succeeded"
      : observedCompletionStatus === "reconciliation_required"
        ? observedCompletionStatus
        : !result.ok && !writeChannelOperations.has(result.operation as ChannelOperationName)
          ? "failed"
          : observedCompletionStatus;
    const completionInput = completionStatus === "failed"
      ? {
        jobId: job.id,
        claimToken: job.claim_token,
        status: "failed",
        error: result.safeMessage,
        ...((job.channel === "elevenst" && result.channel === "elevenst"
          || job.channel === "ebay" && result.channel === "ebay" && "steps" in result && result.steps.length === 1 && result.steps[0]?.name === "ebay-case-dispute-history-page")
          && result.operation === "inquiries.list"
          ? { result: result as ChannelOperationResult }
          : {}),
        ...(credentialRefresh ? { credentialRefresh } : {}),
      }
      : completionStatus === "reconciliation_required"
        ? {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "reconciliation_required",
          error: result.safeMessage,
          result: result as ChannelOperationResult,
          ...(credentialRefresh ? { credentialRefresh } : {}),
        }
        : {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "succeeded",
          result,
          ...(credentialRefresh ? { credentialRefresh } : {}),
        };
    const parsedCompletion = gatewayWorkerCompletionSchema.safeParse(completionInput);
    if (!parsedCompletion.success) throw new Error("SERVERLESS_GATEWAY_RESULT_CONTRACT_INVALID");
    const completion = parsedCompletion.data;
    await assertLeaseHealthy();
    await stopHeartbeat();
    return finishClaim(dependencies, gatewayTokenHash, job, completion, logError);
  } catch (error) {
    let effectiveError = error;
    if (!heartbeatStopped) {
      try {
        await stopHeartbeat();
      } catch (heartbeatError) {
        effectiveError = heartbeatError;
      }
    }
    if (effectiveError instanceof GatewayOwnershipLostError) {
      logError("ownership", { status: 409, channel: job.channel, operation: job.operation });
      return jsonResponse({ message: "채널 작업 소유권이 변경되었습니다." }, 409);
    }
    const errorReason = safeExecutionError(effectiveError, runtimeSignal);
    const providerMutationStateUncertain =
      effectiveError instanceof GatewayProviderMutationStateUncertainError;
    const retryableLineageReadback = job.operation === "listing.lineage.verify"
      && effectiveError instanceof Error
      && /LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR|fetch failed|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_|aborted|network/i.test(effectiveError.message);
    const completion: GatewayWorkerCompletion =
      externalMutationStarted || providerMutationStateUncertain || retryableLineageReadback
        ? {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "reconciliation_required",
          error: errorReason,
          ...(!credentialMutationInFlight && credentialRefresh ? { credentialRefresh } : {}),
        }
        : {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "failed",
          error: errorReason,
        };
    logError("execute", {
      status: externalMutationStarted ? 409 : 503,
      channel: job.channel,
      operation: job.operation,
      reason: errorReason,
    });
    return finishClaim(dependencies, gatewayTokenHash, job, completion, logError);
  }
}

type SafeDrainWorkerSummary = {
  httpStatus: number;
  ok: boolean;
  status: "idle" | "succeeded" | "failed" | "reconciliation_required" | "unavailable";
  claimed: number;
  processed: number;
  jobId?: string;
  channel?: ServerlessGatewayClaim["channel"];
  operation?: ServerlessGatewayClaim["operation"];
};

const SAFE_DRAIN_WORKER_STATUSES = new Set<SafeDrainWorkerSummary["status"]>([
  "idle",
  "succeeded",
  "failed",
  "reconciliation_required",
  "unavailable",
]);

async function safeDrainWorkerSummary(response: Response): Promise<SafeDrainWorkerSummary> {
  const body = recordValue(await response.json().catch(() => null));
  const status = typeof body?.status === "string"
    && SAFE_DRAIN_WORKER_STATUSES.has(body.status as SafeDrainWorkerSummary["status"])
    ? body.status as SafeDrainWorkerSummary["status"]
    : "unavailable";
  const channel = typeof body?.channel === "string"
    && SERVERLESS_GATEWAY_CHANNELS.has(body.channel as GatewayClaim["channel"])
    ? body.channel as ServerlessGatewayClaim["channel"]
    : undefined;
  const operation = typeof body?.operation === "string"
    && channel
    && serverlessGatewayOperationAllowed(channel, body.operation as GatewayClaim["operation"])
    ? body.operation as ServerlessGatewayClaim["operation"]
    : undefined;
  const jobId = typeof body?.jobId === "string" && UUID_PATTERN.test(body.jobId)
    ? body.jobId
    : undefined;
  return {
    httpStatus: response.status,
    ok: body?.ok === true,
    status,
    claimed: body?.claimed === 1 ? 1 : 0,
    processed: body?.processed === 1 ? 1 : 0,
    ...(jobId ? { jobId } : {}),
    ...(channel ? { channel } : {}),
    ...(operation ? { operation } : {}),
  };
}

function aggregateDrainResponse(
  enqueue: ServerlessCsEnqueueSummary,
  workers: SafeDrainWorkerSummary[],
) {
  const claimed = workers.reduce((total, worker) => total + worker.claimed, 0);
  const processed = workers.reduce((total, worker) => total + worker.processed, 0);
  const workerHttpFailure = workers.some((worker) => worker.httpStatus >= 400);
  const processedStatuses = workers
    .filter((worker) => worker.processed === 1)
    .map((worker) => worker.status);
  const uniqueStatuses = [...new Set(processedStatuses)];
  const status = workerHttpFailure
    ? processed > 0 ? "mixed" : "unavailable"
    : processed === 0
      ? "idle"
      : uniqueStatuses.length === 1
        ? uniqueStatuses[0]
        : "mixed";
  const workerResponseStatus = workers.some((worker) => worker.httpStatus >= 500)
    ? 503
    : workers.some((worker) => worker.httpStatus === 409)
      ? 409
      : workers.some((worker) => worker.httpStatus >= 400)
        ? 400
        : 200;
  const allEnqueuesFailed = enqueue.attempted > 0
    && enqueue.failed === enqueue.attempted;
  const responseStatus = allEnqueuesFailed ? 503 : workerResponseStatus;
  const enqueueHealthy = enqueue.failed === 0
    && enqueue.reconnectRequired === 0
    && enqueue.reconciliationRequired === 0
    && enqueue.fixedEgressRequired === 0;
  const jobs = workers
    .filter((worker) => worker.claimed === 1)
    .map(({ status: jobStatus, jobId, channel, operation }) => ({
      status: jobStatus,
      ...(jobId ? { jobId } : {}),
      ...(channel ? { channel } : {}),
      ...(operation ? { operation } : {}),
    }));
  return jsonResponse({
    ok: responseStatus < 400
      && enqueueHealthy
      && processedStatuses.every((workerStatus) => workerStatus === "succeeded"),
    status,
    claimed,
    processed,
    capacity: SERVERLESS_CS_DRAIN_CONCURRENCY,
    enqueue,
    ...(!enqueueHealthy ? { needsAttention: true } : {}),
    jobs,
  }, responseStatus);
}

export async function runServerlessCsGatewayDrain(
  request: Request,
  dependencies: ServerlessCsGatewayDependencies,
) {
  const cronSecret = dependencies.cronSecret?.trim() ?? "";
  if (cronSecret.length < 16 || !dependencies.rpc) {
    return jsonResponse({ message: "채널 작업 실행 환경이 설정되지 않았습니다." }, 503);
  }
  const credentials = deriveServerlessCsGatewayCredentials(cronSecret);
  if (!exactBearerMatch(request.headers.get("authorization"), credentials.wakeBearer)) {
    return jsonResponse({ message: "채널 작업 실행 인증이 필요합니다." }, 401);
  }
  const requestedMode = request.headers.get(SERVERLESS_CS_DRAIN_MODE_HEADER);
  if (requestedMode === SERVERLESS_CS_CANARY_MODE) {
    const releaseIdentity = resolveRuntimeReleaseIdentity({
      sellerpilotReleaseSha: dependencies.releaseId,
      vercelGitCommitSha: dependencies.vercelGitCommitSha,
    });
    return jsonResponse({
      ok: true,
      status: "canary",
      claimed: 0,
      processed: 0,
      ...(releaseIdentity.status === "valid"
        ? { release: releaseIdentity.release }
        : {}),
      ...(releaseIdentity.status === "conflict"
        ? { releaseError: "runtime_release_conflict" }
        : {}),
    });
  }
  if (requestedMode !== null) {
    return jsonResponse({ message: "채널 작업 실행 모드를 확인하지 못했습니다." }, 400);
  }
  if (dependencies.requireActiveRuntime) {
    const runtimeStatus = await callRpc(
      dependencies,
      "sellerpilot_service_serverless_cs_wakeup_status",
      {},
    );
    if (runtimeStatus.error
      || !runtimeStatusMatchesCurrentRelease(runtimeStatus.data, {
        sellerpilotReleaseSha: dependencies.releaseId,
        vercelGitCommitSha: dependencies.vercelGitCommitSha,
      })) {
      return jsonResponse({ message: "서버 일정이 활성화되지 않았습니다." }, 503);
    }
  }
  const logError = dependencies.logError ?? defaultLogError;
  const publicationReviews = await enqueueDuePublicationReviews(dependencies);
  if (!publicationReviews.ok) {
    logError("publication_review_enqueue", {
      status: 503,
      code: publicationReviews.code,
    });
  }
  const enqueue = await enqueueCurrentInquirySyncs(dependencies);
  if (enqueue.failed > 0) {
    logError("enqueue", {
      status: 503,
      failed: enqueue.failed,
      total: enqueue.attempted,
    });
  }
  const workerResponses = await Promise.all(
    Array.from(
      { length: SERVERLESS_CS_DRAIN_CONCURRENCY },
      () => runOneServerlessCsGatewayJob(dependencies, credentials.gatewayTokenHash),
    ),
  );
  const workers = await Promise.all(workerResponses.map(safeDrainWorkerSummary));
  return aggregateDrainResponse(enqueue, workers);
}
