import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelDiagnostic } from "../channel-diagnostics";
import type { ChannelOperationName, ChannelOperationResult } from "./operations";

export type ChannelGatewayChannel = "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "temu";

type GatewayJobSnapshot = {
  status?: unknown;
  response?: unknown;
  error?: unknown;
};

async function waitForGatewayJob(
  serviceClient: SupabaseClient,
  jobId: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await serviceClient.rpc("sellerpilot_get_channel_gateway_job", { p_job_id: jobId });
    if (error) throw new Error("CHANNEL_GATEWAY_STATUS_FAILED");
    const job = data && typeof data === "object" && !Array.isArray(data) ? data as GatewayJobSnapshot : null;
    if (job?.status === "succeeded" && job.response && typeof job.response === "object" && !Array.isArray(job.response)) return job.response;
    if (job?.status === "failed" || job?.status === "cancelled") {
      throw new Error(`CHANNEL_GATEWAY_REMOTE_FAILED:${typeof job.error === "string" ? job.error : "worker_failed"}`);
    }
    await delay(500);
  }
  throw new Error("CHANNEL_GATEWAY_TIMEOUT");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  credentialId: string;
  attemptId: string | null;
  channel: ChannelGatewayChannel;
  operation: ChannelOperationName;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const { data: jobId, error: enqueueError } = await input.serviceClient.rpc("sellerpilot_enqueue_channel_gateway_job", {
    p_credential_id: input.credentialId,
    p_attempt_id: input.attemptId,
    p_channel: input.channel,
    p_operation: input.operation,
    p_request_payload: { arguments: input.arguments },
  });
  if (enqueueError || typeof jobId !== "string") throw new Error("CHANNEL_GATEWAY_ENQUEUE_FAILED");

  return await waitForGatewayJob(input.serviceClient, jobId, input.timeoutMs ?? 180_000) as ChannelOperationResult;
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

export async function exchangeOAuthViaChannelGateway(input: {
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
