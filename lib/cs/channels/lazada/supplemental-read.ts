import { createHash } from "node:crypto";
import {
  lazadaSupplementalSourcePathSchema,
  type LazadaSupplementalSourcePath,
  type LazadaSupplementalStoredEvent,
  type LazadaSupplementalSurface,
} from "./supplemental-contract";

type UnknownRecord = Record<string, unknown>;

export const lazadaSupplementalMaximumPageSize = 50;
export const lazadaSupplementalMaximumRowsPerBatch = 100;

const allowedCountries = new Set(["SG", "MY", "TH", "VN", "ID", "PH"]);
const sourceSurface: Record<LazadaSupplementalSourcePath, LazadaSupplementalSurface> = {
  "/review/seller/list": "product_review",
  "/reverse/getreverseordersforseller": "reverse_order_after_sales",
  "/order/reverse/return/detail/list": "reverse_order_after_sales",
  "/order/reverse/return/history/list": "reverse_order_after_sales",
};

function record(value: unknown, code: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as UnknownRecord;
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function text(value: unknown, code: string, maximum = 240) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximum || hasControlCharacter(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximum || hasControlCharacter(normalized)) return null;
  return normalized;
}

function optionalContent(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 5_000
      || hasControlCharacter(value.replace(/[\r\n\t]/gu, ""))) {
    throw new Error("LAZADA_SUPPLEMENTAL_CONTENT_INVALID");
  }
  return value.trim() || null;
}

function first(source: UnknownRecord, names: string[]) {
  for (const name of names) if (source[name] !== undefined && source[name] !== null) return source[name];
  return undefined;
}

function instant(value: unknown, code: string) {
  const numeric = typeof value === "string" && /^\d{10,13}$/u.test(value) ? Number(value) : value;
  if (typeof numeric !== "string" && typeof numeric !== "number") throw new Error(code);
  const raw = typeof numeric === "number" && Number.isFinite(numeric)
    ? numeric < 10_000_000_000 ? numeric * 1_000 : numeric
    : numeric;
  const date = new Date(raw as string | number);
  if (!Number.isFinite(date.getTime())) throw new Error(code);
  return date.toISOString();
}

function digest(parts: Array<string | null>) {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("\u001f")).digest("hex");
}

