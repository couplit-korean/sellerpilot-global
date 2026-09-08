import { coupangContactCenterParentAnswerId } from "../../inquiry-reply.ts";

type ContactCenterReply = Record<string, unknown>;

export type CoupangContactCenterReplyTarget = {
  state:
    | "ready"
    | "not_replyable"
    | "no_actionable_parent"
    | "ambiguous_actionable_parent"
    | "latest_inbound_ambiguous"
    | "latest_inbound_mismatch"
    | "seller_reply_after_inbound"
    | "reply_sequence_unresolved";
  latestInboundAnswerId: string;
  latestInboundAt: string;
  parentAnswerId: string;
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function replies(value: unknown): ContactCenterReply[] {
  return Array.isArray(value)
    ? value.filter((item): item is ContactCenterReply => Boolean(item)
      && typeof item === "object"
      && !Array.isArray(item))
    : [];
}

function positiveAnswerId(reply: ContactCenterReply) {
  const value = text(reply.answerId);
  return /^[1-9]\d*$/u.test(value) ? value : "";
}

function inboundTimestamp(reply: ContactCenterReply) {
  const value = text(reply.replyAt);
  const parsed = Date.parse(value);
  return value && Number.isFinite(parsed) ? { value, parsed } : null;
}

/**
 * Resolve a reply target without trusting provider array order.
 *
 * Coupang accepts a contact-center reply only while the inquiry is in progress
 * and requests an answer. The reply must point at the single actionable CS
 * agent answer, which must also be the newest inbound answer. Any ambiguity
 * fails closed so a retry cannot attach to an older transfer.
 */
export function coupangContactCenterReplyTarget(
  inquiry: Record<string, unknown>,
): CoupangContactCenterReplyTarget {
  const allReplies = replies(inquiry.replies);
  const actionableParentAnswerId = coupangContactCenterParentAnswerId(allReplies);
  const actionableIds = [...new Set(allReplies
    .filter((reply) => {
      const needAnswer = reply.needAnswer === true || text(reply.needAnswer).toLowerCase() === "true";
      return positiveAnswerId(reply)
        && text(reply.answerType).toLowerCase() === "csagent"
        && (needAnswer || text(reply.partnerTransferStatus).toLowerCase() === "requestanswer");
    })
    .map(positiveAnswerId))];

  const inbound = allReplies
    .filter((reply) => text(reply.answerType).toLowerCase() === "csagent" && positiveAnswerId(reply))
    .map((reply) => ({
      answerId: positiveAnswerId(reply),
      timestamp: inboundTimestamp(reply),
    }))
    .filter((entry): entry is { answerId: string; timestamp: { value: string; parsed: number } } => Boolean(entry.timestamp));

  const latestTime = inbound.reduce((maximum, entry) => Math.max(maximum, entry.timestamp.parsed), Number.NEGATIVE_INFINITY);
  const latest = Number.isFinite(latestTime)
    ? inbound.filter((entry) => entry.timestamp.parsed === latestTime)
    : [];
  const latestIds = [...new Set(latest.map((entry) => entry.answerId))];
  const latestInboundAnswerId = latestIds.length === 1 ? latestIds[0] : "";
  const latestInboundAt = latestIds.length === 1 ? latest[0]?.timestamp.value ?? "" : "";
  const base = { latestInboundAnswerId, latestInboundAt, parentAnswerId: "" };

  const inquiryStatus = text(inquiry.inquiryStatus).toLowerCase();
  const counselingStatus = text(inquiry.csPartnerCounselingStatus).toLowerCase();
  // Older locally persisted rows predate inquiryStatus projection. Keep those
  // replyable only when Coupang's explicit counseling status requests an
  // answer; any explicit non-progress value still fails closed.
  if ((inquiryStatus && inquiryStatus !== "progress") || counselingStatus !== "requestanswer") {
    return { ...base, state: "not_replyable" };
  }
  const unsequencedConversationReply = allReplies.some((reply) => {
    const answerType = text(reply.answerType).toLowerCase();
    return (answerType === "csagent" || answerType === "vendor")
      && Boolean(positiveAnswerId(reply))
      && inboundTimestamp(reply) === null;
  });
  if (unsequencedConversationReply) {
    return { ...base, state: "reply_sequence_unresolved" };
  }
  if (actionableIds.length > 1 || (actionableIds.length === 1 && !actionableParentAnswerId)) {
    return { ...base, state: "ambiguous_actionable_parent" };
  }
  if (!actionableParentAnswerId) {
    return { ...base, state: "no_actionable_parent" };
  }
  if (latestIds.length !== 1) {
    return { ...base, state: "latest_inbound_ambiguous" };
  }
  if (latestInboundAnswerId !== actionableParentAnswerId) {
    return { ...base, state: "latest_inbound_mismatch" };
  }
  const sellerReplyAfterInbound = allReplies.some((reply) => {
    const timestamp = inboundTimestamp(reply);
    return text(reply.answerType).toLowerCase() === "vendor"
      && timestamp !== null
      && timestamp.parsed >= latestTime;
  });
  if (sellerReplyAfterInbound) {
    return { ...base, state: "seller_reply_after_inbound" };
  }
  return {
    state: "ready",
    latestInboundAnswerId,
    latestInboundAt,
    parentAnswerId: actionableParentAnswerId,
  };
}
