import { inquiryRows } from "./inquiry-page.ts";
import { createHash } from "node:crypto";
import type { BaseNormalizedChannelInquiry } from "./inquiry-sync.ts";
import { originalMessageBody, providerMessageTimestamp } from "./cs-history-values.ts";
import { createTimestampNormalizer } from "./normalization-time.ts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => value === undefined || value === null
  ? [] : inquiryRows("smartstore:answers", value);
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

type SmartstoreAnswerEvidence = "answer_content_body" | "answers_body" | "legacy_answer_body" | "answered_flag" | "none";

type SmartstoreAnswerState = {
  answers: Record<string, unknown>[];
  evidence: SmartstoreAnswerEvidence;
  status: "resolved" | "waiting";
};

function smartstoreAnswerState(row: Record<string, unknown>, sourceKind: string): SmartstoreAnswerState {
  const providerAnswered = row.answered === true;
  const legacyBody = originalMessageBody(row.answer);
  let answers: Record<string, unknown>[];
  let evidence: SmartstoreAnswerEvidence = "none";

  if (sourceKind === "customer") {
    answers = [{ answer: row.answerContent, createDate: row.answerRegistrationDateTime, answerId: row.answerContentId }];
    if (originalMessageBody(row.answerContent)) evidence = "answer_content_body";
  } else {
    const returnedAnswers = list(row.answers);
    if (returnedAnswers.some((answer) => Boolean(originalMessageBody(answer.answer)))) {
      answers = returnedAnswers;
      evidence = "answers_body";
    } else if (legacyBody) {
      // Some payloads retain only the legacy scalar answer. Preserve it when
      // the explicit answer list contains no usable seller message.
      answers = [{ answer: row.answer }];
      evidence = "legacy_answer_body";
    } else {
      answers = returnedAnswers;
    }
  }

  if (evidence === "none" && providerAnswered) evidence = "answered_flag";
  return {
    answers,
    evidence,
    status: evidence === "none" ? "waiting" : "resolved",
  };
}

type SmartstoreOrderBinding = {
  state: "unavailable" | "exact_product_order" | "ambiguous_product_orders" | "invalid_product_order_list";
  productOrderIds: string[];
  externalOrderReference?: string;
};

function customerOrderBinding(row: Record<string, unknown>): SmartstoreOrderBinding {
  const rawList = row.productOrderIdList;
  const legacySingle = text(row.productOrderId);
  const hasRawList = Array.isArray(rawList)
    ? rawList.length > 0
    : rawList !== undefined && rawList !== null && text(rawList) !== "";
  if (!hasRawList && !legacySingle) {
    return { state: "unavailable", productOrderIds: [] };
  }
  const tokens = Array.isArray(rawList)
    ? rawList.map((value) => text(value))
    : rawList === undefined || rawList === null || text(rawList) === ""
      ? [legacySingle]
      : text(rawList).split(",").map((value) => value.trim());
  if (!tokens.length || tokens.some((value) => !/^[1-9]\d{0,19}$/u.test(value))) {
    return { state: "invalid_product_order_list", productOrderIds: [] };
  }
  const productOrderIds = [...new Set(tokens)];
  if (legacySingle && (!/^[1-9]\d{0,19}$/u.test(legacySingle)
      || productOrderIds.length !== 1 || productOrderIds[0] !== legacySingle)) {
    return { state: "invalid_product_order_list", productOrderIds };
  }
  if (productOrderIds.length !== 1 || tokens.length !== 1) {
    return { state: "ambiguous_product_orders", productOrderIds };
  }
  return {
    state: "exact_product_order",
    productOrderIds,
    externalOrderReference: productOrderIds[0],
  };
}

