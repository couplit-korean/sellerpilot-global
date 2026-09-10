import { inquiryRows } from "./inquiry-page.ts";
import { createHash } from "node:crypto";
import type { BaseNormalizedChannelInquiry } from "./inquiry-sync.ts";
import { originalMessageBody, providerMessageTimestamp } from "./cs-history-values.ts";
import { createTimestampNormalizer } from "./normalization-time.ts";
import { coupangContactCenterReplyTarget } from "./cs/coupang/contact-center.ts";
import { parseCoupangProviderTicketIdentity } from "../cs/channels/coupang/ticket-identity.ts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => value === undefined || value === null
  ? [] : inquiryRows("coupang:answers", value);
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

export function normalizeCoupangInquiries(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const root = object(data.data);
  const rows = data.sellerpilotReadMode === "call-center-detail" && text(root.inquiryId)
    ? [root]
    : inquiryRows("coupang", root.content, Array.isArray(data.data) ? data.data : undefined);
  return rows.flatMap((row): BaseNormalizedChannelInquiry[] => {
    const sourceKind = text(data.sellerpilotInquiryKind, "product");
    const remoteTicketId = text(row.inquiryId, row.counselingId);
    const externalTicketId = remoteTicketId ? `${sourceKind}:${remoteTicketId}` : "";
    const message = originalMessageBody(row.content, row.inquiryContent, row.question, row.inquiry);
    if (!externalTicketId || !message) throw new Error("INQUIRY_RECORD_INVALID:coupang");
    const providerIdentity = parseCoupangProviderTicketIdentity(externalTicketId);
    const answered = text(row.csPartnerCounselingStatus).toLowerCase() === "answered" || list(row.commentDtoList).length > 0
      || /ANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase()) && !/NO_ANSWER|NOANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase());
    const replyTarget = sourceKind === "call-center"
      ? coupangContactCenterReplyTarget(row)
      : null;
    const parentAnswerId = replyTarget?.state === "ready"
      ? replyTarget.parentAnswerId
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
        nativeExternalTicketId: providerIdentity.providerExternalTicketId,
        ...(parentAnswerId ? { parentAnswerId } : {}),
        ...(replyTarget ? {
          replyTargetState: replyTarget.state,
          ...(replyTarget.latestInboundAnswerId ? { latestInboundAnswerId: replyTarget.latestInboundAnswerId } : {}),
          ...(replyTarget.latestInboundAt ? { latestInboundAt: replyTarget.latestInboundAt } : {}),
        } : {}),
      },
      replyContext: parentAnswerId ? {
        parentAnswerId,
        latestInboundAnswerId: replyTarget?.latestInboundAnswerId,
        latestInboundAt: replyTarget?.latestInboundAt,
      } : {},
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
      const directParentAnswerId = sourceKind === "call-center" && role === "seller"
        && /^[1-9]\d*$/u.test(text(reply.parentAnswerId))
        ? text(reply.parentAnswerId)
        : "";
      const historyProviderContext = { ...inquiry.providerContext };
      delete historyProviderContext.nativeExternalTicketId;
      delete historyProviderContext.parentAnswerId;
      delete historyProviderContext.replyTargetState;
      delete historyProviderContext.latestInboundAnswerId;
      delete historyProviderContext.latestInboundAt;
      const revision=createHash("sha256").update([sourceKind,id,role,at,body].join("\u001f")).digest("hex");
      events.push({...inquiry,message:body,senderRole:role,receivedAt:at,
        remoteMessageId:`coupang:answer-observation:${revision}`,
        replyContext:{},
        providerContext:{...historyProviderContext,historyOnly:true,answerId:id,
          ...(directParentAnswerId ? { parentAnswerId: directParentAnswerId } : {}),
          answerType:role === "seller" ? "vendor" : text(reply.answerType,"unknown"),identitySource:"answer_observation_digest"},
      });
    }
    inquiry.providerContext={...inquiry.providerContext,unsequencedAnswers:undated};
    if (undated.length > 100 || Buffer.byteLength(JSON.stringify(inquiry.providerContext),"utf8") > 60000) throw new Error("COUPANG_ANSWER_CONTEXT_LIMIT");
    return events;
  });
}