function pageRows(payload: unknown, input: LazadaSupplementalNormalizationInput) {
  const root = record(payload, "LAZADA_SUPPLEMENTAL_RESPONSE_INVALID");
  const data = recordOrUndefined(root.data);
  const result = recordOrUndefined(root.result);
  for (const envelope of [root, result].filter((value) => value !== undefined)) {
    if (envelope.error_response !== undefined
        || (envelope.success !== undefined && ![true, "true"].includes(envelope.success as boolean | string))
        || (envelope.code !== undefined && ![0, "0", "Success", "SUCCESS"].includes(envelope.code as string | number))) {
      throw new Error("LAZADA_SUPPLEMENTAL_PROVIDER_FAILURE");
    }
  }
  if (input.sourcePath === "/review/seller/list" && data?.data !== undefined) {
    const groups = checkedRows(data.data);
    verifyEmpty(groups, data.total);
    return boundedFlatten(groups, (group) => {
      const itemId = text(group.item_id, "LAZADA_REVIEW_ITEM_ID_INVALID");
      bindResource(input.resourceId, itemId);
      const orderId = text(group.order_id, "LAZADA_REVIEW_ORDER_ID_INVALID");
      const rating = record(group.ratings, "LAZADA_REVIEW_RATING_INVALID").product_rating;
      const reviews = checkedRows(group.reviews);
      if (!reviews.length) throw new Error("LAZADA_SUPPLEMENTAL_EMPTY_RESULT_UNVERIFIED");
      return reviews.map((review) => ({ ...review, item_id: itemId, order_id: orderId, rating }));
    });
  }
  if (input.sourcePath === "/reverse/getreverseordersforseller" && result?.items !== undefined) {
    const groups = checkedRows(result.items);
    verifyEmpty(groups, result.total);
    return boundedFlatten(groups, (group) => reverseLines(group, "reverse_order_lines", input));
  }
  if (input.sourcePath === "/order/reverse/return/detail/list" && data?.reverseOrderLineDTOList !== undefined) {
    return reverseLines(data, "reverseOrderLineDTOList", input);
  }
  if (input.sourcePath === "/order/reverse/return/history/list" && data?.list !== undefined) {
    const lineId = text(input.resourceId, "LAZADA_SUPPLEMENTAL_RESOURCE_ID_REQUIRED");
    const rows = checkedRows(data.list);
    verifyEmpty(rows, recordOrUndefined(data.page_info)?.total);
    return rows.map((row) => {
      // This endpoint supplies time/operator/picture, not a return/refund status.
      const time = instant(row.time, "LAZADA_REVERSE_ORDER_TIME_INVALID");
      const operator = optionalText(row.operator, 240);
      if (!Array.isArray(row.picture) || row.picture.some((value) => typeof value !== "string")) {
        throw new Error("LAZADA_SUPPLEMENTAL_RESPONSE_SHAPE_UNVERIFIED");
      }
      const fingerprint = digest([time, operator, JSON.stringify(row.picture)]);
      return { reverse_order_line_id: lineId, reverse_status: "history_observed",
        status_update_time: time, history_id: fingerprint, history_observation: true };
    });
  }
  const surface = sourceSurface[input.sourcePath];
  const candidates = surface === "product_review"
    ? [root.data, recordOrUndefined(root.result)?.data, recordOrUndefined(root.data)?.items,
      recordOrUndefined(recordOrUndefined(root.result)?.data)?.items]
    : [root.data, recordOrUndefined(root.result)?.data, recordOrUndefined(root.data)?.reverse_orders,
      recordOrUndefined(root.data)?.reverseOrders, recordOrUndefined(root.data)?.items,
      recordOrUndefined(recordOrUndefined(root.result)?.data)?.reverse_orders,
      recordOrUndefined(recordOrUndefined(root.result)?.data)?.reverseOrders,
      recordOrUndefined(recordOrUndefined(root.result)?.data)?.items];
  const rows = candidates.find(Array.isArray);
  const checked = checkedRows(rows);
  const explicitCount = first(root, ["total", "total_count", "count"])
    ?? first(recordOrUndefined(root.data) ?? {}, ["total", "total_count", "count"])
    ?? first(recordOrUndefined(recordOrUndefined(root.result)?.data) ?? {}, ["total", "total_count", "count"]);
  verifyEmpty(checked, explicitCount);
  return checked;
}

function checkedRows(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value) || value.length > lazadaSupplementalMaximumRowsPerBatch) {
    throw new Error("LAZADA_SUPPLEMENTAL_RESPONSE_SHAPE_UNVERIFIED");
  }
  return value.map((row) => record(row, "LAZADA_SUPPLEMENTAL_RESPONSE_SHAPE_UNVERIFIED"));
}

function verifyEmpty(rows: UnknownRecord[], total: unknown) {
  if (rows.length === 0 && ((typeof total !== "string" && typeof total !== "number") || total === ""
      || !Number.isSafeInteger(Number(total)) || Number(total) !== 0)) {
    throw new Error("LAZADA_SUPPLEMENTAL_EMPTY_RESULT_UNVERIFIED");
  }
}

function bindResource(expected: string | undefined, actual: string) {
  if (expected !== undefined && text(expected, "LAZADA_SUPPLEMENTAL_RESOURCE_ID_INVALID") !== actual) {
    throw new Error("LAZADA_SUPPLEMENTAL_RESOURCE_MISMATCH");
  }
}

function boundedFlatten(groups: UnknownRecord[], expand: (group: UnknownRecord) => UnknownRecord[]) {
  const rows: UnknownRecord[] = [];
  for (const group of groups) {
    rows.push(...expand(group));
    if (rows.length > lazadaSupplementalMaximumRowsPerBatch) {
      throw new Error("LAZADA_SUPPLEMENTAL_RESPONSE_SHAPE_UNVERIFIED");
    }
  }
  return rows;
}

