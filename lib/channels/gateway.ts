import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelDiagnostic } from "../channel-diagnostics";
import type { ChannelOperationName, ChannelOperationResult } from "./operations";

export type ChannelGatewayChannel = "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay" | "temu";

type GatewayCompetitorCandidate = {
  provider: "elevenst_product_search";
  externalId: string;
  title: string;
  url: string;
  imageUrl: string;
  mallName: string;
  marketplace: "elevenst";
  price: number;
  currency: "KRW";
};

type GatewayJobSnapshot = {
  status?: unknown;
  response?: unknown;
  error?: unknown;
};

type ListingGatewayEnqueue = {
  status?: unknown;
  job_id?: unknown;
  attempt_id?: unknown;
  listing_id?: unknown;
  reused?: unknown;
};

type ListingCreateReservation = {
  productId: string;
  market: string;
  targetId: string;
  currency: string;
  price: number;
  requestFingerprint: string;
};

export type GatewayWriteResource = {
  kind: "listing_mutation" | "order_shipment";
  key: string;
  requestFingerprint: string;
  listingId?: string;
  inventoryItemId?: string;
  orderId?: string;
  carrierCode?: string;
  trackingNumber?: string;
};

export type InquiryReplyGatewayEnqueueResult = {
  jobId: string;
};

export class ChannelGatewayInProgressError extends Error {
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly listingId: string | null;

  constructor(
    jobId: string,
    attemptId: string | null,
    message = "CHANNEL_GATEWAY_IN_PROGRESS",
    listingId: string | null = null,
  ) {
    super(message);
    this.name = "ChannelGatewayInProgressError";
    this.jobId = jobId;
    this.attemptId = attemptId;
    this.listingId = listingId;
  }
}

export class ChannelGatewayReconciliationRequiredError extends Error {
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly listingId: string | null;

  constructor(jobId: string, attemptId: string | null, listingId: string | null = null) {
    super("CHANNEL_GATEWAY_RECONCILIATION_REQUIRED");
    this.name = "ChannelGatewayReconciliationRequiredError";
    this.jobId = jobId;
    this.attemptId = attemptId;
    this.listingId = listingId;
  }
}

export class ChannelGatewayListingAlreadyPublishedError extends Error {
  readonly listingId: string;
  readonly attemptId: string;

  constructor(listingId: string, attemptId: string) {
    super("CHANNEL_GATEWAY_LISTING_ALREADY_PUBLISHED");
    this.name = "ChannelGatewayListingAlreadyPublishedError";
    this.listingId = listingId;
    this.attemptId = attemptId;
  }
}

export class ChannelGatewayListingBlockedError extends Error {
  readonly listingId: string;
  readonly attemptId: string;

  constructor(listingId: string, attemptId: string) {
    super("CHANNEL_GATEWAY_LISTING_MANUAL_RECONCILIATION_REQUIRED");
    this.name = "ChannelGatewayListingBlockedError";
    this.listingId = listingId;
    this.attemptId = attemptId;
  }
}

export class ChannelGatewayRemoteFailedError extends Error {
  readonly jobId: string;
  readonly attemptId: string | null;
  readonly listingId: string | null;

  constructor(jobId: string, attemptId: string | null, listingId: string | null, safeError: string) {
    super(`CHANNEL_GATEWAY_REMOTE_FAILED:${safeError}`);
    this.name = "ChannelGatewayRemoteFailedError";
    this.jobId = jobId;
    this.attemptId = attemptId;
    this.listingId = listingId;
  }
}

export class ChannelGatewayCredentialUnattestedError extends Error {
  constructor() {
    super("CHANNEL_GATEWAY_CREDENTIAL_UNATTESTED");
    this.name = "ChannelGatewayCredentialUnattestedError";
  }
}

function throwGatewayEnqueueError(error: { message?: string } | null) {
  if (error?.message?.includes("provider-certified seller identity required")) {
    throw new ChannelGatewayCredentialUnattestedError();
  }
  throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
}

