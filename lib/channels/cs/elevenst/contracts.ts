import { createHash } from "node:crypto";

export const ELEVENST_QNA_STATUSES = Object.freeze({
  "00": "all",
  "01": "answered",
  "02": "unanswered",
} as const);

export const ELEVENST_ALIMI_STATUSES = Object.freeze({
  "01": "unread",
  "02": "reply_waiting",
  "03": "replied",
  "04": "reply_requested_again",
  "05": "replied_again",
  "06": "completed",
} as const);

export const elevenstCsCapabilities = Object.freeze({
  product_qna: {
    access: "official_open_api",
    read: "GET /rest/prodqnaservices/prodqnalist/{start}/{end}/{answerStatus}",
    write: "PUT /rest/prodqnaservices/prodqnaanswer/{brdInfoNo}/{prdNo}",
    maxWindowDays: 7,
    emptyEvidence: "productQnas_without_productQna",
    replyObservation: "requery_exact_brdInfoNo_prdNo_answer_body",
  },
  urgent_alimi: {
    access: "official_open_api",
    read: "GET /rest/alimi/getalimilist/{start}/{end}/{status?}/{orderNo?}",
    write: "PUT /rest/alimi/alimianswer",
    maxWindowDays: 30,
    emptyResultCode: "0",
    classification: { urgent_inquiry: "10", urgent_notice: "11" },
    replyObservation: "requery_exact_emerNtceSeq_reply_body",
  },
  seller_talk: {
    access: "seller_office_session_only",
    read: null,
    write: null,
    retention: { maximum: 3, unit: "month", exactDays: null },
    import: "reviewed_browser_capture",
  },
  review: {
    access: "seller_office_export_only",
    read: null,
    write: null,
    retention: null,
    import: "seller_office_xls",
  },
} as const);

const DAY_MS = 86_400_000;

function calendarDate(value: string, key: string) {
  if (!/^\d{8}$/u.test(value)) throw new Error(`ELEVENST_DATE_INVALID:${key}`);
  const timestamp = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
  );
  const roundTrip = new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "");
  if (roundTrip !== value) throw new Error(`ELEVENST_DATE_INVALID:${key}`);
  return timestamp;
}

function yyyymmdd(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "");
}

export function planElevenstWindows(input: {
  startDate: string;
  endDate: string;
  maxWindowDays: 7 | 30;
}) {
  const start = calendarDate(input.startDate, "startDate");
  const end = calendarDate(input.endDate, "endDate");
  if (end < start) throw new Error("ELEVENST_RANGE_INVALID");
  const windows: Array<{ startDate: string; endDate: string }> = [];
  for (let cursor = start; cursor <= end;) {
    const windowEnd = Math.min(end, cursor + (input.maxWindowDays - 1) * DAY_MS);
    windows.push({ startDate: yyyymmdd(cursor), endDate: yyyymmdd(windowEnd) });
    cursor = windowEnd + DAY_MS;
  }
  return windows;
}

