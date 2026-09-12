import { inquiryRows } from "./inquiry-page.ts";
import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog.ts";
import type { CsOperationResult as ChannelOperationResult } from "../cs/operations/contracts";
import { normalizeLazadaImHistory } from "./lazada-im.ts";
import { normalizeCoupangInquiries } from "./coupang-inquiry-history.ts";
import { ebayAsqMarketplaceId } from "./ebay-asq.ts";
import { canonicalNormalizationTimestamp, createTimestampNormalizer } from "./normalization-time.ts";
import { originalMessageBody } from "./cs-history-values.ts";
import { normalizeSmartstoreInquiries } from "./smartstore-inquiry-history.ts";
import { projectShopeeReturnDetail, shopeeReturnDetailRevision } from "./cs/shopee/return-detail.ts";
import { normalizeElevenstAlimiRow } from "./cs/elevenst/contracts.ts";
import { smartstoreBuyerContentRevision } from "./cs/smartstore/content-revision.ts";
import { temuAfterSalesRevision } from "./cs/temu/revision.ts";
import {
  qoo10ClaimIdentity,
  qoo10InquiryMessageIdentity,
  type Qoo10InquiryAccountIdentity,
} from "./cs/qoo10/inquiry-identity.ts";

import type { BaseNormalizedChannelInquiry, NormalizedChannelInquiry } from "../cs/operations/inquiry-contracts";
export type { BaseNormalizedChannelInquiry, NormalizedChannelInquiry } from "../cs/operations/inquiry-contracts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

function finalizeInquiry(channel: ActiveChannelKey, inquiry: BaseNormalizedChannelInquiry): NormalizedChannelInquiry {
  const remoteMessageId = text(inquiry.remoteMessageId);
  const providerContext = inquiry.providerContext ?? inquiry.replyContext ?? {};
  if (!remoteMessageId) throw new Error(`INQUIRY_REMOTE_MESSAGE_ID_REQUIRED:${channel}`);
  const smartstoreBuyerRevision = channel === "smartstore"
      && inquiry.senderRole !== "seller" && inquiry.senderRole !== "system"
    ? smartstoreBuyerContentRevision(inquiry.message)
    : "";
  const material = smartstoreBuyerRevision
    ? ["v3", channel, inquiry.externalTicketId, remoteMessageId, smartstoreBuyerRevision].join("\u001f")
    : ["v2", channel, inquiry.externalTicketId, remoteMessageId].join("\u001f");
  const accountScopedInboundKey = channel === "qoo10"
    ? text(providerContext.accountScopedInboundKey)
    : "";
  if (accountScopedInboundKey
      && !/^qoo10:(?:inbound|claim-inbound):[a-f0-9]{64}$/u.test(accountScopedInboundKey)) {
    throw new Error("INQUIRY_ACCOUNT_SCOPED_KEY_INVALID:qoo10");
  }
  return {
    ...inquiry,
    ...(remoteMessageId ? { remoteMessageId } : {}),
    inboundKey: accountScopedInboundKey
      || `${channel}:${createHash("sha256").update(material).digest("hex")}`,
    providerStatus: inquiry.status === "resolved" ? "answered" : "waiting",
    providerContext,
    replyContext: inquiry.replyContext ?? { ...providerContext },
    ticketKind: inquiry.ticketKind ?? "conversation",
  };
}



type Qoo10NormalizationIdentity = {
  account: Qoo10InquiryAccountIdentity;
  sourceCredentialId: string;
};

