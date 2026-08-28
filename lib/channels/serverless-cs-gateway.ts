import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ebayAsqOperationMarketplaceId } from "./ebay-asq";
import {
  gatewayClaimSchema,
  gatewayJobCompletionStatus,
  gatewayWorkerCompletionSchema,
  type GatewayClaim,
  type GatewayWorkerCompletion,
} from "./gateway-contract";
import { inquirySyncRequests, normalizeChannelInquiries } from "./inquiry-sync";
import {
  executeChannelOperation,
  type ChannelOperationResult,
} from "./operations";
import {
  ensureEbayAccessToken,
  runWithChannelRequestSignal,
  type CredentialRefreshSnapshot,
} from "./protocols";
import {
  SERVERLESS_STATIC_EGRESS_CHANNELS,
  type ServerlessStaticEgressChannel,
} from "./serverless-static-egress";

export const SERVERLESS_CS_GATEWAY_VERSION = "sellerpilot-vercel-cs-gateway/1.0";
export const SERVERLESS_CS_EXECUTION_TIMEOUT_MS = 180_000;
export const SERVERLESS_CS_HEARTBEAT_INTERVAL_MS = 20_000;
export const SERVERLESS_CS_DRAIN_MODE_HEADER = "x-sellerpilot-drain-mode";
export const SERVERLESS_CS_CANARY_MODE = "canary-v1";
export const SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES = 5;
export const SERVERLESS_CS_ENQUEUE_CONCURRENCY = 3;
export const SERVERLESS_CS_DRAIN_CONCURRENCY = 2;
export const SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS = [
  "qoo10",
  "coupang",
  "smartstore",
  "ebay",
] as const;

const WAKE_HMAC_LABEL = "sellerpilot:channel-gateway-drain:wake:v1";
const GATEWAY_HMAC_LABEL = "sellerpilot:channel-gateway-drain:gateway:v1";
const PRIMARY_CLAIM_RPC = "sellerpilot_claim_serverless_cs_job";
const LEGACY_EBAY_CLAIM_RPC = "sellerpilot_claim_ebay_asq_serverless_job";
const TOUCH_RPC = "sellerpilot_touch_serverless_cs_job";
const BEGIN_CREDENTIAL_REFRESH_RPC = "sellerpilot_service_begin_serverless_cs_credential_refresh";
const PREPARE_CREDENTIAL_REFRESH_RPC = "sellerpilot_service_prepare_serverless_cs_credential_refresh";
const BEGIN_PROVIDER_MUTATION_RPC = "sellerpilot_service_begin_serverless_cs_provider_mutation";
const COMPLETION_CONTEXT_RPC = "sellerpilot_service_serverless_cs_completion_context";
const COMPLETE_TRANSACTION_RPC = "sellerpilot_service_complete_serverless_cs_transaction";
const SANITIZED_INQUIRY_LIST_MARKER = "normalized_inquiries_v1";
const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVERLESS_CS_CHANNELS = new Set<string>(SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS);
const SERVERLESS_CS_OPERATIONS = new Set(["inquiries.list", "inquiries.reply"]);
const SAFE_NAVER_EXECUTION_ERRORS = new Set([
  "NAVER_IP_NOT_ALLOWED",
  "NAVER_AUTH_FAILED",
  "NAVER_PROVIDER_UNAVAILABLE",
  "NAVER_TOKEN_EXCHANGE_FAILED",
]);

type RpcError = { code?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };
type ServerlessCsClaim = GatewayClaim & {
  channel: (typeof SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS)[number];
  operation: "inquiries.list" | "inquiries.reply";
};

export type ServerlessCsExecutionHooks = {
  beginCredentialMutation: () => Promise<void>;
  stageCredentialRefresh: (refresh: CredentialRefreshSnapshot) => Promise<void>;
  beginProviderMutation: () => Promise<void>;
  assertLeaseHealthy: () => Promise<void>;
};

export type ServerlessCsProviderExecutionInput = {
  job: ServerlessCsClaim;
  signal: AbortSignal;
  hooks: ServerlessCsExecutionHooks;
};

export type ServerlessCsGatewayDependencies = {
  cronSecret?: string;
  staticEgressChannels?: readonly ServerlessStaticEgressChannel[];
  rpc?: (name: string, arguments_?: Record<string, unknown>) => Promise<RpcResult>;
  executeProvider?: (input: ServerlessCsProviderExecutionInput) => Promise<ChannelOperationResult>;
  executionTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => Date;
  logError?: (stage: string, details: Record<string, string | number | boolean>) => void;
};