export function classifyElevenstQnaResponse(input: {
  httpStatus: number | null;
  accepted: boolean;
  resultCode: string | null;
  providerRows: number;
}) {
  if (input.httpStatus === 200 && input.resultCode === "500") return "business_error";
  if (input.accepted && input.httpStatus === 200) {
    return input.providerRows === 0 ? "accepted_empty" : "accepted_rows";
  }
  if (input.httpStatus === 401 || input.httpStatus === 403) return "authorization_error";
  if (input.httpStatus !== null && input.httpStatus >= 500) return "provider_unavailable";
  return "unverified_failure";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function identifier(value: unknown, key: string) {
  const result = text(value);
  if (!/^[1-9]\d{0,19}$/u.test(result)) throw new Error(`ELEVENST_IDENTIFIER_INVALID:${key}`);
  return result;
}

export type ElevenstAlimiKind = "urgent_inquiry" | "urgent_notice";

export type ElevenstAlimiRecord = {
  kind: ElevenstAlimiKind;
  emerNtceSeq: string;
  emerCtntSeq: string;
  type: "reply_request" | "notice";
  status: keyof typeof ELEVENST_ALIMI_STATUSES;
  subject: string;
  body: string;
  createdAt: string;
  replyDueDate: string | null;
  orderNo: string | null;
  orderProductSequence: string | null;
  replySupported: boolean;
  replies: string[];
  sourceDigest: string;
};

export function normalizeElevenstAlimiRow(row: Record<string, unknown>): ElevenstAlimiRecord {
  const emerNtceSeq = identifier(row.emerNtceSeq, "emerNtceSeq");
  const emerCtntSeq = identifier(row.emerCtntSeq, "emerCtntSeq");
  const typeCode = text(row.emerTypeCd);
  const status = text(row.emerNtceCrntCd) as keyof typeof ELEVENST_ALIMI_STATUSES;
  const classification = text(row.emerNtceClfNo1);
  const createDate = text(row.createDt);
  const createTime = text(row.createTm);
  const subject = text(row.emerNtceSubject);
  const body = text(row.emerCtnt);
  if (!["01", "02"].includes(typeCode)
      || !Object.hasOwn(ELEVENST_ALIMI_STATUSES, status)
      || !["10", "11"].includes(classification)
      || !/^\d{8}$/u.test(createDate)
      || !/^\d{2}:\d{2}:\d{2}$/u.test(createTime)
      || !subject || !body) {
    throw new Error("ELEVENST_ALIMI_ROW_INVALID");
  }
  calendarDate(createDate, "createDt");
  const createdAt = `${createDate.slice(0, 4)}-${createDate.slice(4, 6)}-${createDate.slice(6, 8)}T${createTime}+09:00`;
  if (Number.isNaN(Date.parse(createdAt))) throw new Error("ELEVENST_ALIMI_ROW_INVALID");
  const replies = Array.isArray(row.emerReplyList)
    ? row.emerReplyList.map((value) => text((value as Record<string, unknown>)?.emerReplyCtnt)).filter(Boolean)
    : text((row.emerReplyList as Record<string, unknown> | undefined)?.emerReplyCtnt)
      ? [text((row.emerReplyList as Record<string, unknown>).emerReplyCtnt)]
      : [];
  if (replies.some((reply) => reply.length > 2_000)) throw new Error("ELEVENST_ALIMI_REPLY_INVALID");
  const orderNo = text(row.ordNo);
  const orderProductSequence = text(row.ordPrdSeq);
  if ((orderNo && !/^[1-9]\d{0,19}$/u.test(orderNo))
      || (orderProductSequence && !/^[1-9]\d{0,19}$/u.test(orderProductSequence))) {
    throw new Error("ELEVENST_ALIMI_ROW_INVALID");
  }
  const replyDueDate = text(row.emerReplyDt);
  if (replyDueDate) calendarDate(replyDueDate.replaceAll("-", ""), "emerReplyDt");
  const digestMaterial = JSON.stringify({
    emerNtceSeq,
    emerCtntSeq,
    typeCode,
    status,
    classification,
    subject,
    body,
    createdAt,
    replies,
  });
  return {
    kind: classification === "10" ? "urgent_inquiry" : "urgent_notice",
    emerNtceSeq,
    emerCtntSeq,
    type: typeCode === "01" ? "reply_request" : "notice",
    status,
    subject,
    body,
    createdAt,
    replyDueDate: replyDueDate || null,
    orderNo: orderNo || null,
    orderProductSequence: orderProductSequence || null,
    replySupported: typeCode === "01",
    replies,
    sourceDigest: createHash("sha256").update(digestMaterial).digest("hex"),
  };
}

export function verifyElevenstProductQnaReplyReadback(input: {
  expected: { brdInfoNo: string; prdNo: string; reply: string };
  rows: Array<Record<string, unknown>>;
}) {
  const brdInfoNo = identifier(input.expected.brdInfoNo, "brdInfoNo");
  const prdNo = identifier(input.expected.prdNo, "prdNo");
  const reply = text(input.expected.reply);
  if (!reply) throw new Error("ELEVENST_REPLY_BODY_REQUIRED");
  const candidates = input.rows.filter((row) => text(row.brdInfoNo) === brdInfoNo);
  if (candidates.length !== 1) return { observed: false, reason: "board_identity_not_unique" as const };
  const row = candidates[0]!;
  if (text(row.brdInfoClfNo) !== prdNo) return { observed: false, reason: "product_identity_mismatch" as const };
  if (text(row.answerYn).toUpperCase() !== "Y") return { observed: false, reason: "provider_still_unanswered" as const };
  if (text(row.answerCont) !== reply) return { observed: false, reason: "reply_body_mismatch" as const };
  if (!text(row.answerDt)) return { observed: false, reason: "answer_date_missing" as const };
  return { observed: true, reason: "exact_remote_echo" as const };
}

export function verifyElevenstAlimiWriteAcceptance(input: {
  expectedEmerNtceSeq: string;
  intendedAction: "confirm_notice" | "reply_request";
  response: Record<string, unknown>;
}) {
  const expected = identifier(input.expectedEmerNtceSeq, "emerNtceSeq");
  const remote = text(input.response.emerNtceSeq);
  const resultCode = text(input.response.result_code);
  const expectedCode = input.intendedAction === "confirm_notice" ? "100" : "200";
  return {
    accepted: remote === expected && resultCode === expectedCode,
    remoteObservationRequired: true,
  };
}