async function waitForGatewayJob(
  serviceClient: SupabaseClient,
  jobId: string,
  timeoutMs: number,
  attemptId: string | null = null,
  listingId: string | null = null,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    const query = serviceClient.rpc("sellerpilot_get_channel_gateway_job", { p_job_id: jobId });
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    // Enqueue already committed. Losing the subsequent status read is never
    // proof of provider failure; preserve the active job/upper ledger and let
    // exact worker completion settle it.
    if (error) throw new ChannelGatewayInProgressError(jobId, attemptId, "CHANNEL_GATEWAY_STATUS_UNAVAILABLE", listingId);
    const job = data && typeof data === "object" && !Array.isArray(data) ? data as GatewayJobSnapshot : null;
    if (job?.status === "succeeded" && job.response && typeof job.response === "object" && !Array.isArray(job.response)) return job.response;
    if (job?.status === "reconciliation_required") {
      throw new ChannelGatewayReconciliationRequiredError(jobId, attemptId, listingId);
    }
    if (job?.status === "failed" || job?.status === "cancelled") {
      throw new ChannelGatewayRemoteFailedError(
        jobId,
        attemptId,
        listingId,
        typeof job.error === "string" ? job.error : "worker_failed",
      );
    }
    await delay(500, signal);
  }
  throw new ChannelGatewayInProgressError(jobId, attemptId, "CHANNEL_GATEWAY_TIMEOUT", listingId);
}

function delay(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function executeViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  attemptId: string | null;
  channel: ChannelGatewayChannel;
  operation: ChannelOperationName;
  arguments: Record<string, unknown>;
  listingId?: string;
  listingCreate?: ListingCreateReservation;
  writeResource?: GatewayWriteResource;
  timeoutMs?: number;
}) {
  let jobId = "";
  let effectiveAttemptId = input.attemptId;
  let effectiveListingId = input.listingId ?? null;
  if (input.listingCreate) {
    if (!input.attemptId || input.operation !== "listing.create" || input.listingId) {
      throw new Error("CHANNEL_GATEWAY_LISTING_BINDING_INVALID");
    }
    const { data, error: enqueueError } = await input.serviceClient.rpc(
      "sellerpilot_service_reserve_and_enqueue_listing_create",
      {
        p_product_id: input.listingCreate.productId,
        p_credential_id: input.credentialId,
        p_attempt_id: input.attemptId,
        p_channel: input.channel,
        p_market: input.listingCreate.market,
        p_target_id: input.listingCreate.targetId,
        p_currency: input.listingCreate.currency,
        p_price: input.listingCreate.price,
        p_request_fingerprint: input.listingCreate.requestFingerprint,
        p_request_payload: { arguments: input.arguments },
      },
    );
    const enqueue = data && typeof data === "object" && !Array.isArray(data)
      ? data as ListingGatewayEnqueue
      : null;
    if (enqueueError) throwGatewayEnqueueError(enqueueError);
    if (!enqueue
        || typeof enqueue.attempt_id !== "string"
        || typeof enqueue.listing_id !== "string"
        || !["queued", "in_progress", "reconciliation_required", "remote_exists", "manual_required"].includes(String(enqueue.status))) {
      throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    }
    effectiveAttemptId = enqueue.attempt_id;
    effectiveListingId = enqueue.listing_id;
    if (enqueue.status === "remote_exists") {
      throw new ChannelGatewayListingAlreadyPublishedError(effectiveListingId, effectiveAttemptId);
    }
    if (enqueue.status === "manual_required") {
      throw new ChannelGatewayListingBlockedError(effectiveListingId, effectiveAttemptId);
    }
    if (typeof enqueue.job_id !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    jobId = enqueue.job_id;
    if (enqueue.status === "reconciliation_required") {
      throw new ChannelGatewayReconciliationRequiredError(jobId, effectiveAttemptId, effectiveListingId);
    }
    if (enqueue.status === "in_progress") {
      throw new ChannelGatewayInProgressError(jobId, effectiveAttemptId, "CHANNEL_GATEWAY_IN_PROGRESS", effectiveListingId);
    }
  } else if (input.listingId) {
    if (!input.attemptId || !["listing.create", "listing.update", "listing.stop"].includes(input.operation)) {
      throw new Error("CHANNEL_GATEWAY_LISTING_BINDING_INVALID");
    }
    const { data, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_service_enqueue_listing_gateway_job", {
      p_listing_id: input.listingId,
      p_credential_id: input.credentialId,
      p_attempt_id: input.attemptId,
      p_channel: input.channel,
      p_operation: input.operation,
      p_request_payload: { arguments: input.arguments },
    });
    const enqueue = data && typeof data === "object" && !Array.isArray(data)
      ? data as ListingGatewayEnqueue
      : null;
    if (enqueueError) throwGatewayEnqueueError(enqueueError);
    if (!enqueue
        || typeof enqueue.job_id !== "string"
        || typeof enqueue.attempt_id !== "string"
        || !["queued", "in_progress", "reconciliation_required"].includes(String(enqueue.status))) {
      throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    }
    jobId = enqueue.job_id;
    effectiveAttemptId = enqueue.attempt_id;
    if (enqueue.status === "reconciliation_required") {
      throw new ChannelGatewayReconciliationRequiredError(jobId, effectiveAttemptId, effectiveListingId);
    }
    if (enqueue.status === "in_progress") {
      throw new ChannelGatewayInProgressError(jobId, effectiveAttemptId, "CHANNEL_GATEWAY_IN_PROGRESS", effectiveListingId);
    }
  } else if (input.writeResource) {
    const { data, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_service_enqueue_resource_gateway_job", {
      p_credential_id: input.credentialId,
      p_attempt_id: input.attemptId,
      p_channel: input.channel,
      p_operation: input.operation,
      p_request_payload: { arguments: input.arguments },
      p_resource_kind: input.writeResource.kind,
      p_resource_key: input.writeResource.key,
      p_request_fingerprint: input.writeResource.requestFingerprint,
      p_listing_id: input.writeResource.listingId ?? null,
      p_inventory_item_id: input.writeResource.inventoryItemId ?? null,
      p_order_id: input.writeResource.orderId ?? null,
      p_shipment_carrier: input.writeResource.carrierCode ?? null,
      p_shipment_tracking: input.writeResource.trackingNumber ?? null,
    });
    const enqueue = data && typeof data === "object" && !Array.isArray(data)
      ? data as ListingGatewayEnqueue
      : null;
    if (enqueueError) throwGatewayEnqueueError(enqueueError);
    if (!enqueue
        || typeof enqueue.job_id !== "string"
        || typeof enqueue.attempt_id !== "string"
        || !["queued", "in_progress", "reconciliation_required"].includes(String(enqueue.status))) {
      throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    }
    jobId = enqueue.job_id;
    effectiveAttemptId = enqueue.attempt_id;
    if (enqueue.status === "reconciliation_required") {
      throw new ChannelGatewayReconciliationRequiredError(jobId, effectiveAttemptId);
    }
    if (enqueue.status === "in_progress") {
      throw new ChannelGatewayInProgressError(jobId, effectiveAttemptId);
    }
  } else {
    const { data, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
      p_credential_id: input.credentialId,
      p_attempt_id: input.attemptId,
      p_channel: input.channel,
      p_operation: input.operation,
      p_request_payload: { arguments: input.arguments },
    });
    if (enqueueError) throwGatewayEnqueueError(enqueueError);
    if (typeof data !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    jobId = data;
  }

  const result = await waitForGatewayJob(
    input.serviceClient,
    jobId,
    input.timeoutMs ?? 180_000,
    effectiveAttemptId,
    effectiveListingId,
  ) as ChannelOperationResult;
  return { result, listingId: effectiveListingId ?? undefined };
}