export function normalizeSmartstoreInquiries(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const sourceKind = text(data.sellerpilotInquiryKind, "product");
  const nested = object(data.data);
  const root = Object.keys(nested).length ? nested : data;
  const rows = inquiryRows("smartstore", root.contents, root.content, Array.isArray(data.data) ? data.data : undefined);
  return rows.flatMap((row): BaseNormalizedChannelInquiry[] => {
    const remoteTicketId = sourceKind === "customer"
      ? text(row.inquiryNo)
      : text(row.questionId);
    const externalTicketId = sourceKind === "customer" && remoteTicketId
      ? `customer:${remoteTicketId}`
      : remoteTicketId
        ? `smartstore:product-qna:${remoteTicketId}`
        : "";
    const message = sourceKind === "customer"
      ? originalMessageBody(row.inquiryContent)
      : originalMessageBody(row.question);
    if (!externalTicketId || !message) throw new Error("INQUIRY_RECORD_INVALID:smartstore");
    const orderBinding = sourceKind === "customer"
      ? customerOrderBinding(row)
      : { state: "unavailable", productOrderIds: [] } satisfies SmartstoreOrderBinding;
    const parentOrderId = sourceKind === "customer" ? text(row.orderId) : "";
    const answerState = smartstoreAnswerState(row, sourceKind);
    const providerIdentity = {
      identityContract: "smartstore-provider-ticket-v1",
      legacyExternalTicketId: externalTicketId,
      providerTicketKind: sourceKind,
      providerTicketId: remoteTicketId,
    };
    const inquiry: BaseNormalizedChannelInquiry = {
      externalTicketId,
      customerName: sourceKind === "customer"
        ? text(row.customerName, row.customerId, "네이버 고객")
        : text(row.maskedWriterId, "네이버 고객"),
      subject: sourceKind === "customer"
        ? text(row.title, row.category, row.productName, "스마트스토어 고객 문의")
        : text(row.productName, "스마트스토어 상품 문의"),
      message,
      status: answerState.status,
      priority: 3,
      receivedAt: sourceKind === "customer"
        ? iso(row.inquiryRegistrationDateTime)
        : iso(row.createDate),
      remoteMessageId: remoteTicketId,
      ...(orderBinding.externalOrderReference
        ? { externalOrderReference: orderBinding.externalOrderReference }
        : {}),
      providerContext: sourceKind === "customer"
        ? {
            ...providerIdentity,
            kind: "customer",
            inquiryNo: remoteTicketId,
            orderReferenceState: orderBinding.state,
            ...(parentOrderId ? { orderId: parentOrderId } : {}),
            ...(orderBinding.productOrderIds.length ? { productOrderIds: orderBinding.productOrderIds } : {}),
          }
        : { ...providerIdentity, kind: "product", namespace: "product-qna", questionId: remoteTicketId },
      replyContext: sourceKind === "customer"
        ? { kind: "customer", inquiryNo: remoteTicketId }
        : { kind: "product", questionId: remoteTicketId },
    };
    // Product Q&A exposes every answer (registration order); customer Q&A
    // exposes only its most recent answer. Do not label that API complete history.
    const answers = answerState.answers;
    const history: BaseNormalizedChannelInquiry[] = [];
    const undated: Array<{ body: string; reason: string }> = [];
    for (const answer of answers) {
      const body = originalMessageBody(answer.answer);
      if (!body) continue;
      if (body.length > 20000) throw new Error("SMARTSTORE_ANSWER_BODY_LIMIT");
      const occurredAt = providerMessageTimestamp(answer.createDate);
      if (!occurredAt) {
        // Keep a legacy/invalid-time answer with the customer record. Never
        // advance reply ordering with the collection time or question time.
        undated.push({ body, reason: "provider_timestamp_unavailable" });
        continue;
      }
      const nativeId = text(answer.answerId);
      const revision = createHash("sha256").update([sourceKind, nativeId, occurredAt, body].join("\u001f")).digest("hex");
      history.push({
        ...inquiry, message: body, senderRole: "seller", status: "resolved", receivedAt: occurredAt,
        remoteMessageId: `smartstore:answer-observation:${revision}`,
        providerContext: {
          ...inquiry.providerContext,
          ...(nativeId ? { answerContentId: nativeId } : {}),
          identitySource: "answer_observation_digest",
          historyOnly: true,
          answerScope: sourceKind === "customer" ? "latest_answer" : "returned_answer_list",
        },
      });
    }
    inquiry.providerContext = { ...inquiry.providerContext, unsequencedAnswers: undated };
    if (undated.length > 100 || Buffer.byteLength(JSON.stringify(inquiry.providerContext), "utf8") > 60000) {
      throw new Error("SMARTSTORE_ANSWER_CONTEXT_LIMIT");
    }
    return [inquiry, ...history];
  });
}
