import type { ActiveChannelKey } from "./catalog";
import { ebayAsqMarketplaceId, type EbayAsqMarketplaceId } from "./ebay-asq";

function koreaCalendarDate(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function coupangDailyDate(value: Date) {
  // Coupang's v5 daily order query requires the market UTC offset after the
  // calendar date. A bare YYYY-MM-DD is rejected after the 2025 API
  // internationalization change.
  return `${koreaCalendarDate(value)}+09:00`;
}

function coupangTimeFrame(value: Date) {
  return `${new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)}+09:00`;
}

function qoo10DateTime(value: Date) {
  // Qoo10 Japan documents yyyyMMdd or yyyyMMddHHmmss in Japan time.
  return new Date(value.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
}

function qoo10Date(value: Date) {
  return qoo10DateTime(value).slice(0, 8);
}

function elevenstDateTime(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 12);
}

export function orderSyncArguments(channel: ActiveChannelKey, now = new Date()): Record<string, unknown> | null {
  const from = new Date(now.getTime() - 14 * 86_400_000);
  if (channel === "coupang") return { query: { createdAtFrom: coupangDailyDate(from), createdAtTo: coupangDailyDate(now), status: "ACCEPT", maxPerPage: 50 } };
  if (channel === "shopee") return { query: { time_range_field: "create_time", time_from: Math.floor(from.getTime() / 1000), time_to: Math.floor(now.getTime() / 1000), page_size: 50 } };
  if (channel === "lazada") return { queryParams: { created_after: from.toISOString(), limit: "50", sort_direction: "DESC" } };
  if (channel === "smartstore") return { query: { lastChangedFrom: from.toISOString(), limitCount: 300 } };
  if (channel === "ebay") return { query: { limit: 50, filter: `creationdate:[${from.toISOString()}..${now.toISOString()}]` } };
  if (channel === "qoo10") return {
    params: {
      SearchStartDate: qoo10DateTime(from),
      SearchEndDate: qoo10DateTime(now),
      ShippingStatus: "0",
      SearchCondition: "1",
    },
  };
  if (channel === "elevenst") return {
    startTime: elevenstDateTime(new Date(now.getTime() - 7 * 86_400_000)),
    endTime: elevenstDateTime(now),
  };
  if (channel === "temu") return {
    pageNumber: 1,
    pageSize: 100,
    updateAtStart: from.getTime(),
    updateAtEnd: now.getTime(),
    sortby: "updateTime",
  };
  return null;
}

export function orderSyncRequests(channel: ActiveChannelKey, now = new Date()) {
  const base = orderSyncArguments(channel, now);
  if (!base) return [];
  if (channel === "coupang") {
    const query = base.query && typeof base.query === "object" && !Array.isArray(base.query)
      ? base.query as Record<string, unknown>
      : {};
    const orderSheets = ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY"].map((remoteStatus) => ({
      periodicKey: `orders:${remoteStatus}`,
      arguments: { ...base, query: { ...query, status: remoteStatus } },
    }));
    const cancellationFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return [
      ...orderSheets,
      {
        periodicKey: "orders:cancellations",
        arguments: {
          kind: "cancellations",
          query: {
            searchType: "timeFrame",
            createdAtFrom: coupangTimeFrame(cancellationFrom),
            createdAtTo: coupangTimeFrame(now),
            cancelType: "CANCEL",
          },
        },
      },
    ];
  }
  if (channel === "qoo10") {
    const params = base.params && typeof base.params === "object" && !Array.isArray(base.params)
      ? base.params as Record<string, unknown>
      : {};
    // 0 means delivery preparation/requested. The remaining values preserve
    // confirmed, in-transit, and delivered updates for shipping alerts.
    return ["0", "3", "4", "5"].map((remoteStatus) => ({
      periodicKey: `orders:${remoteStatus}`,
      arguments: { ...base, params: { ...params, ShippingStatus: remoteStatus } },
    }));
  }
  if (channel === "elevenst") {
    const recentStart = new Date(now.getTime() - 7 * 86_400_000);
    const olderStart = new Date(now.getTime() - 14 * 86_400_000);
    return [
      {
        periodicKey: "orders:older-window",
        arguments: {
          startTime: elevenstDateTime(olderStart),
          endTime: elevenstDateTime(recentStart),
        },
      },
      {
        periodicKey: "orders:recent-window",
        arguments: base,
      },
    ];
  }
  return [{ periodicKey: "orders", arguments: base }];
}

export function ebayAsqInquirySyncArguments(
  now = new Date(),
  marketplaceId?: EbayAsqMarketplaceId,
) {
  const from = new Date(now.getTime() - 14 * 86_400_000);
  return {
    startCreationTime: from.toISOString(),
    endCreationTime: now.toISOString(),
    pageNumber: 1,
    entriesPerPage: 25,
    ...(marketplaceId ? { marketplaceId: ebayAsqMarketplaceId(marketplaceId) } : {}),
  };
}

