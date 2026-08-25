import "server-only";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationResult } from "./operations";
import { normalizeLazadaImHistory } from "./lazada-im";
import { coupangContactCenterParentAnswerId } from "./inquiry-reply";

export type NormalizedChannelInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
  replyContext?: Record<string, unknown>;
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
    const remoteTicketId = text(row.inquiryId, row.counselingId);
    const externalTicketId = remoteTicketId ? `${sourceKind}:${remoteTicketId}` : "";
    const message = text(row.content, row.inquiryContent, row.question, row.inquiry);
    if (!externalTicketId || !message) return null;
    const answered = list(row.commentDtoList).length > 0
      || /ANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase()) && !/NO_ANSWER|NOANSWER/.test(text(row.partnerCounselingStatus, row.answeredType).toUpperCase());
    const parentAnswerId = sourceKind === "call-center"
      ? coupangContactCenterParentAnswerId(row.replies)
      : "";
    return {
      externalTicketId,
      customerName: text(row.customerName, row.customerId, "쿠팡 고객"),
      subject: text(row.productName, row.title, "쿠팡 고객 문의"),
      message,
      status: answered ? "resolved" : "waiting",
      priority: /URGENT|TRANSFER/.test(text(row.partnerCounselingStatus).toUpperCase()) ? 2 : 3,
      receivedAt: iso(row.inquiryAt, row.createdAt, row.receivedAt),
      replyContext: parentAnswerId ? { parentAnswerId } : {},
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
    const inquiryType = text(row.INQ_TYPE, row.inq_type).toUpperCase();
    const questionNo = text(row.QUESTION_NO, row.question_no);
    const sequenceNo = text(row.SEQ_NO, row.seq_no);
    const message = text(row.CONTENTS, row.contents, row.InquiryContent, row.Message, row.Content, row.Question);
    if (!(["MSG", "HELP", "ITEM"] as const).includes(inquiryType as "MSG" | "HELP" | "ITEM") || !questionNo || !sequenceNo || !message) return null;
    return {
      externalTicketId: `qoo10:${inquiryType}:${questionNo}:${sequenceNo}`,
      customerName: text(row.CUST_NM, row.BuyerId, row.CustomerName, "Qoo10 고객"),
      subject: text(row.TITLE, row.GD_NM, row.ItemTitle, row.Title, "Qoo10 고객 문의"),
      message,
      status: /S3|ANSWER|COMPLETE/.test(text(row.STATUS, row.Status, row.AnswerYN).toUpperCase()) ? "resolved" : "waiting",
      priority: 3,
      receivedAt: iso(row.INQ_DT, row.InquiryDate, row.CreatedDate, row.RegDate),
    };
  }).filter((row): row is NormalizedChannelInquiry => Boolean(row));
}

function normalizeTemu(data: Record<string, unknown>) {
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
  return rows.map((row): NormalizedChannelInquiry | null => {
    const afterSalesSn = text(row.parentAfterSalesSn);
    if (!afterSalesSn) return null;
    const orderSn = text(row.parentOrderSn);
    const group = text(row.afterSalesStatusGroup);
    const typeLabel = Number(row.afterSalesType) === 2 ? "반품·환불" : "환불";
    const deadlineValue = Number(row.operateExpireTimeMs);
    const deadline = Number.isFinite(deadlineValue) && deadlineValue > 0 ? new Date(deadlineValue) : null;
    const operations = Array.isArray(row.availableOperateList)
      ? row.availableOperateList.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 10)
      : [];
    const deadlineText = deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : "없음";
    const remaining = deadline && !Number.isNaN(deadline.getTime()) ? deadline.getTime() - Date.now() : Number.POSITIVE_INFINITY;
    return {
      externalTicketId: `aftersales:${afterSalesSn}`,
      customerName: "Temu 구매자",
      subject: `${typeLabel} 요청${orderSn ? ` · 주문 ${orderSn}` : ""}`,
      message: `상태: ${groupLabel[group] ?? text(row.parentAfterSalesStatus, group, "확인 필요")} · 처리기한: ${deadlineText}${operations.length ? ` · 가능 작업: ${operations.join(", ")}` : ""}`,
      status: ["5", "6", "7"].includes(group) ? "resolved" : "waiting",
      priority: remaining <= 24 * 60 * 60 * 1000 ? 1 : remaining <= 72 * 60 * 60 * 1000 ? 2 : 3,
      receivedAt: iso(row.updateAt, row.createAt),
    };
  }).filter((row): row is NormalizedChannelInquiry => Boolean(row));
}

export function normalizeChannelInquiries(channel: ActiveChannelKey, result: ChannelOperationResult): NormalizedChannelInquiry[] {
  if (channel === "temu") {
    const normalized = result.steps
      .filter((item) => /^inquiries(?::\d+)?$/.test(item.name))
      .flatMap((item) => normalizeTemu(item.data));
    return [...new Map(normalized.map((inquiry) => [inquiry.externalTicketId, inquiry])).values()];
  }
  const data = result.steps.find((step) => step.name === "inquiries")?.data ?? result.steps.at(-1)?.data ?? {};
  const normalized = channel === "lazada" ? normalizeLazadaImHistory(result.steps)
    : channel === "coupang" ? normalizeCoupang(data)
    : channel === "smartstore" ? normalizeSmartstore(data)
      : channel === "qoo10" ? normalizeQoo10(data)
        : [];
  return [...new Map(normalized.map((inquiry) => [inquiry.externalTicketId, inquiry])).values()];
}

export { inquirySyncArguments } from "./sync-arguments";