function normalizeQoo10(
  data: Record<string, unknown>,
  iso: TimestampNormalizer,
  normalizationIdentity?: Qoo10NormalizationIdentity,
) {
  const result = data.ResultObject;
  const rows = inquiryRows("qoo10", Array.isArray(result) ? result : undefined, object(result).InquiryInfo, object(result).InquiryMessage);
  return rows.map((row): BaseNormalizedChannelInquiry | null => {
    const inquiryType = text(row.INQ_TYPE, row.inq_type).toUpperCase();
    const questionNo = text(row.QUESTION_NO, row.question_no);
    const sequenceNo = text(row.SEQ_NO, row.seq_no);
    const message = originalMessageBody(row.CONTENTS, row.contents, row.InquiryContent, row.Message, row.Content, row.Question);
    if (!(["MSG", "HELP", "ITEM"] as const).includes(inquiryType as "MSG" | "HELP" | "ITEM") || !questionNo || !sequenceNo || !message) throw new Error("INQUIRY_RECORD_INVALID:qoo10");
    const identity = normalizationIdentity ? qoo10InquiryMessageIdentity({
      ...normalizationIdentity,
      inquiryType: inquiryType as "MSG" | "HELP" | "ITEM",
      questionNo,
      sequenceNo,
    }) : null;
    const legacyExternalTicketId = `qoo10:${inquiryType}:${questionNo}:${sequenceNo}`;
    return {
      externalTicketId: identity?.accountScopedConversationKey ?? legacyExternalTicketId,
      customerName: text(row.CUST_NM, row.BuyerId, row.CustomerName, "Qoo10 고객"),
      subject: text(row.TITLE, row.GD_NM, row.ItemTitle, row.Title, "Qoo10 고객 문의"),
      message,
      status: /S3|ANSWER|COMPLETE/.test(text(row.STATUS, row.Status, row.AnswerYN).toUpperCase()) ? "resolved" : "waiting",
      priority: 3,
      receivedAt: iso(row.INQ_DT, row.InquiryDate, row.CreatedDate, row.RegDate),
      remoteMessageId: identity?.remoteMessageId ?? text(row.MESSAGE_ID, row.MessageId, sequenceNo),
      providerContext: {
        inquiryType,
        questionNo,
        sequenceNo,
        processingStatus: text(row.STATUS, row.Status),
        ...(identity ? {
          providerExternalTicketId: identity.externalTicketId,
          ticketIdentityVersion: identity.ticketIdentityVersion,
          messageIdentityVersion: identity.messageIdentityVersion,
          accountIdentityDigest: identity.account.accountIdentityDigest,
          conversationIdentityDigest: identity.conversationIdentityDigest,
          messageIdentityDigest: identity.messageIdentityDigest,
          accountScopedInboundKey: identity.accountScopedInboundKey,
          legacyExternalTicketIds: [identity.legacyExternalTicketId],
        } : {}),
      },
      replyContext: {
        inquiryType,
        questionNo,
        sequenceNo,
        ...(identity ? { legacyExternalTicketId: identity.legacyExternalTicketId } : {}),
      },
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

const qoo10ClaimStatusLabels: Record<string, string> = {
  "1": "취소 요청",
  "2": "취소 처리 중",
  "3": "취소 완료",
  "4": "반품 요청",
  "5": "반품 처리 중",
  "6": "반품 완료",
  "11": "교환 요청",
  "12": "교환 승인",
  "13": "재배송",
  "14": "미수취 전액 환불 완료",
  "15": "미수취 부분 환불 완료",
  "16": "미결제 주문 취소",
};

function qoo10ClaimTimestamp(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const digits = raw.match(/^(\d{4})(?:-?)(\d{2})(?:-?)(\d{2})(?:[ T]?)(\d{2})?(?::?)(\d{2})?(?::?)(\d{2})?$/u);
  let expression = raw;
  if (digits) {
    const [, yearValue, monthValue, dayValue, hourValue = "00", minuteValue = "00", secondValue = "00"] = digits;
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const hour = Number(hourValue);
    const minute = Number(minuteValue);
    const second = Number(secondValue);
    const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
    const japan = new Date(utc + 9 * 60 * 60 * 1_000);
    if (japan.getUTCFullYear() !== year || japan.getUTCMonth() + 1 !== month
        || japan.getUTCDate() !== day || japan.getUTCHours() !== hour
        || japan.getUTCMinutes() !== minute || japan.getUTCSeconds() !== second) {
      throw new Error("INQUIRY_RECORD_INVALID:qoo10");
    }
    expression = new Date(utc).toISOString();
  }
  const timestamp = Date.parse(expression);
  if (!Number.isFinite(timestamp)) throw new Error("INQUIRY_RECORD_INVALID:qoo10");
  return new Date(timestamp).toISOString();
}

function normalizeQoo10Claims(
  data: Record<string, unknown>,
  normalizationIdentity?: Qoo10NormalizationIdentity,
) {
  const result = data.ResultObject;
  const rows = inquiryRows("qoo10", Array.isArray(result) ? result : undefined, object(result).ClaimInfo);
  return rows.map((row): BaseNormalizedChannelInquiry => {
    const claimStatus = text(row.claimStatus, row.ClaimStatus);
    const orderNo = text(row.orderNo, row.OrderNo);
    const requestDate = qoo10ClaimTimestamp(row.requestDate ?? row.RequestDate);
    if (!qoo10ClaimStatusLabels[claimStatus] || !/^[1-9]\d{0,19}$/u.test(orderNo) || !requestDate) {
      throw new Error("INQUIRY_RECORD_INVALID:qoo10");
    }
    const optionalTimestamp = (...values: unknown[]) => {
      const value = values.find((item) => text(item));
      return value === undefined ? "" : qoo10ClaimTimestamp(value);
    };
    const requestDateKey = requestDate.replace(/\D/gu, "").slice(0, 14);
    const state = {
      kind: "claim",
      orderNo,
      claimStatus,
      requestDate,
      cancelRefundDate: optionalTimestamp(row.cancelRefundDate, row.CancelRefundDate),
      orderDate: optionalTimestamp(row.orderDate, row.OrderDate),
      paymentDate: optionalTimestamp(row.paymentDate, row.PaymentDate),
      shippingDate: optionalTimestamp(row.shippingDate, row.ShippingDate),
      deliveredDate: optionalTimestamp(row.deliveredDate, row.DeliveredDate),
      reason: text(row.reason, row.Reason),
      itemCode: text(row.itemCode, row.ItemCode),
      sellerItemCode: text(row.sellerItemCode, row.SellerItemCode),
      itemTitle: text(row.itemTitle, row.ItemTitle),
      orderQty: text(row.orderQty, row.OrderQty),
      paymentNation: text(row.paymentNation, row.PaymentNation),
      currency: text(row.currency, row.Currency),
      paymentAmount: text(row.paymentAmount, row.PaymentAmount),
      deliveryCompany: text(row.deliveryCompany, row.DeliveryCompany),
      trackingNo: text(row.trackingNo, row.TrackingNo),
      deliveryCompanyReturn: text(row.deliveryCompanyReturn, row.DeliveryCompanyReturn),
      trackingNoReturn: text(row.trackingNoReturn, row.TrackingNoReturn),
      itemCondition: text(row.itemCondition, row.ItemCondition),
      nrDutyTarget: text(row.nrDutyTarget, row.NrDutyTarget),
      nrSolType: text(row.nrSolType, row.NrSolType),
      nrPartRefundCnt: text(row.nrPartRefundCnt, row.NrPartRefundCnt),
      nrPartRefundBalance: text(row.nrPartRefundBalance, row.NrPartRefundBalance),
      replySupported: false,
    };
    const providerRevision = createHash("sha256")
      .update(JSON.stringify(state))
      .digest("hex");
    const identity = normalizationIdentity ? qoo10ClaimIdentity({
      ...normalizationIdentity,
      orderNo,
      requestDateKey,
      providerRevision,
    }) : null;
    const label = qoo10ClaimStatusLabels[claimStatus];
    return {
      externalTicketId: identity?.accountScopedConversationKey
        ?? `qoo10:claim:${orderNo}:${requestDateKey}`,
      customerName: "Qoo10 주문 고객",
      subject: `Qoo10 ${label} · ${state.itemTitle || `주문 ${orderNo}`}`,
      message: state.reason || `상태: ${label}`,
      status: ["3", "6", "14", "15", "16"].includes(claimStatus) ? "resolved" : "waiting",
      priority: ["1", "4", "11"].includes(claimStatus) ? 2 : 3,
      receivedAt: requestDate,
      remoteMessageId: identity?.accountScopedInboundKey
        ?? `claim:${orderNo}:${requestDateKey}:${providerRevision}`,
      senderRole: "customer",
      externalOrderReference: orderNo,
      ticketKind: "after_sales",
      providerContext: {
        ...state,
        providerRevision,
        ...(identity ? {
          providerExternalTicketId: identity.externalTicketId,
          ticketIdentityVersion: identity.ticketIdentityVersion,
          messageIdentityVersion: identity.messageIdentityVersion,
          accountIdentityDigest: identity.account.accountIdentityDigest,
          conversationIdentityDigest: identity.conversationIdentityDigest,
          messageIdentityDigest: identity.messageIdentityDigest,
          accountScopedInboundKey: identity.accountScopedInboundKey,
          legacyExternalTicketIds: [identity.legacyExternalTicketId],
        } : {}),
      },
      replyContext: {},
    };
  });
}

function elevenstKoreaTimestamp(value: unknown) {
  const raw = text(value);
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u.exec(raw);
  if (!match) throw new Error("INQUIRY_RECORD_INVALID:elevenst");
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue = "00", millisecondValue = "0"] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = hourValue === undefined ? 0 : Number(hourValue);
  const minute = minuteValue === undefined ? 0 : Number(minuteValue);
  const second = Number(secondValue);
  const millisecond = Number(millisecondValue.padEnd(3, "0"));
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second, millisecond);
  const local = new Date(utc + 9 * 60 * 60 * 1_000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month
      || local.getUTCDate() !== day || local.getUTCHours() !== hour
      || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second
      || local.getUTCMilliseconds() !== millisecond) {
    throw new Error("INQUIRY_RECORD_INVALID:elevenst");
  }
  return { timestamp: new Date(utc).toISOString(), precise: hourValue !== undefined };
}

function normalizeElevenst(data: Record<string, unknown>) {
  const kind = text(data.sellerpilotInquiryKind);
  if (kind === "urgent_alimi") {
    const rows = inquiryRows("elevenst", data.alimListInfos);
    return rows.map((row): BaseNormalizedChannelInquiry => {
      const record = normalizeElevenstAlimiRow(row);
      const resolved = ["03", "05", "06"].includes(record.status);
      const providerContext = {
        kind: record.kind,
        emerNtceSeq: record.emerNtceSeq,
        emerCtntSeq: record.emerCtntSeq,
        type: record.type,
        status: record.status,
        replyDueDate: record.replyDueDate,
        orderNo: record.orderNo,
        orderProductSequence: record.orderProductSequence,
        replySupported: false,
        sourceDigest: record.sourceDigest,
        unsequencedReplies: record.replies.map((body) => ({
          body,
          reason: "provider_timestamp_unavailable",
        })),
      };
      return {
        externalTicketId: `elevenst:alimi:${record.emerNtceSeq}`,
        customerName: record.kind === "urgent_notice" ? "11번가 시스템" : "11번가 고객",
        subject: record.subject,
        message: record.body,
        status: resolved ? "resolved" : "waiting",
        priority: 1,
        receivedAt: record.createdAt,
        remoteMessageId: `alimi:${record.emerNtceSeq}:${record.emerCtntSeq}:inbound`,
        senderRole: record.kind === "urgent_notice" ? "system" : "customer",
        ...(record.orderNo ? { externalOrderReference: record.orderNo } : {}),
        providerContext,
        replyContext: {},
      };
    });
  }
  if (kind && kind !== "product_qna") throw new Error("INQUIRY_RECORD_INVALID:elevenstKind");
  const rows = inquiryRows("elevenst", data.productQnas);
  return rows.flatMap((row): BaseNormalizedChannelInquiry[] => {
    const brdInfoNo = text(row.brdInfoNo);
    const prdNo = text(row.brdInfoClfNo);
    const question = originalMessageBody(row.brdInfoCont);
    const answerYn = text(row.answerYn).toUpperCase();
    const qnaTypeCode = text(row.qnaDtlsCd);
    const buyYn = text(row.buyYn).toUpperCase();
    const dispYn = text(row.dispYn).toUpperCase();
    if (!/^[1-9]\d{0,19}$/u.test(brdInfoNo)
        || !/^[1-9]\d{0,19}$/u.test(prdNo)
        || !question
        || !["Y", "N"].includes(answerYn)
        || !["01", "02", "03", "04", "05"].includes(qnaTypeCode)
        || (buyYn && !["Y", "N"].includes(buyYn))
        || (dispYn && !["Y", "N"].includes(dispYn))) {
      throw new Error("INQUIRY_RECORD_INVALID:elevenst");
    }
    const created = elevenstKoreaTimestamp(row.createDt);
    if (!created.precise) throw new Error("INQUIRY_RECORD_INVALID:elevenst");
    const answer = originalMessageBody(row.answerCont);
    const answerDate = text(row.answerDt);
    const answerTime = answerDate ? elevenstKoreaTimestamp(answerDate) : null;
    if (answerYn === "Y" && (!answer || !answerTime)) {
      throw new Error("INQUIRY_RECORD_INVALID:elevenst");
    }
    const orderNo = text(row.ordNoDe);
    if (orderNo && !/^[1-9]\d{0,19}$/u.test(orderNo)) {
      throw new Error("INQUIRY_RECORD_INVALID:elevenst");
    }
    const unsequencedAnswers = answer && answerTime && !answerTime.precise
      ? [{ body: answer, reason: "provider_timestamp_unavailable" as const }]
      : [];
    const providerContext = {
      kind: "product_qna",
      brdInfoNo,
      prdNo,
      qnaTypeCode,
      qnaType: text(row.qnaDtlsCdNm),
      buyYn,
      dispYn,
      answerYn,
      answerDate,
      orderNo,
      orderPaymentDate: text(row.ordStlEndDt),
      unsequencedAnswers,
    };
    if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60_000) {
      throw new Error("ELEVENST_PRODUCT_QNA_CONTEXT_LIMIT");
    }
    const buyer: BaseNormalizedChannelInquiry = {
      externalTicketId: `elevenst:${brdInfoNo}`,
      customerName: text(row.customerName, "11번가 고객"),
      subject: text(row.brdInfoSbjct, row.prdNm, "11번가 상품 Q&A"),
      message: question,
      status: answerYn === "Y" ? "resolved" : "waiting",
      priority: ["02", "03", "04"].includes(qnaTypeCode) ? 2 : 3,
      receivedAt: created.timestamp,
      remoteMessageId: `qna:${brdInfoNo}:question`,
      senderRole: "customer",
      ...(orderNo ? { externalOrderReference: orderNo } : {}),
      providerContext,
      replyContext: { brdInfoNo, prdNo },
    };
    if (!answer || !answerTime?.precise) return [buyer];
    const answerRevision = createHash("sha256").update(answer).digest("hex");
    return [buyer, {
      externalTicketId: buyer.externalTicketId,
      customerName: buyer.customerName,
      subject: buyer.subject,
      message: answer,
      status: "resolved",
      priority: buyer.priority,
      receivedAt: answerTime.timestamp,
      remoteMessageId: `qna:${brdInfoNo}:answer:${answerRevision}`,
      senderRole: "seller",
      ...(orderNo ? { externalOrderReference: orderNo } : {}),
      providerContext: { ...providerContext, answerRevision },
      replyContext: { brdInfoNo, prdNo },
    }];
  });
}

function normalizeTemu(data: Record<string, unknown>, iso: TimestampNormalizer, referenceTimeMs: number) {
  const detail = object(data.result);
  const listSummary = object(data.sellerpilotListSummary);
  const detailed = Array.isArray(detail.afterSalesList);
  const rows = detailed
    ? [{ ...detail, ...listSummary, afterSalesList: detail.afterSalesList }]
    : inquiryRows("temu", detail.data);
  const groupLabel: Record<string, string> = {
    "1": "판매자 처리 대기",
    "2": "요청 접수",
    "3": "반품 발송",
    "4": "플랫폼 검토",
    "5": "환불 완료",
    "6": "거절 완료",
    "7": "요청 취소",
  };
  const money = (value: unknown) => {
    const amount = object(value);
    return { currency: text(amount.currency), amount: text(amount.amount) };
  };
  return rows.map((row): BaseNormalizedChannelInquiry | null => {
    const afterSalesSn = text(row.parentAfterSalesSn);
    if (!afterSalesSn) throw new Error("INQUIRY_RECORD_INVALID:temu");
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
    const afterSalesCases = (Array.isArray(row.afterSalesList) ? row.afterSalesList : [])
      .map((value) => object(value))
      .map((item) => ({
        afterSalesSn: text(item.afterSalesSn),
        orderSn: text(item.orderSn),
        reasonCode: text(item.afterSalesReasonCode),
        reason: text(item.afterSalesReasonDesc),
        buyerComment: originalMessageBody(item.buyerComment),
        status: text(item.afterSalesStatus),
        requestedQuantity: Number.isSafeInteger(Number(item.applyAfterSalesGoodsNumber))
          ? Number(item.applyAfterSalesGoodsNumber)
          : null,
        requestedRefund: money(item.applyRefundAmount),
      }))
      .sort((left, right) => `${left.afterSalesSn}\u001f${left.orderSn}`.localeCompare(`${right.afterSalesSn}\u001f${right.orderSn}`));
    if (detailed && (!afterSalesCases.length || afterSalesCases.some((item) =>
      !item.afterSalesSn || !item.orderSn || item.orderSn !== orderSn))) {
      throw new Error("INQUIRY_RECORD_INVALID:temu");
    }
    const rawRefundSummary = object(row.refundSummary);
    const refundSummary = Object.fromEntries([
      "discountFromSellerRefund",
      "discountFromTEMURefund",
      "buyerTotalRefund",
      "shippingAmountRefundTaxExcl",
      "taxTotalRefund",
      "retailPriceRefundTaxExcl",
    ].map((key) => [key, money(rawRefundSummary[key])]).filter(([, value]) => {
      const amount = value as { currency: string; amount: string };
      return Boolean(amount.currency || amount.amount);
    }));
    const revision = temuAfterSalesRevision({
      listUpdateAt: row.updateAt,
      lastUpdateAtMillis: detailed ? row.lastUpdateAtMillis : undefined,
      statusGroup: group,
      parentAfterSalesStatus: text(row.parentAfterSalesStatus),
      afterSalesType: text(row.afterSalesType),
      operateExpireTimeMs: Number.isFinite(deadlineValue) && deadlineValue > 0 ? deadlineValue : null,
      availableOperations: operations,
      afterSalesCases,
      refundSummary,
    });
    const deadlineText = deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : "없음";
    const remaining = deadline && !Number.isNaN(deadline.getTime()) ? deadline.getTime() - referenceTimeMs : Number.POSITIVE_INFINITY;
    const buyerMessages = [...new Set(afterSalesCases.map((item) => item.buyerComment).filter(Boolean))];
    const reasons = [...new Set(afterSalesCases.map((item) => item.reason).filter(Boolean))];
    const detailText = buyerMessages.length
      ? buyerMessages.join("\n")
      : reasons.length
        ? reasons.join("\n")
        : `상태: ${groupLabel[group] ?? text(row.parentAfterSalesStatus, group, "확인 필요")} · 처리기한: ${deadlineText}${operations.length ? ` · 가능 작업: ${operations.join(", ")}` : ""}`;
    if (detailText.length > 20_000) throw new Error("INQUIRY_RECORD_INVALID:temu");
    const providerContext = {
      afterSalesSn,
      orderSn,
      statusGroup: group,
      availableOperations: operations,
      providerRevision: revision.providerRevision,
      providerRevisionSource: revision.providerRevisionSource,
      replySupported: false,
      ...(detailed ? {
        afterSalesCases,
        refundSummary,
        detailContract: "temu.aftersales.parentaftersales.detail.get",
      } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60_000) {
      throw new Error("TEMU_AFTER_SALES_CONTEXT_LIMIT");
    }
    return {
      externalTicketId: `aftersales:${afterSalesSn}`,
      customerName: "Temu 구매자",
      subject: `${typeLabel} 요청${orderSn ? ` · 주문 ${orderSn}` : ""}`,
      message: detailText,
      status: ["5", "6", "7"].includes(group) ? "resolved" : "waiting",
      priority: remaining <= 24 * 60 * 60 * 1000 ? 1 : remaining <= 72 * 60 * 60 * 1000 ? 2 : 3,
      receivedAt: revision.detailUpdatedAt ?? iso(row.updateAt, row.createAt),
      remoteMessageId: `${afterSalesSn}:${revision.providerRevision}`,
      ...(orderSn ? { externalOrderReference: orderSn } : {}),
      ticketKind: "after_sales",
      providerContext,
      replyContext: {},
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

function optionalCoupangRows(value: unknown, label: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100
      || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`COUPANG_AFTER_SALES_${label}_INVALID`);
  }
  return value as Record<string, unknown>[];
}

function coupangAfterSalesTimestamp(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(trimmed)
    ? `${trimmed}+09:00`
    : trimmed;
}

function normalizeCoupangAfterSales(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const kind = text(data.sellerpilotInquiryKind);
  if (!["return_request", "cancel_request", "exchange_request"].includes(kind)) {
    throw new Error("INQUIRY_RECORD_INVALID:coupangAfterSalesKind");
  }
  const rows = inquiryRows("coupang", data.data);
  return rows.map((row): BaseNormalizedChannelInquiry => {
    const orderId = text(row.orderId);
    if (!/^[1-9]\d{0,19}$/u.test(orderId)) {
      throw new Error("INQUIRY_RECORD_INVALID:coupangAfterSales");
    }

    if (kind === "exchange_request") {
      const exchangeId = text(row.exchangeId);
      const status = text(row.exchangeStatus).toUpperCase();
      const reasonCode = text(row.reasonCode);
      const reasonCodeText = originalMessageBody(row.reasonCodeText);
      const reasonDetail = originalMessageBody(row.reasonEtcDetail);
      const cancelReason = originalMessageBody(row.cancelReason);
      if (!/^[1-9]\d{0,19}$/u.test(exchangeId)
          || !["RECEIPT", "PROGRESS", "SUCCESS", "REJECT", "CANCEL"].includes(status)) {
        throw new Error("INQUIRY_RECORD_INVALID:coupangExchange");
      }
      const exchangeItems = optionalCoupangRows(row.exchangeItemDtoV1s, "EXCHANGE_ITEMS")
        .map((item) => ({
          exchangeItemId: text(item.exchangeItemId),
          orderItemId: text(item.orderItemId),
          targetItemId: text(item.targetItemId),
          orderItemName: text(item.orderItemName),
          targetItemName: text(item.targetItemName),
          quantity: Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null,
          originalShipmentBoxId: text(item.originalShipmentBoxId),
        }));
      const providerContext = {
        kind,
        exchangeId,
        exchangeStatus: status,
        orderDeliveryStatus: text(row.orderDeliveryStatusCode),
        referType: text(row.referType),
        faultType: text(row.faultType),
        reasonCode,
        reasonCodeText,
        reasonDetail,
        cancelReason,
        createdByType: text(row.createdByType),
        deliveryStatus: text(row.deliveryStatus),
        collectStatus: text(row.collectStatus),
        exchangeItems,
        replySupported: false,
      };
      if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60_000) {
        throw new Error("COUPANG_AFTER_SALES_CONTEXT_LIMIT");
      }
      const providerRevision = createHash("sha256").update(JSON.stringify({
        contract: "coupang-exchange-request-v1",
        modifiedAt: row.modifiedAt,
        providerContext,
      })).digest("hex");
      const message = reasonDetail || reasonCodeText || cancelReason
        || `쿠팡 교환 요청 · ${status}`;
      return {
        externalTicketId: `coupang:exchange:${exchangeId}`,
        customerName: text(object(row.exchangeAddressDtoV1).returnCustomerName, "Coupang 구매자"),
        subject: `쿠팡 교환 요청 · 주문 ${orderId}`,
        message,
        status: ["SUCCESS", "REJECT", "CANCEL"].includes(status) ? "resolved" : "waiting",
        priority: ["RECEIPT", "PROGRESS"].includes(status) ? 2 : 3,
        receivedAt: iso(coupangAfterSalesTimestamp(row.modifiedAt), coupangAfterSalesTimestamp(row.createdAt)),
        remoteMessageId: `exchange:${exchangeId}:${providerRevision}`,
        externalOrderReference: orderId,
        ticketKind: "after_sales",
        providerContext: { ...providerContext, providerRevision },
        replyContext: {},
      };
    }

    const receiptId = text(row.receiptId);
    const receiptType = text(row.receiptType).toUpperCase();
    const expectedType = kind === "cancel_request" ? "CANCEL" : "RETURN";
    const receiptStatus = text(row.receiptStatus).toUpperCase();
    if (!/^[1-9]\d{0,19}$/u.test(receiptId) || receiptType !== expectedType || !receiptStatus) {
      throw new Error("INQUIRY_RECORD_INVALID:coupangReturn");
    }
    const cancelReason = originalMessageBody(row.cancelReason);
    const reasonCodeText = originalMessageBody(row.reasonCodeText);
    const category1 = originalMessageBody(row.cancelReasonCategory1);
    const category2 = originalMessageBody(row.cancelReasonCategory2);
    const returnItems = optionalCoupangRows(row.returnItems, "RETURN_ITEMS").map((item) => ({
      vendorItemId: text(item.vendorItemId),
      vendorItemName: text(item.vendorItemName),
      sellerProductId: text(item.sellerProductId),
      cancelCount: Number.isSafeInteger(Number(item.cancelCount)) ? Number(item.cancelCount) : null,
      purchaseCount: Number.isSafeInteger(Number(item.purchaseCount)) ? Number(item.purchaseCount) : null,
      shipmentBoxId: text(item.shipmentBoxId),
      releaseStatus: text(item.releaseStatus),
    }));
    const returnDeliveries = optionalCoupangRows(row.returnDeliveryDtos, "RETURN_DELIVERIES")
      .map((delivery) => ({
        deliveryCompanyCode: text(delivery.deliveryCompanyCode),
        deliveryInvoiceNo: text(delivery.deliveryInvoiceNo),
      }))
      .filter((delivery) => delivery.deliveryCompanyCode || delivery.deliveryInvoiceNo);
    const providerContext = {
      kind,
      receiptId,
      receiptType,
      receiptStatus,
      faultType: text(row.faultByType),
      reasonCode: text(row.reasonCode),
      reasonCodeText,
      cancelReasonCategory1: category1,
      cancelReasonCategory2: category2,
      releaseStopStatus: text(row.releaseStopStatus),
      preRefund: row.preRefund === true,
      completeConfirmType: text(row.completeConfirmType),
      returnItems,
      returnDeliveries,
      replySupported: false,
    };
    if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60_000) {
      throw new Error("COUPANG_AFTER_SALES_CONTEXT_LIMIT");
    }
    const providerRevision = createHash("sha256").update(JSON.stringify({
      contract: "coupang-return-cancel-request-v1",
      modifiedAt: row.modifiedAt,
      providerContext,
    })).digest("hex");
    const message = cancelReason || reasonCodeText || category2 || category1
      || `쿠팡 ${expectedType === "RETURN" ? "반품" : "취소"} 요청 · ${receiptStatus}`;
    return {
      externalTicketId: `coupang:${expectedType === "RETURN" ? "return" : "cancel"}:${receiptId}`,
      customerName: text(row.requesterName, "Coupang 구매자"),
      subject: `쿠팡 ${expectedType === "RETURN" ? "반품" : "취소"} 요청 · 주문 ${orderId}`,
      message,
      status: receiptStatus === "RETURNS_COMPLETED" ? "resolved" : "waiting",
      priority: ["RELEASE_STOP_UNCHECKED", "RETURNS_UNCHECKED", "REQUEST_COUPANG_CHECK"].includes(receiptStatus) ? 2 : 3,
      receivedAt: iso(coupangAfterSalesTimestamp(row.modifiedAt), coupangAfterSalesTimestamp(row.createdAt)),
      remoteMessageId: `${expectedType === "RETURN" ? "return" : "cancel"}:${receiptId}:${providerRevision}`,
      externalOrderReference: orderId,
      ticketKind: "after_sales",
      providerContext: { ...providerContext, providerRevision },
      replyContext: {},
    };
  });
}

function normalizeEbay(data: Record<string, unknown>, iso: TimestampNormalizer) {
  if (Array.isArray(data.conversationMessages)) {
    return inquiryRows("ebay", data.conversationMessages).map((row): BaseNormalizedChannelInquiry => {
      const conversationId = text(row.conversationId);
      const conversationType = text(row.conversationType);
      const messageId = text(row.messageId);
      const sender = text(row.senderUsername);
      const recipient = text(row.recipientUsername);
      const role = row.role;
      if (!conversationId || conversationId.length > 240
          || conversationType !== "FROM_MEMBERS" && conversationType !== "FROM_EBAY"
          || !messageId || messageId.length > 240
          || !sender || !recipient
          || role !== "customer" && role !== "seller" && role !== "system") {
        throw new Error("INQUIRY_RECORD_INVALID:ebayConversation");
      }
      if (conversationType === "FROM_MEMBERS" && role === "system"
          || conversationType === "FROM_EBAY" && role !== "system") {
        throw new Error("INQUIRY_RECORD_INVALID:ebayConversationRole");
      }
      const media = Array.isArray(row.media) ? row.media : [];
      if (media.length > 100) throw new Error("EBAY_MESSAGE_MEDIA_LIMIT");
      const message = originalMessageBody(
        row.body,
        media.length ? `eBay 첨부 메시지 · 첨부 ${media.length}개` : undefined,
      );
      if (!message) throw new Error("INQUIRY_RECORD_INVALID:ebayConversationBody");
      const ticketDigest = createHash("sha256").update(`ebay-conversation-v1\u001f${conversationId}`).digest("hex");
      const messageDigest = createHash("sha256").update(`ebay-conversation-message-v1\u001f${conversationId}\u001f${messageId}`).digest("hex");
      const replySupported = conversationType === "FROM_MEMBERS" && role === "customer";
      const providerContext: Record<string, unknown> = {
        kind: "conversation",
        conversationId,
        conversationType,
        conversationStatus: text(row.conversationStatus),
        messageId,
        senderUsername: sender,
        recipientUsername: recipient,
        read: row.read === true,
        replySupported,
        ...(media.length ? { nativeMedia: { media } } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60000) {
        throw new Error("EBAY_MESSAGE_CONTEXT_LIMIT");
      }
      return {
        externalTicketId: `ebay:conversation:${ticketDigest}`,
        customerName: role === "customer" ? sender : role === "seller" ? recipient : "eBay",
        subject: text(row.conversationTitle, row.subject, "eBay 일반 대화"),
        message,
        status: role === "customer" ? "waiting" : "resolved",
        priority: 3,
        receivedAt: iso(row.createdAt),
        remoteMessageId: `conversation:${messageDigest}`,
        senderRole: role,
        providerContext,
        ...(replySupported ? { replyContext: {
          kind: "conversation",
          conversationId,
          conversationType,
          messageId,
          replySupported: true,
        } } : {}),
      };
    });
  }
  if (Array.isArray(data.myMessages)) {
    return inquiryRows("ebay", data.myMessages).flatMap((row): BaseNormalizedChannelInquiry[] => {
      const messageId = text(row.messageId);
      const externalMessageId = text(row.externalMessageId);
      const messageType = text(row.messageType);
      const sender = text(row.sender);
      const itemId = text(row.itemId);
      let marketplaceId: string;
      try {
        marketplaceId = ebayAsqMarketplaceId(row.marketplaceId);
      } catch {
        throw new Error("INQUIRY_RECORD_INVALID:ebay");
      }
      const memberMessage = Boolean(sender) && row.responseEnabled === true;
      const contentOmitted = row.contentOmitted === true;
      if (contentOmitted && memberMessage) throw new Error("EBAY_MEMBER_MESSAGE_BODY_LIMIT");
      const content = originalMessageBody(row.content, contentOmitted
        ? `eBay 시스템 원문 크기 제한 · ${text(row.contentBytes, "크기 미확인")} bytes · 판매자센터에서 확인`
        : undefined);
      const subject = text(row.subject, "eBay 메시지");
      if (!messageId || !subject || !content) throw new Error("INQUIRY_RECORD_INVALID:ebay");
      // GetMemberMessages is authoritative for ASQ and supplies the exact
      // reply lineage. Do not duplicate the same question from My Messages.
      if (messageType === "AskSellerQuestion" && externalMessageId) return [];
      // GetMyMessages ResponseEnabled can point to a seller-center URL. It is
      // not proof that AddMemberMessageRTQ accepts this message lineage.
      const replySupported = false;
      const media = Array.isArray(row.media) ? row.media : [];
      if (media.length > 100) throw new Error("EBAY_MAILBOX_MEDIA_LIMIT");
      const providerContext: Record<string, unknown> = {
        mailboxMessageId: messageId,
        externalMessageId,
        itemId,
        marketplaceId,
        messageType,
        questionType: text(row.questionType),
        mailboxFolderId: row.mailboxFolderId,
        read: row.read,
        replied: row.replied,
        flagged: row.flagged,
        highPriority: row.highPriority,
        responseEnabled: row.responseEnabled,
        replySupported,
        contentOmitted,
        contentBytes: row.contentBytes,
        contentSha256: text(row.contentSha256),
        ...(media.length ? { nativeMedia: { media } } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60000) {
        throw new Error("EBAY_MAILBOX_CONTEXT_LIMIT");
      }
      return [{
        externalTicketId: `ebay:mailbox:${messageId}`,
        customerName: memberMessage ? sender : "eBay 시스템",
        subject,
        message: content,
        status: memberMessage && row.replied !== true ? "waiting" : "resolved",
        priority: row.highPriority === true ? 1 : 3,
        receivedAt: iso(row.receiveDate),
        remoteMessageId: `mailbox:${messageId}`,
        senderRole: memberMessage ? "customer" : "system",
        providerContext,
      }];
    });
  }
  return inquiryRows("ebay", data.memberMessages).map((row): BaseNormalizedChannelInquiry | null => {
    let marketplaceId: string;
    try {
      marketplaceId = ebayAsqMarketplaceId(row.marketplaceId);
    } catch {
      throw new Error("INQUIRY_RECORD_INVALID:ebay");
    }
    const messageId = text(row.messageId);
    const itemId = text(row.itemId);
    const recipientId = text(row.senderId);
    const message = originalMessageBody(row.body);
    if (!messageId || !/^[1-9]\d{0,18}$/.test(itemId) || !recipientId || !message) throw new Error("INQUIRY_RECORD_INVALID:ebay");
    if (row.responses !== undefined && row.responses !== null && !Array.isArray(row.responses)) throw new Error("EBAY_ANSWER_BODY_INVALID");
    const undatedAnswers = Array.isArray(row.responses)
      ? row.responses.map((value) => {
        if (typeof value !== "string" || value.length > 20000) throw new Error("EBAY_ANSWER_BODY_INVALID");
        return { body: value, reason: "provider_timestamp_unavailable" };
      }).filter(({ body }) => Boolean(body.trim()))
      : undefined;
    const providerContext = {
      itemId, parentMessageId: messageId, recipientId, marketplaceId,
      ...(undatedAnswers ? { unsequencedAnswers: undatedAnswers } : {}),
    };
    if ((undatedAnswers?.length ?? 0) > 100 || Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60000) {
      throw new Error("EBAY_ANSWER_CONTEXT_LIMIT");
    }
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
      providerContext,
      replyContext: { itemId, parentMessageId: messageId, recipientId, marketplaceId },
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

function shopeeNativeMedia(row: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(row).filter(([key, value]) =>
    /(?:image|video|media|attachment)/i.test(key) && value !== undefined && value !== null,
  );
  if (!entries.length) return undefined;
  if (entries.length > 20) throw new Error("SHOPEE_COMMENT_MEDIA_LIMIT");
  const media = Object.fromEntries(entries);
  let encoded: string;
  try {
    encoded = JSON.stringify(media);
  } catch {
    throw new Error("SHOPEE_COMMENT_MEDIA_INVALID");
  }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 40000) {
    throw new Error("SHOPEE_COMMENT_MEDIA_LIMIT");
  }
  const copied = JSON.parse(encoded) as unknown;
  if (!copied || typeof copied !== "object" || Array.isArray(copied)) {
    throw new Error("SHOPEE_COMMENT_MEDIA_INVALID");
  }
  return copied as Record<string, unknown>;
}

function observedProviderTimestamp(value: unknown): string | null {
  try {
    return canonicalNormalizationTimestamp(value);
  } catch {
    return null;
  }
}

function shopeeReturnMedia(row: Record<string, unknown>) {
  const images = row.image;
  const videos = row.buyer_videos;
  if (!Array.isArray(images) || images.length > 20
      || images.some((value) => typeof value !== "string" || !value.trim() || value.length > 8000)
      || !Array.isArray(videos) || videos.length > 20
      || videos.some((value) => !value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("SHOPEE_RETURN_MEDIA_INVALID");
  }
  const nativeMedia = { images, buyer_videos: videos };
  if (Buffer.byteLength(JSON.stringify(nativeMedia), "utf8") > 40000) {
    throw new Error("SHOPEE_RETURN_MEDIA_LIMIT");
  }
  return nativeMedia;
}

function normalizeShopeeReturn(
  data: Record<string, unknown>,
  iso: TimestampNormalizer,
  referenceTimeMs: number,
): BaseNormalizedChannelInquiry[] {
  const response = object(data.response);
  const context = object(data.sellerpilotProviderContext);
  const shopId = text(context.shopId);
  const returnSn = text(response.return_sn);
  // The executor retains a successful empty discovery page as `inquiries`
  // so its shop/window completion can be recorded without detail calls.
  // Only that exact terminal list shape represents zero records.
  if (/^[1-9]\d{0,31}$/.test(shopId)
      && !Object.hasOwn(context, "returnSn")
      && !Object.hasOwn(response, "return_sn")
      && Array.isArray(response.return) && response.return.length === 0
      && (response.more === false || response.more === "false")) {
    return [];
  }
  if (!/^[1-9]\d{0,31}$/.test(shopId)
      || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(returnSn)
      || (context.returnSn !== undefined && text(context.returnSn) !== returnSn)) {
    throw new Error("INQUIRY_RECORD_INVALID:shopee");
  }
  const reason = text(response.reason);
  const textReason = originalMessageBody(response.text_reason);
  if (!reason && !textReason) throw new Error("INQUIRY_RECORD_INVALID:shopee");
  const user = object(response.user);
  const orderSn = text(response.order_sn);
  const status = text(response.status).toUpperCase();
  const negotiation = object(response.negotiation);
  const negotiationStatus = text(negotiation.negotiation_status, response.negotiation_status).toUpperCase();
  const terminal = new Set(["ACCEPTED", "CANCELLED", "CLOSED", "COMPLETED", "REFUND_PAID", "REFUNDED"]);
  const dueDate = Number(response.return_seller_due_date ?? response.due_date);
  const urgent = !terminal.has(status) && Number.isSafeInteger(dueDate)
    && dueDate * 1000 >= referenceTimeMs && dueDate * 1000 <= referenceTimeMs + 24 * 60 * 60 * 1000;
  const nativeMedia = shopeeReturnMedia(response);
  const returnDetail = projectShopeeReturnDetail(response, returnSn);
  const detailRevision = shopeeReturnDetailRevision(returnDetail);
  const revision = createHash("sha256").update(JSON.stringify({
    contract: "shopee-return-refund-v1",
    reason,
    textReason,
    status,
    negotiationStatus,
    updateTime: response.update_time,
    dueDate: response.due_date,
    returnSellerDueDate: response.return_seller_due_date,
    nativeMedia,
    detailRevision,
  })).digest("hex");
  const providerContext = {
    kind: "return_refund",
    shopId,
    returnSn,
    status,
    reason,
    negotiationStatus,
    latestSolution: text(negotiation.latest_solution),
    offerDueDate: negotiation.offer_due_date ?? null,
    sellerProofStatus: text(object(response.seller_proof).seller_proof_status),
    sellerEvidenceDeadline: object(response.seller_proof).seller_evidence_deadline ?? null,
    sellerCompensationStatus: text(object(response.seller_compensation).seller_compensation_status),
    dueDate: response.due_date ?? null,
    returnSellerDueDate: response.return_seller_due_date ?? null,
    returnShipDueDate: response.return_ship_due_date ?? null,
    replySupported: false,
    nativeMedia,
    returnDetail,
    detailRevision,
  };
  if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60000) {
    throw new Error("SHOPEE_RETURN_CONTEXT_LIMIT");
  }
  return [{
    externalTicketId: `shopee:return:${shopId}:${returnSn}`,
    customerName: text(user.username, "Shopee 고객"),
    subject: `Shopee 반품·환불 · ${returnSn}`,
    message: textReason || `Shopee 반품·환불 요청 · ${reason}`,
    status: terminal.has(status) ? "resolved" : "waiting",
    priority: urgent ? 1 : 2,
    receivedAt: iso(response.create_time),
    remoteMessageId: `${shopId}:${returnSn}:${revision}`,
    ...(orderSn ? { externalOrderReference: orderSn } : {}),
    ticketKind: "after_sales",
    providerContext,
    replyContext: {},
  }];
}

function normalizeShopee(data: Record<string, unknown>, iso: TimestampNormalizer, referenceTimeMs: number) {
  const response = object(data.response);
  const context = object(data.sellerpilotProviderContext);
  if (context.kind === "return_refund") return normalizeShopeeReturn(data, iso, referenceTimeMs);
  const shopId = text(context.shopId);
  if (!/^[1-9]\d{0,31}$/.test(shopId)) throw new Error("INQUIRY_RECORD_INVALID:shopee");
  return inquiryRows("shopee", response.item_comment_list).flatMap((row): BaseNormalizedChannelInquiry[] => {
    const commentId = text(row.comment_id);
    const itemId = text(row.item_id);
    const originalComment = originalMessageBody(row.comment);
    const buyerUsername = text(row.buyer_username);
    const ratingValue = Number(row.rating_star);
    const ratingStar = Number.isSafeInteger(ratingValue) && ratingValue >= 1 && ratingValue <= 5
      ? ratingValue
      : null;
    if (row.rating_star !== undefined && row.rating_star !== null && ratingStar === null) {
      throw new Error("INQUIRY_RECORD_INVALID:shopee");
    }
    const nativeMedia = shopeeNativeMedia(row);
    const message = originalComment || (ratingStar !== null || nativeMedia
      ? `본문 없는 Shopee 후기${ratingStar !== null ? ` · ${ratingStar}점` : ""}${nativeMedia ? " · 첨부 미디어 있음" : ""}`
      : "");
    if (!/^[1-9]\d{0,18}$/.test(commentId)
        || !/^[1-9]\d{0,18}$/.test(itemId)
        || !buyerUsername
        || !message) {
      throw new Error("INQUIRY_RECORD_INVALID:shopee");
    }
    const rawReply = row.comment_reply ?? row.cmt_reply;
    if (rawReply !== undefined && rawReply !== null
        && (!rawReply || typeof rawReply !== "object" || Array.isArray(rawReply))) {
      throw new Error("SHOPEE_COMMENT_REPLY_INVALID");
    }
    const commentReply = object(rawReply);
    const replyBody = rawReply === undefined || rawReply === null
      ? ""
      : originalMessageBody(commentReply.reply);
    const replyReceivedAt = replyBody ? observedProviderTimestamp(commentReply.create_time) : null;
    const commentRevision = createHash("sha256").update(JSON.stringify({
      contract: "shopee-comment-v1",
      comment: originalComment,
      ratingStar,
      hidden: row.hidden === true,
      nativeMedia: nativeMedia ?? null,
    })).digest("hex");
    const providerContext = {
      shopId,
      commentId,
      itemId,
      commentRevision,
      orderSn: text(row.order_sn),
      ratingStar,
      editable: text(row.editable),
      hidden: row.hidden === true,
      ...(nativeMedia ? { nativeMedia } : {}),
      ...(replyBody && !replyReceivedAt ? {
        unsequencedAnswers: [{
          body: replyBody,
          reason: "provider_timestamp_unavailable",
        }],
      } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(providerContext), "utf8") > 60000) {
      throw new Error("SHOPEE_COMMENT_CONTEXT_LIMIT");
    }
    const buyer: BaseNormalizedChannelInquiry = {
      externalTicketId: `shopee:${shopId}:${commentId}`,
      customerName: buyerUsername,
      subject: `Shopee 상품 후기 · ${itemId}`,
      message,
      status: replyBody ? "resolved" : "waiting",
      priority: ratingStar !== null && ratingStar <= 2 ? 2 : 3,
      receivedAt: iso(row.create_time),
      remoteMessageId: `${shopId}:${commentId}:${commentRevision}`,
      ...(text(row.order_sn) ? { externalOrderReference: text(row.order_sn) } : {}),
      providerContext,
      replyContext: { shopId, commentId, itemId },
    };
    if (!replyBody || !replyReceivedAt) return [buyer];
    const replyRevision = createHash("sha256").update(JSON.stringify({
      contract: "shopee-comment-reply-v1",
      body: replyBody,
      receivedAt: replyReceivedAt,
    })).digest("hex");
    return [buyer, {
      externalTicketId: buyer.externalTicketId,
      customerName: buyer.customerName,
      subject: buyer.subject,
      message: replyBody,
      status: "resolved",
      priority: buyer.priority,
      receivedAt: replyReceivedAt,
      remoteMessageId: `${shopId}:${commentId}:reply:${replyRevision}`,
      senderRole: "seller",
      ...(buyer.externalOrderReference ? { externalOrderReference: buyer.externalOrderReference } : {}),
      providerContext: {
        shopId,
        commentId,
        itemId,
        historyOnly: true,
        answerRevision: replyRevision,
        answerScope: "observed_reply",
      },
      replyContext: { shopId, commentId, itemId },
    }];
  });
}

export function normalizeChannelInquiries(
  channel: ActiveChannelKey,
  result: ChannelOperationResult,
  normalizationTimestamp: string,
  options: {
    lazadaRawStorageReady?: boolean;
    qoo10Identity?: Qoo10NormalizationIdentity;
  } = {},
): NormalizedChannelInquiry[] {
  const referenceTimestamp = canonicalNormalizationTimestamp(normalizationTimestamp);
  const referenceTimeMs = new Date(referenceTimestamp).getTime();
  const iso = createTimestampNormalizer(referenceTimestamp);
  if (channel === "lazada") {
    const normalized = normalizeLazadaImHistory(result.steps, referenceTimestamp, {
      rawStorageReady: options.lazadaRawStorageReady,
    })
      .map((inquiry) => finalizeInquiry(channel, inquiry));
    return [...new Map(normalized.map((inquiry) => [inquiry.orderingStatus === "conflict"
      ? `${inquiry.inboundKey}:${inquiry.senderRole}:${createHash("sha256").update(JSON.stringify({
        message: inquiry.message,
        providerContext: inquiry.providerContext,
      })).digest("hex")}`
      : inquiry.inboundKey, inquiry])).values()];
  }
  if (!result.ok || result.channel !== channel || result.operation !== "inquiries.list" || result.steps.some((item) => !item.ok)) {
    throw new Error(`INQUIRY_RESULT_INVALID:${channel}`);
  }
  const inquirySteps = result.steps.filter((item) => /^inquiries(?::\d+)?$/.test(item.name)
    || (channel === "qoo10" && ["GetInquiryMessage", "GetClaimInfo_V3"].includes(item.name)));
  if (!inquirySteps.length) throw new Error(`INQUIRY_PAGE_REQUIRED:${channel}`);
  const pageData = inquirySteps.map((item) => item.data);
  const normalized = pageData.flatMap((data) => channel === "coupang"
    ? ["return_request", "cancel_request", "exchange_request"].includes(text(data.sellerpilotInquiryKind))
      ? normalizeCoupangAfterSales(data, iso)
      : normalizeCoupangInquiries(data, iso)
    : channel === "smartstore" ? normalizeSmartstoreInquiries(data, iso)
      : channel === "qoo10" ? text(data.sellerpilotInquiryKind) === "claim"
        ? normalizeQoo10Claims(data, options.qoo10Identity)
        : normalizeQoo10(data, iso, options.qoo10Identity)
        : channel === "elevenst" ? normalizeElevenst(data)
        : channel === "temu" ? normalizeTemu(data, iso, referenceTimeMs)
          : channel === "ebay" ? normalizeEbay(data, iso)
            : channel === "shopee" ? normalizeShopee(data, iso, referenceTimeMs)
            : [])
    .map((inquiry) => finalizeInquiry(channel, inquiry));
  // A ticket can carry several immutable messages (or after-sales revisions).
  // Collapse only repeated observations of the same message, not its entire
  // conversation. The persistence ledger owns latest-message ordering.
  const messages = new Map<string, NormalizedChannelInquiry>();
  for (const inquiry of normalized) {
    const previous = messages.get(inquiry.inboundKey);
    if (previous && (previous.message !== inquiry.message || previous.senderRole !== inquiry.senderRole)) {
      throw new Error(`INQUIRY_MESSAGE_CONFLICT:${channel}`);
    }
    messages.set(inquiry.inboundKey, inquiry);
  }
  return [...messages.values()];
}

export { inquiryHistorySyncRequests, inquirySyncArguments, inquirySyncRequests } from "./sync-arguments.ts";