function reverseLines(group: UnknownRecord, field: string, input: LazadaSupplementalNormalizationInput) {
  const reverseId = text(group.reverse_order_id, "LAZADA_REVERSE_ORDER_ID_INVALID");
  bindResource(input.resourceId, reverseId);
  const orderId = text(group.trade_order_id, "LAZADA_REVERSE_ORDER_TRADE_ID_INVALID");
  const rows = checkedRows(group[field]);
  if (!rows.length) throw new Error("LAZADA_SUPPLEMENTAL_EMPTY_RESULT_UNVERIFIED");
  return rows.map((row) => ({ ...row, reverse_order_id: reverseId, trade_order_id: orderId,
    status_update_time: row.return_order_line_gmt_modified ?? row.return_order_line_gmt_create }));
}

function recordOrUndefined(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function reviewEvent(
  row: UnknownRecord,
  input: LazadaSupplementalNormalizationInput,
): LazadaSupplementalStoredEvent {
  const resourceKey = text(first(row, ["review_id", "reviewId", "id"]), "LAZADA_REVIEW_ID_INVALID");
  const externalItemId = text(first(row, ["item_id", "itemId"]), "LAZADA_REVIEW_ITEM_ID_INVALID");
  const rating = Number(first(row, ["rating", "rate", "score"]));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("LAZADA_REVIEW_RATING_INVALID");
  const status = optionalText(first(row, ["status", "review_status", "reviewStatus"]), 120) ?? "published";
  const body = optionalContent(first(row, ["review_content", "reviewContent", "content", "text"]));
  const occurredAt = instant(first(row, ["review_time", "reviewTime", "created_at", "createdAt", "create_time"]),
    "LAZADA_REVIEW_TIME_INVALID");
  const replyId = optionalText(first(row, ["seller_reply_id", "sellerReplyId"]), 240);
  const reply = optionalContent(row.seller_reply);
  const reviewType = optionalText(row.review_type, 120);
  const externalOrderId = optionalText(row.order_id, 240);
  const identity = ["product_review", resourceKey, externalItemId, String(rating), occurredAt, status, body, replyId];
  if (reply || reviewType || externalOrderId) identity.push(reply, reviewType, externalOrderId);
  return {
    credentialId: input.credentialId,
    country: input.country,
    surface: "product_review",
    sourcePath: input.sourcePath,
    resourceKey,
    eventKey: digest(identity),
    status,
    title: `상품 리뷰 · 평점 ${rating}`,
    body,
    externalOrderId,
    externalItemId,
    rating,
    occurredAt,
    observedAt: input.observedAt,
    providerContext: {
      reviewId: resourceKey,
      itemId: externalItemId,
      ...(replyId ? { sellerReplyId: replyId } : {}),
      ...(reply ? { sellerReply: reply } : {}),
      ...(reviewType ? { reviewType } : {}),
    },
  };
}

function reverseOrderEvent(
  row: UnknownRecord,
  input: LazadaSupplementalNormalizationInput,
): LazadaSupplementalStoredEvent {
  const resourceKey = text(first(row, ["reverse_order_id", "reverseOrderId", "reverse_order_line_id", "reverseOrderLineId"]),
    "LAZADA_REVERSE_ORDER_ID_INVALID");
  const status = text(first(row, ["reverse_status", "reverseStatus", "status", "ofc_status"]),
    "LAZADA_REVERSE_ORDER_STATUS_INVALID", 120);
  const externalOrderId = optionalText(first(row, ["trade_order_id", "tradeOrderId", "order_id", "orderId"]), 240);
  const externalItemId = optionalText(first(row, ["trade_order_line_id", "tradeOrderLineId", "order_item_id", "orderItemId"]), 240);
  const body = optionalContent(first(row, ["reason", "reason_text", "message", "description", "comment"]));
  const occurredAt = instant(first(row, ["status_update_time", "statusUpdateTime", "updated_at", "updatedAt", "create_time"]),
    "LAZADA_REVERSE_ORDER_TIME_INVALID");
  const historyId = optionalText(first(row, ["history_id", "historyId", "id"]), 240);
  const reverseLineId = optionalText(first(row, ["reverse_order_line_id", "reverseOrderLineId"]), 240);
  return {
    credentialId: input.credentialId,
    country: input.country,
    surface: "reverse_order_after_sales",
    sourcePath: input.sourcePath,
    resourceKey,
    eventKey: digest([
      "reverse_order_after_sales", resourceKey, reverseLineId, externalItemId,
      input.sourcePath, historyId, occurredAt, status, body,
    ]),
    status,
    title: row.history_observation ? "사후지원 이력 · 상태 미제공" : `사후지원 · ${status}`,
    body,
    externalOrderId,
    externalItemId,
    rating: null,
    occurredAt,
    observedAt: input.observedAt,
    providerContext: {
      ...(!row.history_observation ? { reverseOrderId: resourceKey } : { observationKind: "history_without_status" }),
      ...(reverseLineId ? { reverseOrderLineId: reverseLineId } : {}),
      ...(historyId ? { historyId } : {}),
    },
  };
}

export type LazadaSupplementalNormalizationInput = {
  credentialId: string;
  country: string;
  sourcePath: LazadaSupplementalSourcePath;
  observedAt: string;
  payload: unknown;
  /** Exact item/order/line ID sent on this request; mandatory for history responses. */
  resourceId?: string;
};

export function normalizeLazadaSupplementalRead(input: LazadaSupplementalNormalizationInput) {
  const sourcePath = lazadaSupplementalSourcePathSchema.parse(input.sourcePath);
  const country = input.country.trim().toUpperCase();
  if (!allowedCountries.has(country)) throw new Error("LAZADA_SUPPLEMENTAL_COUNTRY_INVALID");
  if (!/^[0-9a-f-]{36}$/iu.test(input.credentialId)) throw new Error("LAZADA_SUPPLEMENTAL_CREDENTIAL_INVALID");
  const observedAt = instant(input.observedAt, "LAZADA_SUPPLEMENTAL_OBSERVED_AT_INVALID");
  const normalizedInput = { ...input, sourcePath, country, observedAt };
  const surface = sourceSurface[sourcePath];
  return pageRows(input.payload, normalizedInput).map((row) => surface === "product_review"
    ? reviewEvent(row, normalizedInput)
    : reverseOrderEvent(row, normalizedInput));
}

export function lazadaSupplementalReadPlan(input: {
  sourcePath: LazadaSupplementalSourcePath;
  country: string;
  pageSize?: number;
  resourceId?: string;
  pageNumber?: number;
}) {
  const sourcePath = lazadaSupplementalSourcePathSchema.parse(input.sourcePath);
  const country = input.country.trim().toUpperCase();
  if (!allowedCountries.has(country)) throw new Error("LAZADA_SUPPLEMENTAL_COUNTRY_INVALID");
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > lazadaSupplementalMaximumPageSize) {
    throw new Error("LAZADA_SUPPLEMENTAL_PAGE_SIZE_INVALID");
  }
  const requiresResource = sourcePath !== "/reverse/getreverseordersforseller";
  const resourceId = input.resourceId === undefined ? null
    : text(input.resourceId, "LAZADA_SUPPLEMENTAL_RESOURCE_ID_INVALID");
  if (requiresResource && !resourceId) throw new Error("LAZADA_SUPPLEMENTAL_RESOURCE_ID_REQUIRED");
  const pageNumber = input.pageNumber ?? 1;
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error("LAZADA_SUPPLEMENTAL_PAGE_NUMBER_INVALID");
  const parameters: Record<string, string> = sourcePath === "/review/seller/list"
    ? { item_id: resourceId!, page_size: String(pageSize), current: String(pageNumber) }
    : sourcePath === "/order/reverse/return/detail/list"
      ? { reverse_order_id: resourceId! }
      : sourcePath === "/order/reverse/return/history/list"
        ? { reverse_order_line_id: resourceId!, page_size: String(pageSize), page_number: String(pageNumber) }
        : { page_size: String(pageSize), page_no: String(pageNumber), ...(resourceId ? { reverse_order_id: resourceId } : {}) };
  return {
    contractVersion: "sellerpilot-lazada-supplemental-read-plan/1" as const,
    method: "GET" as const,
    sourcePath,
    surface: sourceSurface[sourcePath],
    country,
    pageSize,
    resourceId,
    pageNumber,
    parameters,
    readOnly: true as const,
    mutationAllowed: false as const,
  };
}
