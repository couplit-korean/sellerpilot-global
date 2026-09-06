import "server-only";
import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationResult } from "./operations";
import { normalizeLazadaImHistory } from "./lazada-im";
import { normalizeCoupangInquiries } from "./coupang-inquiry-history";
import { ebayAsqMarketplaceId } from "./ebay-asq";
import { canonicalNormalizationTimestamp, createTimestampNormalizer } from "./normalization-time";
import { originalMessageBody } from "./cs-history-values";
import { normalizeSmartstoreInquiries } from "./smartstore-inquiry-history";

export type BaseNormalizedChannelInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
  remoteMessageId?: string;
  senderRole?: "customer" | "seller" | "system";
  orderingStatus?: "unverified" | "conflict";
  providerContext?: Record<string, unknown>;
  externalOrderReference?: string;
  ticketKind?: "conversation" | "after_sales";
  replyContext?: Record<string, unknown>;
};

export type NormalizedChannelInquiry = BaseNormalizedChannelInquiry & {
  inboundKey: string;
  providerStatus: "waiting" | "answered";
  providerContext: Record<string, unknown>;
  ticketKind: "conversation" | "after_sales";
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

function finalizeInquiry(channel: ActiveChannelKey, inquiry: BaseNormalizedChannelInquiry): NormalizedChannelInquiry {
  const remoteMessageId = text(inquiry.remoteMessageId);
  const providerContext = inquiry.providerContext ?? inquiry.replyContext ?? {};
  if (!remoteMessageId) throw new Error(`INQUIRY_REMOTE_MESSAGE_ID_REQUIRED:${channel}`);
  const material = ["v2", channel, inquiry.externalTicketId, remoteMessageId].join("\u001f");
  return {
    ...inquiry,
    ...(remoteMessageId ? { remoteMessageId } : {}),
    inboundKey: `${channel}:${createHash("sha256").update(material).digest("hex")}`,
    providerStatus: inquiry.status === "resolved" ? "answered" : "waiting",
    providerContext,
    replyContext: inquiry.replyContext ?? { ...providerContext },
    ticketKind: inquiry.ticketKind ?? "conversation",
  };
}



function normalizeQoo10(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const result = data.ResultObject;
  const rows = list(result).length ? list(result)
    : list(object(result).InquiryInfo).length ? list(object(result).InquiryInfo)
      : list(object(result).InquiryMessage);
  return rows.map((row): BaseNormalizedChannelInquiry | null => {
    const inquiryType = text(row.INQ_TYPE, row.inq_type).toUpperCase();
    const questionNo = text(row.QUESTION_NO, row.question_no);
    const sequenceNo = text(row.SEQ_NO, row.seq_no);
    const message = originalMessageBody(row.CONTENTS, row.contents, row.InquiryContent, row.Message, row.Content, row.Question);
    if (!(["MSG", "HELP", "ITEM"] as const).includes(inquiryType as "MSG" | "HELP" | "ITEM") || !questionNo || !sequenceNo || !message) return null;
    return {
      externalTicketId: `qoo10:${inquiryType}:${questionNo}:${sequenceNo}`,
      customerName: text(row.CUST_NM, row.BuyerId, row.CustomerName, "Qoo10 고객"),
      subject: text(row.TITLE, row.GD_NM, row.ItemTitle, row.Title, "Qoo10 고객 문의"),
      message,
      status: /S3|ANSWER|COMPLETE/.test(text(row.STATUS, row.Status, row.AnswerYN).toUpperCase()) ? "resolved" : "waiting",
      priority: 3,
      receivedAt: iso(row.INQ_DT, row.InquiryDate, row.CreatedDate, row.RegDate),
      remoteMessageId: text(row.MESSAGE_ID, row.MessageId, sequenceNo),
      providerContext: { inquiryType, questionNo, sequenceNo, processingStatus: text(row.STATUS, row.Status) },
      replyContext: { inquiryType, questionNo, sequenceNo },
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

function normalizeTemu(data: Record<string, unknown>, iso: TimestampNormalizer, referenceTimeMs: number) {
  const rows = list(object(data.result).data);
  const groupLabel: Record<string, string> = {
    "1": "판매자 처리 대기",
    "2": "요청 접수",
    "3": "반품 발송",
    "4": "플랫폼 검토",
    "5": "환불 완료",
    "6": "거절 완료",
    "7": "요청 취소",
  };
  return rows.map((row): BaseNormalizedChannelInquiry | null => {
    const afterSalesSn = text(row.parentAfterSalesSn);
    if (!afterSalesSn) return null;
    const orderSn = text(row.parentOrderSn);
    const group = text(row.afterSalesStatusGroup);
    const typeLabel = Number(row.afterSalesType) === 2 ? "반품·환불" : "환불";
    const deadlineValue = Number(row.operateExpireTimeMs);
    const deadline = Number.isFinite(deadlineValue) && deadlineValue > 0 ? new Date(deadlineValue) : null;
    const operations = Array.isArray(row.availableOperateList)
      ? [...new Set(row.availableOperateList.map(String).map((value) => value.trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 10)
      : [];
    const rawUpdateAt = text(row.updateAt);
    const numericUpdateAt = rawUpdateAt && Number.isFinite(Number(rawUpdateAt))
      ? String(Number(rawUpdateAt))
      : "";
    const parsedUpdateAt = !numericUpdateAt && rawUpdateAt ? Date.parse(rawUpdateAt) : Number.NaN;
    const trustedUpdateRevision = numericUpdateAt
      || (Number.isFinite(parsedUpdateAt) ? new Date(parsedUpdateAt).toISOString() : "");
    const stateRevision = [
      "state-v1",
      group,
      text(row.parentAfterSalesStatus),
      text(row.afterSalesType),
      Number.isFinite(deadlineValue) && deadlineValue > 0 ? String(deadlineValue) : "",
      operations.join(","),
    ].join("\u001f");
    const revisionMaterial = trustedUpdateRevision
      ? `updated-at-v1\u001f${trustedUpdateRevision}`
      : stateRevision;
    const providerRevision = createHash("sha256").update(revisionMaterial).digest("hex");
    const deadlineText = deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : "없음";
    const remaining = deadline && !Number.isNaN(deadline.getTime()) ? deadline.getTime() - referenceTimeMs : Number.POSITIVE_INFINITY;
    return {
      externalTicketId: `aftersales:${afterSalesSn}`,
      customerName: "Temu 구매자",
      subject: `${typeLabel} 요청${orderSn ? ` · 주문 ${orderSn}` : ""}`,
      message: `상태: ${groupLabel[group] ?? text(row.parentAfterSalesStatus, group, "확인 필요")} · 처리기한: ${deadlineText}${operations.length ? ` · 가능 작업: ${operations.join(", ")}` : ""}`,
      status: ["5", "6", "7"].includes(group) ? "resolved" : "waiting",
      priority: remaining <= 24 * 60 * 60 * 1000 ? 1 : remaining <= 72 * 60 * 60 * 1000 ? 2 : 3,
      receivedAt: iso(row.updateAt, row.createAt),
      remoteMessageId: `${afterSalesSn}:${providerRevision}`,
      ...(orderSn ? { externalOrderReference: orderSn } : {}),
      ticketKind: "after_sales",
      providerContext: {
        afterSalesSn,
        orderSn,
        statusGroup: group,
        availableOperations: operations,
        providerRevision,
        providerRevisionSource: trustedUpdateRevision ? "updateAt" : "actionableState",
      },
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

function normalizeEbay(data: Record<string, unknown>, iso: TimestampNormalizer) {
  return list(data.memberMessages).map((row): BaseNormalizedChannelInquiry | null => {
    let marketplaceId: string;
    try {
      marketplaceId = ebayAsqMarketplaceId(row.marketplaceId);
    } catch {
      return null;
    }
    const messageId = text(row.messageId);
    const itemId = text(row.itemId);
    const recipientId = text(row.senderId);
    const message = originalMessageBody(row.body);
    if (!messageId || !/^[1-9]\d{0,18}$/.test(itemId) || !recipientId || !message) return null;
    const messageStatus = text(row.messageStatus).toLowerCase();
    return {
      externalTicketId: `ebay:${messageId}`,
      customerName: recipientId,
      subject: text(row.itemTitle, row.subject, "eBay 상품 문의"),
      message,
      status: messageStatus === "answered" ? "resolved" : "waiting",
      priority: 3,
      receivedAt: iso(row.creationDate, row.lastModifiedDate),
      remoteMessageId: messageId,
      providerContext: { itemId, parentMessageId: messageId, recipientId, marketplaceId },
      replyContext: { itemId, parentMessageId: messageId, recipientId, marketplaceId },
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

export function normalizeChannelInquiries(
  channel: ActiveChannelKey,
  result: ChannelOperationResult,
  normalizationTimestamp: string,
): NormalizedChannelInquiry[] {
  const referenceTimestamp = canonicalNormalizationTimestamp(normalizationTimestamp);
  const referenceTimeMs = new Date(referenceTimestamp).getTime();
  const iso = createTimestampNormalizer(referenceTimestamp);
  if (channel === "lazada") {
    const normalized = normalizeLazadaImHistory(result.steps, referenceTimestamp)
      .map((inquiry) => finalizeInquiry(channel, inquiry));
    return [...new Map(normalized.map((inquiry) => [inquiry.orderingStatus === "conflict"
      ? `${inquiry.inboundKey}:${inquiry.senderRole}:${createHash("sha256").update(inquiry.message).digest("hex")}`
      : inquiry.inboundKey, inquiry])).values()];
  }
  const inquirySteps = result.steps.filter((item) => item.ok && /^inquiries(?::\d+)?$/.test(item.name));
  const pageData = inquirySteps.length
    ? inquirySteps.map((item) => item.data)
    : [result.steps.at(-1)?.data ?? {}];
  const normalized = pageData.flatMap((data) => channel === "coupang" ? normalizeCoupangInquiries(data, iso)
    : channel === "smartstore" ? normalizeSmartstoreInquiries(data, iso)
      : channel === "qoo10" ? normalizeQoo10(data, iso)
        : channel === "temu" ? normalizeTemu(data, iso, referenceTimeMs)
          : channel === "ebay" ? normalizeEbay(data, iso)
            : [])
    .map((inquiry) => finalizeInquiry(channel, inquiry));
  // A ticket can carry several immutable messages (or after-sales revisions).
  // Collapse only repeated observations of the same message, not its entire
  // conversation. The persistence ledger owns latest-message ordering.
  return [...new Map(normalized.map((inquiry) => [inquiry.inboundKey, inquiry])).values()];
}

export { inquiryHistorySyncRequests, inquirySyncArguments, inquirySyncRequests } from "./sync-arguments";