export type ServerlessCsEnqueueSummary = {
  attempted: number;
  queued: number;
  pending: number;
  notConnected: number;
  reconnectRequired: number;
  reconciliationRequired: number;
  fixedEgressRequired: number;
  failed: number;
};

class GatewayOwnershipLostError extends Error {
  constructor() {
    super("gateway_ownership_lost");
    this.name = "GatewayOwnershipLostError";
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE_HEADERS });
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
): claim is ServerlessCsClaim {
  if (!SERVERLESS_CS_CHANNELS.has(claim.channel)
      || !SERVERLESS_CS_OPERATIONS.has(claim.operation)) return false;
  return !(SERVERLESS_STATIC_EGRESS_CHANNELS as readonly string[]).includes(claim.channel)
    || staticEgressChannels.includes(claim.channel as ServerlessStaticEgressChannel);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function operationArguments(job: ServerlessCsClaim) {
  const value = job.request.arguments;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeExecutionError(error: unknown, signal: AbortSignal) {
  if (signal.aborted
      || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    return "serverless_cs_runtime_timeout";
  }
  if (error instanceof Error) {
    if (error.message === "NAVER_CREDENTIALS_MISSING") return "NAVER_AUTH_FAILED";
    if (SAFE_NAVER_EXECUTION_ERRORS.has(error.message)) {
      return error.message;
    }
  }
  return "serverless_cs_execution_failed";
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

export function serverlessCsCurrentInquiryEnqueues(
  now = new Date(),
  staticEgressChannels: readonly ServerlessStaticEgressChannel[] = [],
) {
  const enabledStaticEgress = new Set(staticEgressChannels);
  return SERVERLESS_CS_CURRENT_INQUIRY_CHANNELS
    .filter((channel) => !(SERVERLESS_STATIC_EGRESS_CHANNELS as readonly string[]).includes(channel)
      || enabledStaticEgress.has(channel as ServerlessStaticEgressChannel))
    .flatMap((channel) =>
    inquirySyncRequests(channel, now).map((payload) => ({
      channel,
      operation: "inquiries.list" as const,
      payload,
    })));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type PeriodicEnqueueStatus =
  | "queued"
  | "already_pending"
  | "not_connected"
  | "reconnect_required"
  | "reconciliation_required"
  | "fixed_egress_required"
  | "failed";

const PERIODIC_ENQUEUE_STATUSES = new Set<PeriodicEnqueueStatus>([
  "queued",
  "already_pending",
  "not_connected",
  "reconnect_required",
  "reconciliation_required",
  "fixed_egress_required",
  "failed",
]);

async function enqueueCurrentInquirySyncs(
  dependencies: ServerlessCsGatewayDependencies,
): Promise<ServerlessCsEnqueueSummary> {
  const requests = serverlessCsCurrentInquiryEnqueues(
    dependencies.now?.() ?? new Date(),
    dependencies.staticEgressChannels,
  );
  const statuses = await mapWithConcurrency(
    requests,
    SERVERLESS_CS_ENQUEUE_CONCURRENCY,
    async ({ channel, operation, payload }): Promise<PeriodicEnqueueStatus> => {
      const result = await callRpc(
        dependencies,
        "sellerpilot_service_enqueue_periodic_sync",
        {
          p_channel: channel,
          p_operation: operation,
          p_request_payload: payload,
          p_min_interval_minutes: SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES,
        },
      );
      if (result.error) return "failed";
      const status = recordValue(result.data)?.status;
      return typeof status === "string"
        && PERIODIC_ENQUEUE_STATUSES.has(status as PeriodicEnqueueStatus)
        ? status as PeriodicEnqueueStatus
        : "failed";
    },
  );
  return {
    attempted: requests.length,
    queued: statuses.filter((status) => status === "queued").length,
    pending: statuses.filter((status) => status === "already_pending").length,
    notConnected: statuses.filter((status) => status === "not_connected").length,
    reconnectRequired: statuses.filter((status) => status === "reconnect_required").length,
    reconciliationRequired: statuses.filter((status) => status === "reconciliation_required").length,
    fixedEgressRequired: statuses.filter((status) => status === "fixed_egress_required").length,
    failed: statuses.filter((status) => status === "failed").length,
  };
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
  return callRpc(dependencies, LEGACY_EBAY_CLAIM_RPC, arguments_);
}

async function touchClaim(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessCsClaim,
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
  job: ServerlessCsClaim,
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
  job: ServerlessCsClaim,
) {
  const begun = await callRpc(dependencies, BEGIN_CREDENTIAL_REFRESH_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  if (begun.error) throw new Error("gateway_credential_fence_unavailable");
  if (begun.data !== true) throw new GatewayOwnershipLostError();
}

async function stageCredentialRefresh(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessCsClaim,
  refresh: CredentialRefreshSnapshot,
) {
  const staged = await callRpc(dependencies, PREPARE_CREDENTIAL_REFRESH_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_secret_payload: refresh.payload,
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
  job: ServerlessCsClaim,
) {
  const begun = await callRpc(dependencies, BEGIN_PROVIDER_MUTATION_RPC, {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  });
  if (begun.error) throw new Error("gateway_provider_fence_unavailable");
  if (begun.data !== true) throw new GatewayOwnershipLostError();
}

export async function executeServerlessCsProviderJob(
  input: ServerlessCsProviderExecutionInput,
  operationExecutor: typeof executeChannelOperation = executeChannelOperation,
): Promise<ChannelOperationResult> {
  return runWithChannelRequestSignal(input.signal, async () => {
    let credential = input.job.credential;
    let arguments_ = operationArguments(input.job);
    if (input.job.channel === "ebay") {
      const ensured = await ensureEbayAccessToken(
        credential,
        input.job.environment,
        undefined,
        input.hooks.beginCredentialMutation,
        input.hooks.stageCredentialRefresh,
        true,
      );
      credential = ensured.payload;
      if (input.job.operation === "inquiries.list") {
        arguments_ = {
          ...arguments_,
          marketplaceId: ebayAsqOperationMarketplaceId({
            periodic: typeof input.job.request.periodicKey === "string",
            credentialMarketplaceId: credential.marketplace_id,
            requestedMarketplaceId: arguments_.marketplaceId,
          }),
        };
      }
    }

    await input.hooks.assertLeaseHealthy();
    if (input.job.operation === "inquiries.reply") {
      await input.hooks.beginProviderMutation();
    }
    return operationExecutor({
      channel: input.job.channel,
      operation: input.job.operation,
      payload: credential,
      arguments: arguments_,
      environment: input.job.environment,
    });
  });
}

type CompletionResult = "completed" | "ownership_lost" | "unavailable";

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

async function completionContext(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessCsClaim,
) {
  const arguments_ = {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
  };
  let result = await callRpc(dependencies, COMPLETION_CONTEXT_RPC, arguments_);
  if (result.error) {
    result = await callRpc(dependencies, COMPLETION_CONTEXT_RPC, arguments_);
  }
  return result;
}

async function completeClaim(
  dependencies: ServerlessCsGatewayDependencies,
  gatewayTokenHash: string,
  job: ServerlessCsClaim,
  completionInput: GatewayWorkerCompletion,
): Promise<CompletionResult> {
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

  let normalizedInquiries: ReturnType<typeof normalizeChannelInquiries> | null = null;
  let storedResponse: ChannelOperationResult | null = null;
  if (parsed.data.status === "succeeded") {
    storedResponse = parsed.data.result as ChannelOperationResult;
    if (job.operation === "inquiries.list" && storedResponse.ok) {
      const normalizationTimestamp = typeof context.normalization_timestamp === "string"
        ? new Date(context.normalization_timestamp)
        : null;
      if (!normalizationTimestamp || Number.isNaN(normalizationTimestamp.getTime())) return "unavailable";
      normalizedInquiries = normalizeChannelInquiries(
        job.channel,
        storedResponse,
        normalizationTimestamp.toISOString(),
      );
    }
  } else if (parsed.data.status === "reconciliation_required" && parsed.data.result) {
    storedResponse = parsed.data.result as ChannelOperationResult;
  }
  if (job.operation === "inquiries.list" && storedResponse) {
    storedResponse = sanitizedInquiryListResult(
      storedResponse,
      normalizedInquiries?.length ?? 0,
    );
  }

  const completionArguments = {
    p_token_hash: gatewayTokenHash,
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_status: parsed.data.status,
    p_response_payload: storedResponse,
    p_error_message: parsed.data.status === "succeeded" ? null : parsed.data.error,
    p_credential_refresh: parsed.data.credentialRefresh ?? null,
    p_normalized_orders: null,
    p_normalized_inquiries: normalizedInquiries,
    p_diagnostic: null,
  };
  let completed = await callRpc(
    dependencies,
    COMPLETE_TRANSACTION_RPC,
    completionArguments,
  );
  if (completed.error) {
    completed = await callRpc(
      dependencies,
      COMPLETE_TRANSACTION_RPC,
      completionArguments,
    );
  }
  if (completed.error) return "unavailable";
  return recordValue(completed.data)?.status === "completed"
    ? "completed"
    : "ownership_lost";
}

function terminalResponse(
  status: GatewayWorkerCompletion["status"],
  job: ServerlessCsClaim,
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
  job: ServerlessCsClaim,
  completion: GatewayWorkerCompletion,
  logError: (stage: string, details: Record<string, string | number | boolean>) => void,
) {
  const completed = await completeClaim(dependencies, gatewayTokenHash, job, completion);
  if (completed === "completed") return terminalResponse(completion.status, job);
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
  if (!isEligibleClaim(parsed.data, dependencies.staticEgressChannels)) {
    logError("claim_scope", { status: 503, channel: parsed.data.channel, operation: parsed.data.operation });
    return jsonResponse({ message: "서버리스 CS 작업 범위를 확인하지 못했습니다." }, 503);
  }

  const job = parsed.data;
  const heartbeat = createClaimHeartbeat(dependencies, gatewayTokenHash, job);
  const runtimeSignal = AbortSignal.timeout(
    Math.min(
      SERVERLESS_CS_EXECUTION_TIMEOUT_MS,
      Math.max(1_000, dependencies.executionTimeoutMs ?? SERVERLESS_CS_EXECUTION_TIMEOUT_MS),
    ),
  );
  let heartbeatStopped = false;
  let externalMutationStarted = false;
  let credentialMutationInFlight = false;
  let credentialRefresh: CredentialRefreshSnapshot | undefined;

  const assertLeaseHealthy = () => heartbeat.assertHealthy();
  const hooks: ServerlessCsExecutionHooks = {
    assertLeaseHealthy,
    beginCredentialMutation: async () => {
      externalMutationStarted = true;
      credentialMutationInFlight = true;
      await assertLeaseHealthy();
      await beginCredentialMutation(dependencies, gatewayTokenHash, job);
      await assertLeaseHealthy();
    },
    stageCredentialRefresh: async (refresh) => {
      credentialRefresh = refresh;
      await assertLeaseHealthy();
      await stageCredentialRefresh(dependencies, gatewayTokenHash, job, refresh);
      await assertLeaseHealthy();
      credentialMutationInFlight = false;
    },
    beginProviderMutation: async () => {
      await assertLeaseHealthy();
      await beginProviderMutation(dependencies, gatewayTokenHash, job);
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
    const result = await (dependencies.executeProvider ?? executeServerlessCsProviderJob)({
      job,
      signal: runtimeSignal,
      hooks,
    });
    const completionStatus = gatewayJobCompletionStatus(result.operation, result.ok, result.steps);
    const completion: GatewayWorkerCompletion = completionStatus === "failed"
      ? {
        jobId: job.id,
        claimToken: job.claim_token,
        status: "failed",
        error: result.safeMessage,
        ...(credentialRefresh ? { credentialRefresh } : {}),
      }
      : completionStatus === "reconciliation_required"
        ? {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "reconciliation_required",
          error: result.safeMessage,
          result,
          ...(credentialRefresh ? { credentialRefresh } : {}),
        }
        : {
          jobId: job.id,
          claimToken: job.claim_token,
          status: "succeeded",
          result,
          ...(credentialRefresh ? { credentialRefresh } : {}),
        };
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
    const completion: GatewayWorkerCompletion = externalMutationStarted
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
  channel?: ServerlessCsClaim["channel"];
  operation?: ServerlessCsClaim["operation"];
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
  const channel = typeof body?.channel === "string" && SERVERLESS_CS_CHANNELS.has(body.channel)
    ? body.channel as ServerlessCsClaim["channel"]
    : undefined;
  const operation = body?.operation === "inquiries.list" || body?.operation === "inquiries.reply"
    ? body.operation
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
    return jsonResponse({ ok: true, status: "canary", claimed: 0, processed: 0 });
  }
  if (requestedMode !== null) {
    return jsonResponse({ message: "채널 작업 실행 모드를 확인하지 못했습니다." }, 400);
  }
  const logError = dependencies.logError ?? defaultLogError;
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
