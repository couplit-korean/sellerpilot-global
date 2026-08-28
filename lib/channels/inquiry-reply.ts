import { ebayAsqProductionVerified, type ActiveChannelKey } from "./catalog";

export const implementedInquiryReplyChannels = ["qoo10", "lazada", "coupang", "smartstore", "ebay"] as const;

export type InquiryReplyChannel = (typeof implementedInquiryReplyChannels)[number];

export const inquiryReplyChannels: readonly InquiryReplyChannel[] = ebayAsqProductionVerified
  ? implementedInquiryReplyChannels
  : implementedInquiryReplyChannels.filter((channel) => channel !== "ebay");

export function supportsInquiryReply(channel: ActiveChannelKey): channel is InquiryReplyChannel {
  return (inquiryReplyChannels as readonly string[]).includes(channel);
}

export function coupangContactCenterParentAnswerId(value: unknown) {
  if (!Array.isArray(value)) return "";
  const replies = value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item));
  const actionable = replies.filter((reply) => {
    const answerId = typeof reply.answerId === "string" || typeof reply.answerId === "number"
      ? String(reply.answerId).trim()
      : "";
    const needAnswer = reply.needAnswer === true || String(reply.needAnswer ?? "").toLowerCase() === "true";
    const transferStatus = String(reply.partnerTransferStatus ?? "").trim().toLowerCase();
    return /^\d+$/.test(answerId)
      && (needAnswer || transferStatus === "requestanswer");
  }).at(-1);
  return actionable && (typeof actionable.answerId === "string" || typeof actionable.answerId === "number")
    ? String(actionable.answerId).trim()
    : "";
}

function requiredText(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`INQUIRY_REPLY_INVALID:${name}`);
  return normalized;
}

function hasForbiddenEbayControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x7f
      || (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
}

export function buildInquiryReplyArguments(
  channel: InquiryReplyChannel,
  externalTicketId: string,
  reply: string,
  replyContext: Record<string, unknown> = {},
): Record<string, unknown> {
  const ticketId = requiredText(externalTicketId, "externalTicketId");
  const replyText = requiredText(reply, "reply");

  if (channel === "lazada") {
    const sessionId = ticketId.startsWith("lazada-im:")
      ? ticketId.slice("lazada-im:".length).trim()
      : "";
    if (!sessionId) throw new Error("INQUIRY_REPLY_INVALID:lazadaSessionId");
    return { sessionId, reply: replyText };
  }

  if (channel === "coupang") {
    const separator = ticketId.indexOf(":");
    const kind = separator > 0 ? ticketId.slice(0, separator) : "";
    const inquiryId = separator > 0 ? ticketId.slice(separator + 1).trim() : "";
    if (!(["product", "call-center"] as const).includes(kind as "product" | "call-center") || !inquiryId) {
      throw new Error("INQUIRY_REPLY_INVALID:coupangInquiryId");
    }
    if (kind === "call-center") {
      if (replyText.length < 2 || replyText.length > 1000) {
        throw new Error("INQUIRY_REPLY_INVALID:coupangReplyLength");
      }
      const parentAnswerId = typeof replyContext.parentAnswerId === "string"
        || typeof replyContext.parentAnswerId === "number"
        ? String(replyContext.parentAnswerId).trim()
        : "";
      if (!/^[1-9]\d*$/.test(parentAnswerId)) {
        throw new Error("INQUIRY_REPLY_INVALID:coupangParentAnswerId");
      }
      return { kind, inquiryId, parentAnswerId, reply: replyText };
    }
    return { kind, inquiryId, reply: replyText };
  }

  if (channel === "smartstore") {
    if (!/^\d+$/.test(ticketId)) throw new Error("INQUIRY_REPLY_INVALID:smartstoreQuestionId");
    return { questionId: ticketId, reply: replyText };
  }

  if (channel === "ebay") {
    const parentMessageId = ticketId.startsWith("ebay:") ? ticketId.slice("ebay:".length).trim() : "";
    const contextParentMessageId = typeof replyContext.parentMessageId === "string"
      || typeof replyContext.parentMessageId === "number"
      ? String(replyContext.parentMessageId).trim()
      : "";
    const itemId = typeof replyContext.itemId === "string" || typeof replyContext.itemId === "number"
      ? String(replyContext.itemId).trim()
      : "";
    const recipientId = typeof replyContext.recipientId === "string" || typeof replyContext.recipientId === "number"
      ? String(replyContext.recipientId).trim()
      : "";
    if (!parentMessageId
        || parentMessageId.length > 230
        || contextParentMessageId !== parentMessageId
        || !/^\d{1,19}$/.test(itemId)
        || !recipientId
        || recipientId.length > 240
        || hasForbiddenEbayControl(parentMessageId)
        || hasForbiddenEbayControl(recipientId)
        || hasForbiddenEbayControl(replyText)
        || replyText.length > 2_000) {
      throw new Error("INQUIRY_REPLY_INVALID:ebayReplyContext");
    }
    return { itemId, parentMessageId, recipientId, reply: replyText };
  }

  const match = /^qoo10:(MSG|HELP|ITEM):(\d+):(\d+)$/i.exec(ticketId);
  if (!match) throw new Error("INQUIRY_REPLY_INVALID:qoo10InquiryId");
  return {
    params: {
      inq_type: match[1].toUpperCase(),
      question_no: match[2],
      seq_no: match[3],
      contents: replyText,
    },
  };
}