export async function enqueueInquiryReplyViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  ticketId: string;
  channel: "qoo10" | "lazada" | "coupang" | "smartstore" | "ebay";
  reply: string;
  expectedInboundKey: string;
  arguments: Record<string, unknown>;
}): Promise<InquiryReplyGatewayEnqueueResult> {
  const { data: jobId, error: enqueueError } = await input.serviceClient.rpc(
    "sellerpilot_enqueue_inquiry_reply_gateway_job",
    {
      p_ticket_id: input.ticketId,
      p_channel: input.channel,
      p_reply_text: input.reply,
      p_request_payload: { arguments: input.arguments, sellerpilotExpectedInboundKey: input.expectedInboundKey },
    },
  );
  if (enqueueError) {
    if (enqueueError.message.includes("STATIC_EGRESS_REQUIRED")) {
      throw new Error("CHANNEL_GATEWAY_STATIC_EGRESS_REQUIRED");
    }
    if (/INQUIRY_REPLY_CONFLICT|INQUIRY_REPLY_ALREADY_RESOLVED/.test(enqueueError.message)) {
      throw new Error("CHANNEL_GATEWAY_REPLY_CONFLICT");
    }
    if (enqueueError.message.includes("INQUIRY_REPLY_LINEAGE_UNBOUND")) {
      throw new Error("CHANNEL_GATEWAY_REPLY_LINEAGE_UNBOUND");
    }
    if (/INQUIRY_REPLY_RECONCILIATION_REQUIRED|INQUIRY_REPLY_LEGACY_IN_PROGRESS/.test(enqueueError.message)) {
      throw new Error("CHANNEL_GATEWAY_REPLY_RECONCILIATION_REQUIRED");
    }
    if (enqueueError.message.includes("PROVIDER_INQUIRY_NOT_WAITING")) {
      throw new Error("CHANNEL_GATEWAY_REPLY_PROVIDER_NOT_WAITING");
    }
    if (/INQUIRY_LATEST_MESSAGE_UNBOUND|INQUIRY_CONTEXT_STALE/.test(enqueueError.message)) {
      throw new Error("CHANNEL_GATEWAY_REPLY_CONTEXT_STALE");
    }
    if (/EBAY_ASQ_(?:RATE_LIMITED_75_PER_60_SECONDS|PROVIDER_COOLDOWN_100_SECONDS)/.test(enqueueError.message)) {
      throw new Error(enqueueError.message.includes("PROVIDER_COOLDOWN")
        ? "EBAY_ASQ_PROVIDER_COOLDOWN_100_SECONDS"
        : "EBAY_ASQ_RATE_LIMITED_75_PER_60_SECONDS");
    }
    if (enqueueError.message.includes("active channel credential required")) {
      throw new Error("CREDENTIALS_MISSING");
    }
    throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  }
  if (typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  return { jobId };
}

export async function executeInquiryReplyViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  ticketId: string;
  channel: "qoo10" | "lazada" | "coupang" | "smartstore" | "ebay";
  reply: string;
  expectedInboundKey: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const { jobId } = await enqueueInquiryReplyViaChannelGateway(input);
  return await waitForGatewayJob(
    input.serviceClient,
    jobId,
    input.timeoutMs ?? 180_000,
  ) as ChannelOperationResult;
}

