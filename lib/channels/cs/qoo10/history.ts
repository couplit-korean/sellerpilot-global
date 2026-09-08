import {
  qoo10InquiryStatuses,
  qoo10JapanTimestamp,
  type Qoo10InquiryStatus,
} from "./contracts.ts";

const DAY_MS = 86_400_000;

function calendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("QOO10_HISTORY_DATE_INVALID");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("QOO10_HISTORY_DATE_INVALID");
  }
  return date;
}

function qoo10Day(value: Date) {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

export type Qoo10HistoryInquiryWindow = {
  source: "qapi_inquiry";
  status: Qoo10InquiryStatus;
  calendarDate: string;
  refinement?: "day" | "hour" | "minute" | "second";
  parentWindowKey?: string;
  params: { search_start_dt: string; search_end_dt: string; proc_status: Qoo10InquiryStatus };
};

export type Qoo10HistoryClaimWindow = {
  source: "qapi_claim";
  calendarDate: string;
  refinement?: "day" | "hour" | "minute" | "second";
  parentWindowKey?: string;
  params: { search_Sdate: string; search_Edate: string; search_condition: "2" };
};

export type Qoo10ProviderHistoryWindow = Qoo10HistoryInquiryWindow | Qoo10HistoryClaimWindow;

export type Qoo10ReviewExportWindow = {
  source: "qsm_review_export";
  fromDate: string;
  toDate: string;
  qapiSupported: false;
  requiresAuthenticatedSellerUi: true;
};

export function planQoo10History(fromDate: string, toDate: string) {
  const first = calendarDay(fromDate);
  const last = calendarDay(toDate);
  if (last < first) throw new Error("QOO10_HISTORY_DATE_RANGE_INVALID");
  const dayCount = Math.floor((last.getTime() - first.getTime()) / DAY_MS) + 1;
  if (dayCount > 7_305) throw new Error("QOO10_HISTORY_DATE_RANGE_TOO_LARGE");

  const inquiries: Qoo10HistoryInquiryWindow[] = [];
  const claims: Qoo10HistoryClaimWindow[] = [];
  for (let day = new Date(first); day <= last; day = new Date(day.getTime() + DAY_MS)) {
    const isoDate = day.toISOString().slice(0, 10);
    const compact = qoo10Day(day);
    for (const status of qoo10InquiryStatuses) {
      inquiries.push({
        source: "qapi_inquiry",
        status,
        calendarDate: isoDate,
        refinement: "day",
        params: {
          search_start_dt: `${compact}000000`,
          search_end_dt: `${compact}235959`,
          proc_status: status,
        },
      });
    }
    claims.push({
      source: "qapi_claim",
      calendarDate: isoDate,
      refinement: "day",
      params: {
        search_Sdate: `${compact}000000`,
        search_Edate: `${compact}235959`,
        search_condition: "2",
      },
    });
  }

  const reviews: Qoo10ReviewExportWindow[] = [];
  for (let start = new Date(first); start <= last;) {
    const end = new Date(Math.min(start.getTime() + 29 * DAY_MS, last.getTime()));
    reviews.push({
      source: "qsm_review_export",
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
      qapiSupported: false,
      requiresAuthenticatedSellerUi: true,
    });
    start = new Date(end.getTime() + DAY_MS);
  }
  return { timezone: "Asia/Tokyo" as const, dayCount, inquiries, claims, reviews };
}

function qoo10Timestamp(value: number) {
  return new Date(value + 9 * 60 * 60 * 1_000).toISOString().replace(/[-:T]/gu, "").slice(0, 14);
}

function windowBounds(window: Qoo10ProviderHistoryWindow) {
  return window.source === "qapi_inquiry"
    ? { from: window.params.search_start_dt, to: window.params.search_end_dt }
    : { from: window.params.search_Sdate, to: window.params.search_Edate };
}

export function qoo10HistoryWindowKey(window: Qoo10ProviderHistoryWindow) {
  const { from, to } = windowBounds(window);
  return window.source === "qapi_inquiry"
    ? `inquiries:history:qoo10:inquiry:${window.status}:${from}:${to}`
    : `inquiries:history:qoo10:claim:all:${from}:${to}`;
}

export function splitSaturatedQoo10Window(window: Qoo10ProviderHistoryWindow): Qoo10ProviderHistoryWindow[] {
  const { from, to } = windowBounds(window);
  const start = qoo10JapanTimestamp(from, "QOO10_HISTORY_WINDOW_INVALID");
  const end = qoo10JapanTimestamp(to, "QOO10_HISTORY_WINDOW_INVALID");
  const seconds = Math.floor((end - start) / 1_000) + 1;
  const refinement = seconds === 86_400 ? "hour"
    : seconds === 3_600 ? "minute"
      : seconds === 60 ? "second"
        : seconds === 1 ? null
          : undefined;
  if (refinement === undefined) throw new Error("QOO10_HISTORY_WINDOW_INVALID");
  if (refinement === null) return [];
  const childCount = refinement === "hour" ? 24 : 60;
  const childSeconds = seconds / childCount;
  const parentWindowKey = qoo10HistoryWindowKey(window);
  return Array.from({ length: childCount }, (_, index) => {
    const childStart = start + index * childSeconds * 1_000;
    const childEnd = childStart + (childSeconds - 1) * 1_000;
    const bounds = { from: qoo10Timestamp(childStart), to: qoo10Timestamp(childEnd) };
    if (window.source === "qapi_inquiry") {
      return {
        source: "qapi_inquiry",
        status: window.status,
        calendarDate: window.calendarDate,
        refinement,
        parentWindowKey,
        params: {
          search_start_dt: bounds.from,
          search_end_dt: bounds.to,
          proc_status: window.status,
        },
      };
    }
    return {
      source: "qapi_claim",
      calendarDate: window.calendarDate,
      refinement,
      parentWindowKey,
      params: {
        search_Sdate: bounds.from,
        search_Edate: bounds.to,
        search_condition: "2",
      },
    };
  });
}

export function splitSaturatedQoo10Day(input: {
  calendarDate: string;
  status: Qoo10InquiryStatus;
}) {
  const day = qoo10Day(calendarDay(input.calendarDate));
  return splitSaturatedQoo10Window({
    source: "qapi_inquiry",
    status: input.status,
    calendarDate: input.calendarDate,
    refinement: "day",
    params: {
      search_start_dt: `${day}000000`,
      search_end_dt: `${day}235959`,
      proc_status: input.status,
    },
  }) as Qoo10HistoryInquiryWindow[];
}
