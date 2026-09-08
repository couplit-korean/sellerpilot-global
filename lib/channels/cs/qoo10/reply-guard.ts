import { qoo10InquiryReplyParams } from "./contracts.ts";

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function resolveQoo10ReplyLineage(input: {
  externalTicketId: string;
  replyContext: Record<string, unknown>;
  providerContext: Record<string, unknown>;
}) {
  const inquiryType = text(input.replyContext.inquiryType).toUpperCase();
  const questionNo = text(input.replyContext.questionNo);
  const sequenceNo = text(input.replyContext.sequenceNo);
  const legacyExternalTicketId = `qoo10:${inquiryType}:${questionNo}:${sequenceNo}`;
  const legacy = /^qoo10:(MSG|HELP|ITEM):(\d{1,40}):(\d{1,40})$/u.exec(input.externalTicketId);
  if (legacy) {
    if (inquiryType !== legacy[1] || questionNo !== legacy[2] || sequenceNo !== legacy[3]) {
      throw new Error("QOO10_REPLY_TARGET_INVALID");
    }
    return { inquiryType, questionNo, sequenceNo, legacyExternalTicketId, ticketIdentity: "legacy" as const };
  }
  const thread = /^qoo10:v2:(MSG|HELP|ITEM):(\d{1,40})$/u.exec(input.externalTicketId);
  const aliases = Array.isArray(input.providerContext.legacyExternalTicketIds)
    ? input.providerContext.legacyExternalTicketIds
    : [];
  if (!thread || input.providerContext.ticketIdentityVersion !== "qoo10-thread-v2"
      || inquiryType !== thread[1] || questionNo !== thread[2]
      || text(input.replyContext.legacyExternalTicketId) !== legacyExternalTicketId
      || aliases.some((value) => typeof value !== "string")
      || !aliases.includes(legacyExternalTicketId)) {
    throw new Error("QOO10_REPLY_TARGET_INVALID");
  }
  return { inquiryType, questionNo, sequenceNo, legacyExternalTicketId, ticketIdentity: "thread-v2" as const };
}

export type Qoo10ReplyPreparationInput = {
  externalTicketId: string;
  replyText: string;
  replyContext: Record<string, unknown>;
  providerContext: Record<string, unknown>;
  selectedInboundKey: string;
  latestInboundKey: string;
  approved: boolean;
};

export function prepareQoo10Reply(input: Qoo10ReplyPreparationInput) {
  if (!input.approved) throw new Error("QOO10_REPLY_APPROVAL_REQUIRED");
  if (!input.selectedInboundKey || input.selectedInboundKey !== input.latestInboundKey) {
    throw new Error("QOO10_REPLY_STALE_TARGET");
  }
  const lineage = resolveQoo10ReplyLineage(input);
  const { inquiryType, questionNo, sequenceNo } = lineage;
  if (text(input.providerContext.inquiryType).toUpperCase() !== inquiryType
      || text(input.providerContext.questionNo) !== questionNo
      || text(input.providerContext.sequenceNo) !== sequenceNo
      || /S3|ANSWER|COMPLETE/u.test(text(input.providerContext.processingStatus).toUpperCase())) {
    throw new Error("QOO10_REPLY_TARGET_INVALID");
  }
  return {
    params: qoo10InquiryReplyParams({
      params: { inq_type: inquiryType, question_no: questionNo, seq_no: sequenceNo, contents: input.replyText },
    }),
    compatibility: lineage,
    verification: {
      acceptanceIsDeliveryProof: false,
      requiredReadback: { proc_status: "S3", question_no: questionNo, seq_no: sequenceNo },
    },
  };
}

export function prepareQoo10GatewayReply(input: Qoo10ReplyPreparationInput) {
  const prepared = prepareQoo10Reply(input);
  return {
    ...prepared,
    arguments: { params: prepared.params },
  };
}
