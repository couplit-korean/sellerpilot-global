import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveChannelKey } from "../channels/catalog";
import {
  isShippingOperation,
  type ShippingOperationName,
  type ShippingOperationResult,
} from "./contracts";
import {
  throwGatewayEnqueueError,
  waitForGatewayJob,
  ChannelGatewayInProgressError,
  ChannelGatewayReconciliationRequiredError,
} from "../channels/gateway-job-runtime";
type ListingGatewayEnqueue = {
  status?: unknown;
  job_id?: unknown;
  attempt_id?: unknown;
};
export async function executeViaShippingGateway(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  attemptId: string;
  channel: ActiveChannelKey;
  operation: ShippingOperationName;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
  writeResource?: {
    kind: "order_shipment";
    key: string;
    requestFingerprint: string;
    orderId: string;
    carrierCode?: string;
    trackingNumber?: string;
  };
}) {
  if (!isShippingOperation(input.operation))
    throw new Error("SHIPPING_OPERATION_REQUIRED");
  let jobId = "";
  let effectiveAttemptId = input.attemptId;
  if (input.writeResource) {
    const { data, error: enqueueError } = await input.serviceClient.rpc(
      "sellerpilot_service_enqueue_resource_gateway_job",
      {
        p_credential_id: input.credentialId,
        p_attempt_id: input.attemptId,
        p_channel: input.channel,
        p_operation: input.operation,
        p_request_payload: { arguments: input.arguments },
        p_resource_kind: input.writeResource.kind,
        p_resource_key: input.writeResource.key,
        p_request_fingerprint: input.writeResource.requestFingerprint,
        p_listing_id: null,
        p_inventory_item_id: null,
        p_order_id: input.writeResource.orderId ?? null,
        p_shipment_carrier: input.writeResource.carrierCode ?? null,
        p_shipment_tracking: input.writeResource.trackingNumber ?? null,
      },
    );
    const enqueue =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as ListingGatewayEnqueue)
        : null;
    if (enqueueError) throwGatewayEnqueueError(enqueueError);
    if (
      !enqueue ||
      typeof enqueue.job_id !== "string" ||
      typeof enqueue.attempt_id !== "string" ||
      !["queued", "in_progress", "reconciliation_required"].includes(
        String(enqueue.status),
      )
    ) {
      throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    }
    jobId = enqueue.job_id;
    effectiveAttemptId = enqueue.attempt_id;
    if (enqueue.status === "reconciliation_required") {
      throw new ChannelGatewayReconciliationRequiredError(
        jobId,
        effectiveAttemptId,
      );
    }
    if (enqueue.status === "in_progress") {
      throw new ChannelGatewayInProgressError(jobId, effectiveAttemptId);
    }
  } else {
    const { data, error: enqueueError } = await input.serviceClient.rpc(
      "sellerpilot_enqueue_channel_gateway_job",
      {
        p_credential_id: input.credentialId,
        p_attempt_id: input.attemptId,
        p_channel: input.channel,
        p_operation: input.operation,
        p_request_payload: { arguments: input.arguments },
      },
    );
    if (enqueueError) throwGatewayEnqueueError(enqueueError);
    if (typeof data !== "string")
      throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");
    jobId = data;
  }

  const result = (await waitForGatewayJob(
    input.serviceClient,
    jobId,
    input.timeoutMs ?? 180_000,
    effectiveAttemptId,
    null,
  )) as ShippingOperationResult;
  return { result };
}
