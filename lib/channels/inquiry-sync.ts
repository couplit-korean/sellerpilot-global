import "server-only";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationResult } from "./operations";
import { normalizeLazadaImHistory } from "./lazada-im";

export type NormalizedChannelInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
const iso = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
};

function normalizeCoupang(data: Record<string, unknown>) {
  const root = object(data.data);
  const rows = list(root.content).length ? list(root.content) : list(data.data);
  return rows.map((row): NormalizedChannelInquiry | null => {
    const sourceKind = text(data.sellerpilotInquiryKind, "product");
    const remoteTicketId = text(row.inquiryId, row.counselingId, row.vendorItemId);
    const externalTicketId = remoteTicketId ? `${sourceKind}:${remoteTicketId}` : "";
    const message = text(row.content, row.inquiryContent, row.question, row.inquiry);
    if (!externalTicketId || !message) return null;
    const answered = list(row.commentDtoList).length > 0
      || /ANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase()) && !/NO_ANSWER|NOANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase());
    return {
      externalTicketId,
      customerName: text(row.customerName, row.customerId, "쿠팡 고객"),
      subject: text(row.productName, row.title, "쿠팡 고객 문의"),
      message,
      status: answered ? "resolved" : "waiting",
      priority: /URGENT|TRANSFER/.test(text(row.partnerCounselingStatus).toUpperCase()) ? 2 : 3,
      receivedAt: iso(row.inquiryAt, row.createdAt, row.receivedAt),
    };
  }).filter((row): row is NormalizedChannelInquiry => Boolean(row));
}

function normalizeSmartstore(data: Record<string, unknown>) {
  const root = object(data.data);
  const rows = list(root.contents).length ? list(root.contents)
    : list(root.content).length ? list(root.content)
      : list(data.data).length ? list(data.data)
        : list(data.contents);
  return rows.map((row): NormalizedChannelInquiry | null => {
    const externalTicketId = text(row.questionId, row.inquiryNo);
    const message = text(row.question, row.content);
    if (!externalTicketId || !message) return null;
    return {
      externalTicketId,
      customerName: text(row.maskedWriterId, "네이버 고객"),
      subject: text(row.productName, "스마트스토어 상품 문의"),
      message,
      status: row.answered === true || text(row.answer) ? "resolved" : "waiting",
      priority: 3,
      receivedAt: iso(row.createDate, row.createdAt),
    };
  }).filter((row): row is NormalizedChannelInquiry => Boolean(row));
}

function normalizeQoo10(data: Record<string, unknown>) {
  const result = data.ResultObject;
  const rows = list(result).length ? list(result)
    : list(object(result).InquiryInfo).length ? list(object(result).InquiryInfo)
      : list(object(result).InquiryMessage);
  return rows.map((row): NormalizedChannelInquiry | null => {
    const externalTicketId = text(row.InquiryNo, row.InquiryId, row.QnaNo);
    const message = text(row.InquiryContent, row.Message, row.Content, row.Question);
    if (!externalTicketId || !message) return null;
    return {
      externalTicketId,
      customerName: text(row.BuyerId, row.CustomerName, "Qoo10 고객"),
      subject: text(row.ItemTitle, row.Title, "Qoo10 고객 문의"),
      message,
      status: /ANSWER|COMPLETE/.test(text(row.Status, row.AnswerYN).toUpperCase()) ? "resolved" : "waiting",
      priority: 3,
      receivedAt: iso(row.InquiryDate, row.CreatedDate, row.RegDate),
    };
  }).filter((row): row is NormalizedChannelInquiry => Boolean(row));
}

export function normalizeChannelInquiries(channel: ActiveChannelKey, result: ChannelOperationResult): NormalizedChannelInquiry[] {
  const data = result.steps.find((step) => step.name === "inquiries")?.data ?? result.steps.at(-1)?.data ?? {};
  const normalized = channel === "lazada" ? normalizeLazadaImHistory(result.steps)
    : channel === "coupang" ? normalizeCoupang(data)
    : channel === "smartstore" ? normalizeSmartstore(data)
      : channel === "qoo10" ? normalizeQoo10(data)
        : [];
  return [...new Map(normalized.map((inquiry) => [inquiry.externalTicketId, inquiry])).values()];
}

export { inquirySyncArguments } from "./sync-arguments";
