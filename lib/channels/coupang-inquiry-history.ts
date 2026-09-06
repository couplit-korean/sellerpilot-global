import { createHash } from "node:crypto";
import type { BaseNormalizedChannelInquiry } from "./inquiry-sync";
import { originalMessageBody, providerMessageTimestamp } from "./cs-history-values";
import { createTimestampNormalizer } from "./normalization-time";
import { coupangContactCenterParentAnswerId } from "./inquiry-reply";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

export function normalizeCoupangInquiries(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const root = object(data.data);
  const rows = list(root.content).length ? list(root.content) : list(data.data);
  return rows.flatMap((row): BaseNormalizedChannelInquiry[] => {
    const sourceKind = text(data.sellerpilotInquiryKind, "product");
    const remoteTicketId = text(row.inquiryId, row.counselingId);
    const externalTicketId = remoteTicketId ? `${sourceKind}:${remoteTicketId}` : "";
    const message = originalMessageBody(row.content, row.inquiryContent, row.question, row.inquiry);
    if (!externalTicketId || !message) return [];
    const answered = text(row.csPartnerCounselingStatus).toLowerCase() === "answered" || list(row.commentDtoList).length > 0
      || /ANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase()) && !/NO_ANSWER|NOANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase());
    const parentAnswerId = sourceKind === "call-center"
      ? coupangContactCenterParentAnswerId(row.replies)
      : "";
    const inquiry: BaseNormalizedChannelInquiry = {
      externalTicketId,
      customerName: text(row.customerName, row.customerId, "쿠팡 고객"),
      subject: text(row.productName, row.itemName, row.title, "쿠팡 고객 문의"),
      message,
      status: answered ? "resolved" : "waiting",
      priority: /URGENT|TRANSFER/.test(text(row.partnerCounselingStatus).toUpperCase()) ? 2 : 3,
      receivedAt: iso(row.inquiryAt, row.createdAt, row.receivedAt),
      remoteMessageId: remoteTicketId,
      ...(text(row.orderId, Array.isArray(row.orderIds) && row.orderIds.length === 1 ? row.orderIds[0] : undefined)
        ? { externalOrderReference: text(row.orderId, Array.isArray(row.orderIds) && row.orderIds.length === 1 ? row.orderIds[0] : undefined) }
        : {}),
      providerContext: {
        kind: sourceKind,
        inquiryId: remoteTicketId,
        ...(parentAnswerId ? { parentAnswerId } : {}),
      },
      replyContext: parentAnswerId ? { parentAnswerId } : {},
    };
    const events: BaseNormalizedChannelInquiry[] = [inquiry];
    const undated: Array<{body:string;reason:string}> = [];
    const replies = sourceKind === "call-center" ? list(row.replies) : list(row.commentDtoList);
    for (const reply of replies) {
      const body = originalMessageBody(reply.content);
      if (!body) continue;
      if (body.length > 20000) throw new Error("COUPANG_ANSWER_BODY_LIMIT");
      const role = sourceKind !== "call-center" || text(reply.answerType).toLowerCase() === "vendor" ? "seller" : "system";
      const at = providerMessageTimestamp(sourceKind === "call-center" ? reply.replyAt : reply.inquiryCommentAt);
      if (!at) {
        // The existing undated note projection labels seller replies only.
        // Do not mislabel an undated customer-center notice as a seller reply.
        if (role === "seller") undated.push({body,reason:"provider_timestamp_unavailable"});
        else throw new Error("COUPANG_CENTER_MESSAGE_TIME_REQUIRED");
        continue;
      }
      const id=text(reply.inquiryCommentId,reply.answerId);
      const revision=createHash("sha256").update([sourceKind,id,role,at,body].join("\u001f")).digest("hex");
      events.push({...inquiry,message:body,senderRole:role,receivedAt:at,
        remoteMessageId:`coupang:answer-observation:${revision}`,
        providerContext:{...inquiry.providerContext,historyOnly:true,answerId:id,answerType:role === "seller" ? "vendor" : text(reply.answerType,"unknown"),identitySource:"answer_observation_digest"},
      });
    }
    inquiry.providerContext={...inquiry.providerContext,unsequencedAnswers:undated};
    if (undated.length > 100 || Buffer.byteLength(JSON.stringify(inquiry.providerContext),"utf8") > 60000) throw new Error("COUPANG_ANSWER_CONTEXT_LIMIT");
    return events;
  });
}