export function inquirySyncArguments(
  channel: ActiveChannelKey,
  now = new Date(),
  releaseContext: {
    environment?: "sandbox" | "production";
    marketplaceId?: EbayAsqMarketplaceId;
  } = {},
): Record<string, unknown>[] {
  // Coupang documents a seven-day maximum, but the provider counts both end
  // points in some markets. Six elapsed days avoids an eight-calendar-day
  // window around timezone boundaries.
  const from = new Date(now.getTime() - 6 * 86_400_000);
  const fromDate = koreaCalendarDate(from);
  const toDate = koreaCalendarDate(now);
  if (channel === "coupang") return [
    { kind: "product", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, answeredType: "NOANSWER", pageNum: 1, pageSize: 50 } },
    { kind: "call-center", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, partnerCounselingStatus: "NO_ANSWER", pageNum: 1, pageSize: 30 } },
    { kind: "call-center", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, partnerCounselingStatus: "TRANSFER", pageNum: 1, pageSize: 30 } },
  ];
  if (channel === "smartstore") return [
    {
      kind: "product",
      query: {
        fromDate: from.toISOString(),
        toDate: now.toISOString(),
        answered: false,
        page: 1,
        size: 100,
      },
    },
    {
      kind: "customer",
      query: {
        startSearchDate: fromDate,
        endSearchDate: toDate,
        answered: false,
        page: 1,
        size: 200,
      },
    },
  ];
  // QAPI exposes S1 (unanswered), S2 (processing), S3 (completed) separately.
  // Read all three so transitions and already-answered inquiries are retained.
  if (channel === "qoo10") return ["S1", "S2", "S3"].map((status) => ({
    params: { search_start_dt: qoo10Date(from), search_end_dt: qoo10Date(now), proc_status: status },
  }));
  if (channel === "temu") {
    const temuFrom = new Date(now.getTime() - 14 * 86_400_000);
    return [{
      pageNo: 1,
      pageSize: 200,
      updateAtStart: temuFrom.getTime(),
      updateAtEnd: now.getTime(),
    }];
  }
  if (channel === "ebay") {
    return [ebayAsqInquirySyncArguments(now, releaseContext.marketplaceId)];
  }
  return [];
}

function inquiryRequestKey(channel: ActiveChannelKey, argumentsValue: Record<string, unknown>, index: number) {
  if (argumentsValue.bootstrap === true) return "inquiries:bootstrap";
  const kind = typeof argumentsValue.kind === "string" ? argumentsValue.kind.trim() : "";
  const query = argumentsValue.query && typeof argumentsValue.query === "object" && !Array.isArray(argumentsValue.query)
    ? argumentsValue.query as Record<string, unknown>
    : {};
  if (channel === "coupang") {
    const status = String(query.answeredType ?? query.partnerCounselingStatus ?? "all").trim().toLowerCase();
    return `inquiries:${kind || "product"}:${status || "all"}`;
  }
  if (channel === "smartstore") return `inquiries:${kind || "product"}`;
  return `inquiries:${index}`;
}

export function inquirySyncRequests(
  channel: ActiveChannelKey,
  now = new Date(),
  releaseContext: {
    environment?: "sandbox" | "production";
    marketplaceId?: EbayAsqMarketplaceId;
  } = {},
) {
  return inquirySyncArguments(channel, now, releaseContext).map((argumentsValue, index) => ({
    periodicKey: inquiryRequestKey(channel, argumentsValue, index),
    arguments: argumentsValue,
  }));
}

function calendarDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Creates a bounded, read-only history refresh for the Korean channels whose
 * public seller APIs expose inquiry history. Coupang is split into at most
 * seven inclusive calendar days per request, while Smartstore supports the
 * requested range directly. 11st is deliberately absent: its official public
 * service overview advertises Product Q&A and Emergency Notification APIs,
 * but the authenticated developer guide is still required to verify the exact
 * seller endpoint, request/response contract, pagination, date window, and
 * whether the connected key is registered for those services. Do not infer a
 * provider contract from the overview alone.
 */
export function inquiryHistorySyncRequests(
  channel: ActiveChannelKey,
  now = new Date(),
  historyDays = 30,
) {
  if (!Number.isInteger(historyDays) || historyDays < 7 || historyDays > 30) {
    throw new Error("INQUIRY_HISTORY_RANGE_INVALID");
  }
  const lastDay = calendarDay(koreaCalendarDate(now));
  const firstDay = new Date(lastDay.getTime() - (historyDays - 1) * 86_400_000);

  if (channel === "coupang") {
    const requests: Array<{ periodicKey: string; arguments: Record<string, unknown> }> = [];
    for (let start = firstDay; start.getTime() <= lastDay.getTime(); start = new Date(start.getTime() + 7 * 86_400_000)) {
      const end = new Date(Math.min(start.getTime() + 6 * 86_400_000, lastDay.getTime()));
      const inquiryStartAt = start.toISOString().slice(0, 10);
      const inquiryEndAt = end.toISOString().slice(0, 10);
      requests.push({
        periodicKey: `inquiries:history:${inquiryStartAt}:${inquiryEndAt}:product:all`,
        arguments: {
          kind: "product",
          query: { inquiryStartAt, inquiryEndAt, answeredType: "ALL", pageNum: 1, pageSize: 50 },
        },
      });
      for (const partnerCounselingStatus of ["NONE", "ANSWER", "NO_ANSWER", "TRANSFER"] as const) {
        requests.push({
          periodicKey: `inquiries:history:${inquiryStartAt}:${inquiryEndAt}:call-center:${partnerCounselingStatus.toLowerCase()}`,
          arguments: {
            kind: "call-center",
            query: { inquiryStartAt, inquiryEndAt, partnerCounselingStatus, pageNum: 1, pageSize: 30 },
          },
        });
      }
    }
    return requests;
  }

  if (channel === "smartstore") {
    const fromDate = new Date(firstDay.getTime());
    const toDate = new Date(now.getTime());
    return [{
      periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:product:all`,
      arguments: {
        kind: "product",
        query: {
          fromDate: `${fromDate.toISOString().slice(0, 10)}T00:00:00.000+09:00`,
          toDate: toDate.toISOString(),
          page: 1,
          size: 100,
        },
      },
    }, {
      periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:customer:all`,
      arguments: {
        kind: "customer",
        query: {
          startSearchDate: firstDay.toISOString().slice(0, 10),
          endSearchDate: lastDay.toISOString().slice(0, 10),
          page: 1,
          size: 200,
        },
      },
    }];
  }

  return [];
}
