import { ChannelGatewayInProgressError, ChannelGatewayReconciliationRequiredError, throwGatewayEnqueueError, waitForGatewayJob } from "./gateway-job-runtime";
export { ChannelGatewayInProgressError, ChannelGatewayReconciliationRequiredError, ChannelGatewayRemoteFailedError, ChannelGatewayCredentialUnattestedError, throwGatewayEnqueueError, waitForGatewayJob } from "./gateway-job-runtime";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelDiagnostic } from "../channel-diagnostics";
import type { ChannelOperationName, ChannelOperationResult } from "./commerce-operations";
import { databaseServerlessStaticEgressAllows, SERVERLESS_STATIC_EGRESS_REQUIRED } from "./serverless-static-egress";

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
  if (/^(orders|shipment|inquiries)\./.test(input.operation)) throw new Error("PRODUCT_GATEWAY_OPERATION_REQUIRED");
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
    if (!input.attemptId || !["listing.create", "listing.update", "listing.stop", "listing.activate"].includes(input.operation)) {
      throw new Error("CHANNEL_GATEWAY_LISTING_BINDING_INVALID");
    }
    const { data, error: enqueueError } = input.channel === "temu"
        && input.operation === "listing.activate"
      ? await input.serviceClient.rpc("sellerpilot_service_enqueue_temu_activation", {
          p_listing_id: input.listingId,
          p_credential_id: input.credentialId,
          p_attempt_id: input.attemptId,
          p_request_payload: { arguments: input.arguments },
        })
      : await input.serviceClient.rpc("sellerpilot_service_enqueue_listing_gateway_job", {
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
  let staticEgressStatus: { data: unknown; error: unknown };
  try {
    staticEgressStatus = await input.serviceClient.rpc(
      "sellerpilot_service_serverless_static_egress_status",
    );
  } catch {
    throw new Error(SERVERLESS_STATIC_EGRESS_REQUIRED);
  }
  if (staticEgressStatus.error
      || !databaseServerlessStaticEgressAllows(staticEgressStatus.data, "elevenst")) {
    throw new Error(SERVERLESS_STATIC_EGRESS_REQUIRED);
  }
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
  const { data: jobId, error: enqueueError } = input.channel === "lazada"
    ? await input.serviceClient.rpc("sellerpilot_enqueue_lazada_target_sync", {
        p_credential_id: input.credentialId,
        p_country: input.request.country,
      })
    : await input.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
        p_credential_id: input.credentialId,
        p_attempt_id: null,
        p_channel: input.channel,
        p_operation: "shops.get",
        p_request_payload: input.request,
      });
  if (enqueueError || typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
  return await waitForGatewayJob(input.serviceClient, jobId, input.timeoutMs ?? 45_000);
}