export async function executeDiagnosticViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  channel: ChannelGatewayChannel;
  timeoutMs?: number;
}) {
  const { data: jobId, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
    p_credential_id: input.credentialId,
    p_attempt_id: null,
    p_channel: input.channel,
    p_operation: "diagnostic.test",
    p_request_payload: {},
  });
  if (enqueueError || typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  const response = await waitForGatewayJob(input.serviceClient, jobId, input.timeoutMs ?? 45_000);
  const diagnostic = response && typeof response === "object" && !Array.isArray(response) && "diagnostic" in response
    ? response.diagnostic
    : null;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    throw new Error("CHANNEL_GATEWAY_RESPONSE_INVALID");
  }
  return diagnostic as ChannelDiagnostic;
}

export async function executeCompetitorSearchViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  primary: string;
  aliases: string[];
  displayPerQuery: number;
  productId?: string;
  claimToken?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}) {
  const { data: jobId, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_enqueue_competitor_search_job", {
    p_credential_id: input.credentialId,
    p_primary: input.primary,
    p_aliases: input.aliases,
    p_display_per_query: input.displayPerQuery,
    p_product_id: input.productId ?? null,
    p_claim_token: input.claimToken ?? null,
  });
  if (enqueueError || typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  const response = await waitForGatewayJob(
    input.serviceClient,
    jobId,
    input.timeoutMs ?? 45_000,
    null,
    null,
    input.signal,
  );
  const result = response as Record<string, unknown>;
  if (result.operation !== "competitor.search" || result.channel !== "elevenst" || result.ok !== true || !Array.isArray(result.items)) {
    throw new Error("CHANNEL_GATEWAY_RESPONSE_INVALID");
  }
  return result.items as GatewayCompetitorCandidate[];
}

export async function exchangeOAuthViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  channel: "shopee" | "lazada" | "ebay";
  request: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const { data: jobId, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
    p_credential_id: input.credentialId,
    p_attempt_id: null,
    p_channel: input.channel,
    p_operation: "oauth.exchange",
    p_request_payload: input.request,
  });
  if (enqueueError || typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  return await waitForGatewayJob(input.serviceClient, jobId, input.timeoutMs ?? 45_000);
}

export async function executeChannelTargetDiscovery(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  channel: "shopee" | "lazada";
  request: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const { data: jobId, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
    p_credential_id: input.credentialId,
    p_attempt_id: null,
    p_channel: input.channel,
    p_operation: "shops.get",
    p_request_payload: input.request,
  });
  if (enqueueError || typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  return await waitForGatewayJob(input.serviceClient, jobId, input.timeoutMs ?? 45_000);
}
