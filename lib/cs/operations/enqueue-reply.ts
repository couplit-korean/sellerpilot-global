import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InquiryReplyGatewayEnqueueResult = {
  jobId: string;
};

export async function enqueueInquiryReplyViaChannelGateway(input: {
  serviceClient: SupabaseClient;
  ticketId: string;
  channel: "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay";
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
    if (enqueueError.message.includes("LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE")) {
      throw new Error("CHANNEL_GATEWAY_REPLY_MESSAGE_NOT_ACTIONABLE");
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
