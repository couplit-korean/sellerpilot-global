import "server-only";
import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationResult } from "./operations";
import { normalizeLazadaImHistory } from "./lazada-im";
import { coupangContactCenterParentAnswerId } from "./inquiry-reply";
import { ebayAsqMarketplaceId } from "./ebay-asq";
import { canonicalNormalizationTimestamp, createTimestampNormalizer } from "./normalization-time";
import { inquiryRows } from "./inquiry-page";

type BaseNormalizedChannelInquiry = {
  externalTicketId: string;
  customerName: string;
  subject: string;
  message: string;
  status: "waiting" | "resolved";
  priority: number;
  receivedAt: string;
  remoteMessageId?: string;
  providerContext?: Record<string, unknown>;
  externalOrderReference?: string;
  ticketKind?: "conversation" | "after_sales";
  replyContext?: Record<string, unknown>;
  senderRole?: "customer" | "seller";
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

function originalMessageBody(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function elevenstKoreaTimestamp(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/u);
  if (!match) throw new Error("INQUIRY_RECORD_INVALID:elevenst");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
  return { timestamp: new Date(utc).toISOString(), precise: match[4] !== undefined };
}

function observedProviderTimestamp(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shopeeNativeMedia(row: Record<string, unknown>) {
  const imageInfo = row.image_info;
  const videoInfo = row.video_info;
  const hasImages = Array.isArray(imageInfo) && imageInfo.length > 0;
  const hasVideo = Boolean(videoInfo && typeof videoInfo === "object");
  if (!hasImages && !hasVideo) return null;
  const nativeMedia = {
    ...(hasImages ? { image_info: imageInfo } : {}),
    ...(hasVideo ? { video_info: videoInfo } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(nativeMedia), "utf8") > 40_000) {
    throw new Error("SHOPEE_COMMENT_MEDIA_LIMIT");
  }
  return nativeMedia;
}

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

function normalizeCoupang(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const root = object(data.data);
  const rows = list(root.content).length ? list(root.content) : list(data.data);
  return rows.map((row): BaseNormalizedChannelInquiry | null => {
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
      remoteMessageId: remoteTicketId,
      ...(text(row.orderId, row.orderItemId, row.vendorItemId)
        ? { externalOrderReference: text(row.orderId, row.orderItemId, row.vendorItemId) }
        : {}),
      providerContext: {
        kind: sourceKind,
        inquiryId: remoteTicketId,
        ...(parentAnswerId ? { parentAnswerId } : {}),
      },
      replyContext: parentAnswerId ? { parentAnswerId } : {},
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
}

function normalizeSmartstore(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const sourceKind = text(data.sellerpilotInquiryKind, "product");
  const nested = object(data.data);
  const root = Object.keys(nested).length ? nested : data;
  const rows = list(root.contents).length ? list(root.contents)
    : list(root.content).length ? list(root.content)
      : list(data.data).length ? list(data.data)
        : list(data.contents);
  return rows.map((row): BaseNormalizedChannelInquiry | null => {
    const remoteTicketId = sourceKind === "customer"
      ? text(row.inquiryNo)
      : text(row.questionId);
    const externalTicketId = sourceKind === "customer" && remoteTicketId
      ? `customer:${remoteTicketId}`
      : remoteTicketId
        ? `smartstore:product-qna:${remoteTicketId}`
        : "";
    const message = sourceKind === "customer"
      ? text(row.inquiryContent)
      : text(row.question);
    if (!externalTicketId || !message) return null;
    return {
      externalTicketId,
      customerName: sourceKind === "customer"
        ? text(row.customerName, row.customerId, "네이버 고객")
        : text(row.maskedWriterId, "네이버 고객"),
      subject: sourceKind === "customer"
        ? text(row.title, row.category, row.productName, "스마트스토어 고객 문의")
        : text(row.productName, "스마트스토어 상품 문의"),
      message,
      status: row.answered === true || text(row.answer, row.answerContent) ? "resolved" : "waiting",
      priority: 3,
      receivedAt: sourceKind === "customer"
        ? iso(row.inquiryRegistrationDateTime)
        : iso(row.createDate),
      remoteMessageId: remoteTicketId,
      ...(text(row.orderId, row.productOrderId)
        ? { externalOrderReference: text(row.orderId, row.productOrderId) }
        : {}),
      providerContext: sourceKind === "customer"
        ? { kind: "customer", inquiryNo: remoteTicketId }
        : { kind: "product", namespace: "product-qna", questionId: remoteTicketId },
      replyContext: sourceKind === "customer"
        ? { kind: "customer", inquiryNo: remoteTicketId }
        : { kind: "product", questionId: remoteTicketId },
    };
  }).filter((row): row is BaseNormalizedChannelInquiry => Boolean(row));
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
      remoteMessageId: text(row.MESSAGE_ID, row.MessageId, sequenceNo),
      providerContext: { inquiryType, questionNo, sequenceNo },
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
    const message = text(row.body);
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

function normalizeElevenst(data: Record<string, unknown>) {
  const rows = inquiryRows("elevenst", data.productQnas);
  return rows.flatMap((row): BaseNormalizedChannelInquiry[] => {
    const brdInfoNo = text(row.brdInfoNo);
    const prdNo = text(row.brdInfoClfNo);
    const question = originalMessageBody(row.brdInfoCont);
    const answerYn = text(row.answerYn).toUpperCase();
    const qnaTypeCode = text(row.qnaDtlsCd);
    if (!/^\d{1,20}$/u.test(brdInfoNo) || !/^\d{1,20}$/u.test(prdNo) || !question || !["Y", "N"].includes(answerYn)) {
      throw new Error("INQUIRY_RECORD_INVALID:elevenst");
    }
    const created = elevenstKoreaTimestamp(row.createDt);
    if (!created.precise) throw new Error("INQUIRY_RECORD_INVALID:elevenst");
    const orderNo = text(row.ordNoDe);
    return [{
      externalTicketId: `elevenst:${brdInfoNo}`,
      customerName: text(row.memNM, row.customerName, "11번가 고객"),
      subject: text(row.brdInfoSbjct, row.prdNm, "11번가 상품 Q&A"),
      message: question,
      status: answerYn === "Y" ? "resolved" : "waiting",
      priority: ["02", "03", "04"].includes(qnaTypeCode) ? 2 : 3,
      receivedAt: created.timestamp,
      remoteMessageId: `qna:${brdInfoNo}:question`,
      ...(orderNo ? { externalOrderReference: orderNo } : {}),
      providerContext: { kind: "product_qna", brdInfoNo, prdNo, qnaTypeCode },
      replyContext: { brdInfoNo, prdNo },
    }];
  });
}

function normalizeShopee(data: Record<string, unknown>, iso: TimestampNormalizer, referenceTimeMs: number): BaseNormalizedChannelInquiry[] {
  const response = object(data.response);
  const context = object(data.sellerpilotProviderContext);
  if (context.kind === "return_refund") {
    const shopId = text(context.shopId);
    const returnSn = text(response.return_sn, context.returnSn);
    if (!shopId || !returnSn) throw new Error("INQUIRY_RECORD_INVALID:shopee");
    const status = text(response.status).toUpperCase();
    const terminal = new Set(["ACCEPTED", "CANCELLED", "CLOSED", "COMPLETED", "REFUND_PAID", "REFUNDED"]);
    return [{
      externalTicketId: `shopee:return:${shopId}:${returnSn}`,
      customerName: text(object(response.user).username, "Shopee 고객"),
      subject: `Shopee 반품·환불 · ${returnSn}`,
      message: originalMessageBody(response.text_reason) || `Shopee 반품·환불 요청 · ${text(response.reason)}`,
      status: terminal.has(status) ? "resolved" as const : "waiting" as const,
      priority: 2,
      receivedAt: iso(response.create_time),
      remoteMessageId: `${shopId}:${returnSn}:${createHash("sha256").update(status + String(referenceTimeMs)).digest("hex")}`,
      ticketKind: "after_sales" as const,
      providerContext: { kind: "return_refund", shopId, returnSn, status, replySupported: false },
      replyContext: {},
    }];
  }
  const shopId = text(context.shopId);
  if (!/^\d{1,32}$/.test(shopId)) throw new Error("INQUIRY_RECORD_INVALID:shopee");
  return inquiryRows("shopee", response.item_comment_list).flatMap((row): BaseNormalizedChannelInquiry[] => {
    const commentId = text(row.comment_id);
    const itemId = text(row.item_id);
    const originalComment = originalMessageBody(row.comment);
    const buyerUsername = text(row.buyer_username);
    const ratingValue = Number(row.rating_star);
    const ratingStar = Number.isSafeInteger(ratingValue) && ratingValue >= 1 && ratingValue <= 5 ? ratingValue : null;
    if (row.rating_star !== undefined && row.rating_star !== null && ratingStar === null) {
      throw new Error("INQUIRY_RECORD_INVALID:shopee");
    }
    const nativeMedia = shopeeNativeMedia(row);
    const message = originalComment || (ratingStar !== null || nativeMedia
      ? `본문 없는 Shopee 후기${ratingStar !== null ? ` · ${ratingStar}점` : ""}${nativeMedia ? " · 첨부 미디어 있음" : ""}`
      : "");
    if (!commentId || !itemId || !buyerUsername || !message) throw new Error("INQUIRY_RECORD_INVALID:shopee");
    const commentReply = object(row.comment_reply ?? row.cmt_reply);
    const replyBody = originalMessageBody(commentReply.reply);
    const replyReceivedAt = replyBody ? observedProviderTimestamp(commentReply.create_time) : null;
    const commentRevision = createHash("sha256").update(JSON.stringify({
      contract: "shopee-comment-v1", comment: originalComment, ratingStar, nativeMedia: nativeMedia ?? null,
    })).digest("hex");
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
      providerContext: { shopId, commentId, itemId, commentRevision, ratingStar, ...(nativeMedia ? { nativeMedia } : {}) },
      replyContext: { shopId, commentId, itemId },
    };
    if (!replyBody || !replyReceivedAt) return [buyer];
    const replyRevision = createHash("sha256").update(JSON.stringify({
      contract: "shopee-comment-reply-v1", body: replyBody, receivedAt: replyReceivedAt,
    })).digest("hex");
    return [buyer, {
      ...buyer,
      message: replyBody,
      receivedAt: replyReceivedAt,
      remoteMessageId: `${shopId}:${commentId}:reply:${replyRevision}`,
      senderRole: "seller",
      providerContext: { shopId, commentId, itemId, historyOnly: true, answerRevision: replyRevision },
    }];
  });
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
    return [...new Map(normalized.map((inquiry) => [inquiry.externalTicketId, inquiry])).values()];
  }
  if (!result.ok || result.channel !== channel || result.operation !== "inquiries.list") {
    throw new Error(`INQUIRY_RESULT_INVALID:${channel}`);
  }
  const inquirySteps = result.steps.filter((item) => item.ok && /^inquiries(?::\d+)?$/.test(item.name));
  const pageData = inquirySteps.length
    ? inquirySteps.map((item) => item.data)
    : [result.steps.at(-1)?.data ?? {}];
  const normalized = pageData.flatMap((data) => channel === "coupang" ? normalizeCoupang(data, iso)
    : channel === "smartstore" ? normalizeSmartstore(data, iso)
      : channel === "qoo10" ? normalizeQoo10(data, iso)
        : channel === "elevenst" ? normalizeElevenst(data)
        : channel === "temu" ? normalizeTemu(data, iso, referenceTimeMs)
          : channel === "ebay" ? normalizeEbay(data, iso)
            : channel === "shopee" ? normalizeShopee(data, iso, referenceTimeMs)
            : [])
    .map((inquiry) => finalizeInquiry(channel, inquiry));
  return [...new Map(normalized.map((inquiry) => [inquiry.externalTicketId, inquiry])).values()];
}

export { inquiryHistorySyncRequests, inquirySyncArguments, inquirySyncRequests } from "./sync-arguments";
