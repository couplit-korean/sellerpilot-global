export const qoo10InquiryStatuses = ["S1", "S2", "S3"] as const;
export type Qoo10InquiryStatus = (typeof qoo10InquiryStatuses)[number];
export const qoo10InquiryTypes = ["MSG", "HELP", "ITEM"] as const;
export type Qoo10InquiryType = (typeof qoo10InquiryTypes)[number];

const DATE_RE = /^\d{8}(?:\d{6})?$/u;

function scalarMap(value: unknown, errorCode: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string" && typeof item !== "number")) {
    throw new Error(errorCode);
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item).trim()]));
}

export function qoo10JapanTimestamp(value: string, errorCode: string) {
  if (!DATE_RE.test(value)) throw new Error(errorCode);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = value.length === 14 ? Number(value.slice(8, 10)) : 0;
  const minute = value.length === 14 ? Number(value.slice(10, 12)) : 0;
  const second = value.length === 14 ? Number(value.slice(12, 14)) : 0;
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
  const japan = new Date(utc + 9 * 60 * 60 * 1_000);
  if (japan.getUTCFullYear() !== year || japan.getUTCMonth() + 1 !== month
      || japan.getUTCDate() !== day || japan.getUTCHours() !== hour
      || japan.getUTCMinutes() !== minute || japan.getUTCSeconds() !== second) {
    throw new Error(errorCode);
  }
  return utc;
}

export function qoo10InquiryListParams(
  argumentsValue: Record<string, unknown>,
): { search_start_dt: string; search_end_dt: string; proc_status: Qoo10InquiryStatus } {
  const params = scalarMap(argumentsValue.params, "QOO10_INQUIRY_QUERY_INVALID");
  const allowed = new Set(["search_start_dt", "search_end_dt", "proc_status"]);
  if (Object.keys(params).length !== 3 || Object.keys(params).some((key) => !allowed.has(key))) {
    throw new Error("QOO10_INQUIRY_QUERY_INVALID");
  }
  const status = params.proc_status?.toUpperCase();
  if (!qoo10InquiryStatuses.includes(status as Qoo10InquiryStatus)) {
    throw new Error("QOO10_INQUIRY_QUERY_INVALID");
  }
  const from = qoo10JapanTimestamp(params.search_start_dt ?? "", "QOO10_INQUIRY_TIME_RANGE_INVALID");
  const to = qoo10JapanTimestamp(params.search_end_dt ?? "", "QOO10_INQUIRY_TIME_RANGE_INVALID");
  if (to < from) throw new Error("QOO10_INQUIRY_TIME_RANGE_INVALID");
  return {
    search_start_dt: params.search_start_dt!,
    search_end_dt: params.search_end_dt!,
    proc_status: status as Qoo10InquiryStatus,
  };
}

function hasForbiddenControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x7f || code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code);
  });
}

export function qoo10InquiryReplyParams(argumentsValue: Record<string, unknown>) {
  const params = scalarMap(argumentsValue.params, "QOO10_INQUIRY_REPLY_INVALID");
  const allowed = new Set(["inq_type", "question_no", "seq_no", "contents"]);
  if (Object.keys(params).length !== 4 || Object.keys(params).some((key) => !allowed.has(key))) {
    throw new Error("QOO10_INQUIRY_REPLY_INVALID");
  }
  const inquiryType = params.inq_type?.toUpperCase();
  const questionNo = params.question_no ?? "";
  const sequenceNo = params.seq_no ?? "";
  const contents = params.contents ?? "";
  if (!qoo10InquiryTypes.includes(inquiryType as Qoo10InquiryType)
      || !/^\d{1,40}$/u.test(questionNo)
      || !/^\d{1,40}$/u.test(sequenceNo)
      || !contents.trim()
      || [...contents].length > 4_000
      || hasForbiddenControl(contents)) {
    throw new Error("QOO10_INQUIRY_REPLY_INVALID");
  }
  return { inq_type: inquiryType, question_no: questionNo, seq_no: sequenceNo, contents };
}

export type Qoo10WindowCompleteness = {
  state: "complete" | "incomplete" | "unverified";
  reason: "provider_success_empty" | "provider_total_reconciled" | "provider_error"
    | "observed_row_limit_reached" | "provider_total_invalid" | "provider_total_mismatch"
    | "missing_total_and_row_limit";
};

export function assessQoo10WindowCompleteness(input: {
  providerSucceeded: boolean;
  rowCount: number;
  providerTotal?: unknown;
  observedRowLimit?: number | null;
}): Qoo10WindowCompleteness {
  if (!input.providerSucceeded) return { state: "incomplete", reason: "provider_error" };
  if (!Number.isSafeInteger(input.rowCount) || input.rowCount < 0) {
    throw new Error("QOO10_WINDOW_ROW_COUNT_INVALID");
  }
  const providerTotalPresent = input.providerTotal !== undefined && input.providerTotal !== null;
  if (providerTotalPresent) {
    if (!Number.isSafeInteger(input.providerTotal) || Number(input.providerTotal) < 0) {
      return { state: "incomplete", reason: "provider_total_invalid" };
    }
    return input.rowCount === Number(input.providerTotal)
      ? { state: "complete", reason: "provider_total_reconciled" }
      : { state: "incomplete", reason: "provider_total_mismatch" };
  }
  if (input.rowCount === 0) return { state: "complete", reason: "provider_success_empty" };
  if (Number.isSafeInteger(input.observedRowLimit) && Number(input.observedRowLimit) > 0
      && input.rowCount >= Number(input.observedRowLimit)) {
    return { state: "incomplete", reason: "observed_row_limit_reached" };
  }
  return { state: "unverified", reason: "missing_total_and_row_limit" };
}
