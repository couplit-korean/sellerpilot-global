import { createHash } from "node:crypto";
import type { BaseNormalizedChannelInquiry } from "./inquiry-sync";
import { originalMessageBody, providerMessageTimestamp } from "./cs-history-values";
import { createTimestampNormalizer } from "./normalization-time";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

export function normalizeSmartstoreInquiries(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const sourceKind = text(data.sellerpilotInquiryKind, "product");
  const nested = object(data.data);
  const root = Object.keys(nested).length ? nested : data;
  const rows = list(root.contents).length ? list(root.contents)
    : list(root.content).length ? list(root.content)
      : list(data.data).length ? list(data.data)
        : list(data.contents);
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
    if (!externalTicketId || !message) return [];
    const inquiry: BaseNormalizedChannelInquiry = {
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
    // Product Q&A exposes every answer (registration order); customer Q&A
    // exposes only its most recent answer. Do not label that API complete history.
    const answers = sourceKind === "customer"
      ? [{ answer: row.answerContent, createDate: row.answerRegistrationDateTime, answerId: row.answerContentId }]
      : list(row.answers).length ? list(row.answers) : [{ answer: row.answer }];
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
