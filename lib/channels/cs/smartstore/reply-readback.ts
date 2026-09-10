const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const smartstoreReplyReadbackContract = "sellerpilot-smartstore-reply-readback/1" as const;
export const smartstoreReplyReadbackResultContract = "sellerpilot-smartstore-reply-readback-result/1" as const;

export type SmartstoreReplyReadbackContext = {
  contract: typeof smartstoreReplyReadbackContract;
  sourceJobId: string;
  deliveryId: string;
  ticketId: string;
  kind: "product" | "customer";
  providerTicketId: string;
  expectedInboundKey: string;
  expectedReplyFingerprint: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function smartstoreReplyReadbackContext(
  request: unknown,
): SmartstoreReplyReadbackContext | null {
  const payload = record(request);
  if (!payload || !Object.hasOwn(payload, "sellerpilotSmartstoreReplyReadback")) return null;
  const arguments_ = record(payload?.arguments);
  const marker = record(payload?.sellerpilotSmartstoreReplyReadback);
  if (!arguments_ || !marker) throw new Error("SMARTSTORE_REPLY_READBACK_CONTEXT_INVALID");

  const kind = marker.kind;
  const providerTicketId = marker.providerTicketId;
  const argumentTarget = kind === "product" ? arguments_.questionId : arguments_.inquiryNo;
  if (marker.contract !== smartstoreReplyReadbackContract
      || typeof marker.sourceJobId !== "string" || !UUID_PATTERN.test(marker.sourceJobId)
      || typeof marker.deliveryId !== "string" || !UUID_PATTERN.test(marker.deliveryId)
      || typeof marker.ticketId !== "string" || !UUID_PATTERN.test(marker.ticketId)
      || (kind !== "product" && kind !== "customer")
      || typeof providerTicketId !== "string" || !/^[1-9]\d{0,18}$/u.test(providerTicketId)
      || argumentTarget !== providerTicketId
      || typeof marker.expectedInboundKey !== "string"
      || !/^smartstore:[a-f0-9]{64}$/u.test(marker.expectedInboundKey)
      || typeof marker.expectedReplyFingerprint !== "string"
      || !SHA256_PATTERN.test(marker.expectedReplyFingerprint)) {
    throw new Error("SMARTSTORE_REPLY_READBACK_CONTEXT_INVALID");
  }
  return marker as SmartstoreReplyReadbackContext;
}
