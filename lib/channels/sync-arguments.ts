import type { ActiveChannelKey } from "./catalog.ts";
import { ebayAsqMarketplaceId, type EbayAsqMarketplaceId } from "./ebay-asq.ts";

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

function coupangLocalDateTime(value: Date, seconds = false) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, seconds ? 19 : 16);
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

function elevenstCalendarDate(value: Date) {
  return koreaCalendarDate(value).replaceAll("-", "");
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
  // Include answered inquiries: seller-center replies can precede our next poll.
  if (channel === "coupang") return [
    { kind: "product", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, answeredType: "ALL", pageNum: 1, pageSize: 50 } },
    { kind: "call-center", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, partnerCounselingStatus: "NONE", pageNum: 1, pageSize: 30 } },
    { kind: "call-center", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, partnerCounselingStatus: "TRANSFER", pageNum: 1, pageSize: 30 } },
    { kind: "return_request", query: { searchType: "timeFrame", createdAtFrom: coupangLocalDateTime(from), createdAtTo: coupangLocalDateTime(now), cancelType: "RETURN" } },
    { kind: "cancel_request", query: { searchType: "timeFrame", createdAtFrom: coupangLocalDateTime(from), createdAtTo: coupangLocalDateTime(now), cancelType: "CANCEL" } },
    { kind: "exchange_request", query: { createdAtFrom: coupangLocalDateTime(from, true), createdAtTo: coupangLocalDateTime(now, true), maxPerPage: 10 } },
  ];
  if (channel === "smartstore") return [
    {
      kind: "product",
      query: {
        fromDate: from.toISOString(),
        toDate: now.toISOString(),
        page: 1,
        size: 100,
      },
    },
    {
      kind: "customer",
      query: {
        startSearchDate: fromDate,
        endSearchDate: toDate,
        page: 1,
        size: 200,
      },
    },
  ];
  // QAPI exposes S1 (unanswered), S2 (processing), S3 (completed) separately.
  // Read all three so transitions and already-answered inquiries are retained.
  if (channel === "qoo10") return [
    ...["S1", "S2", "S3"].map((status) => ({
      params: { search_start_dt: qoo10Date(from), search_end_dt: qoo10Date(now), proc_status: status },
    })),
    {
      kind: "claim",
      params: {
        search_Sdate: qoo10DateTime(from),
        search_Edate: qoo10DateTime(now),
        search_condition: "2",
      },
    },
  ];
  if (channel === "elevenst") return [{
    startDate: elevenstCalendarDate(from),
    endDate: elevenstCalendarDate(now),
    answerStatus: "00",
  }];
  if (channel === "shopee") return [{ kind: "product_review", cursor: "", pageSize: 100 }, {
    kind: "return_refund",
    pageNo: 1,
    pageSize: 100,
    createTimeFrom: Math.floor(from.getTime() / 1000),
    createTimeTo: Math.floor(now.getTime() / 1000),
  }];
  if (channel === "temu") {
    const temuFrom = new Date(now.getTime() - 14 * 86_400_000);
    return [{
      kind: "after_sales",
      includeDetails: true,
      pageNo: 1,
      pageSize: 200,
      updateAtStart: Math.floor(temuFrom.getTime() / 1000),
      updateAtEnd: Math.floor(now.getTime() / 1000),
    }];
  }
  if (channel === "ebay") {
    return [ebayAsqInquirySyncArguments(now, releaseContext.marketplaceId), {
      kind: "mailbox",
      startTime: from.toISOString(),
      endTime: now.toISOString(),
      folderId: 0,
      pageNumber: 1,
      entriesPerPage: 25,
      ...(releaseContext.marketplaceId ? { marketplaceId: ebayAsqMarketplaceId(releaseContext.marketplaceId) } : {}),
    }, {
      kind: "conversation",
      conversationType: "FROM_MEMBERS",
      startTime: from.toISOString(),
      endTime: now.toISOString(),
      conversationOffset: 0,
    }, {
      kind: "conversation",
      conversationType: "FROM_EBAY",
      conversationOffset: 0,
    }];
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
  if (channel === "qoo10" && kind === "claim") return "inquiries:claim:all";
  if (channel === "elevenst") return "inquiries:product_qna:all";
  if (channel === "shopee") return `inquiries:${kind || "product_review"}`;
  if (channel === "temu") return `inquiries:${kind || "after_sales"}`;
  if (channel === "ebay") return kind === "conversation"
    ? `inquiries:conversation:${String(argumentsValue.conversationType ?? "unknown").toLowerCase()}`
    : `inquiries:${kind || "asq"}`;
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
 * Creates a bounded, read-only history refresh for channels whose verified
 * seller APIs expose inquiry history. Coupang and 11st are split into at most
 * seven inclusive calendar days per request; the other channels use their
 * verified request contracts.
 */
export function inquiryHistorySyncRequests(
  channel: ActiveChannelKey,
  now = new Date(),
  historyDays = 30,
) {
  const maximumHistoryDays = channel === "ebay" ? 365 : 30;
  if (!Number.isInteger(historyDays) || historyDays < 7 || historyDays > maximumHistoryDays) {
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
      const localStart = `${inquiryStartAt}T00:00`;
      const localEnd = `${inquiryEndAt}T23:59`;
      for (const [kind, cancelType] of [["return_request", "RETURN"], ["cancel_request", "CANCEL"]] as const) {
        requests.push({
          periodicKey: `inquiries:history:${inquiryStartAt}:${inquiryEndAt}:${kind}`,
          arguments: {
            kind,
            query: { searchType: "timeFrame", createdAtFrom: localStart, createdAtTo: localEnd, cancelType },
          },
        });
      }
      requests.push({
        periodicKey: `inquiries:history:${inquiryStartAt}:${inquiryEndAt}:exchange_request`,
        arguments: {
          kind: "exchange_request",
          query: { createdAtFrom: `${localStart}:00`, createdAtTo: `${localEnd}:59`, maxPerPage: 10 },
        },
      });
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

  if (channel === "qoo10") {
    return [
      ...["S1", "S2", "S3"].map((status) => ({
      periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:${status.toLowerCase()}`,
      arguments: {
        params: {
          search_start_dt: qoo10Date(firstDay),
          search_end_dt: qoo10Date(now),
          proc_status: status,
        },
      },
      })),
      {
        periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:claim:all`,
        arguments: {
          kind: "claim",
          params: {
            search_Sdate: qoo10DateTime(firstDay),
            search_Edate: qoo10DateTime(now),
            search_condition: "2",
          },
        },
      },
    ];
  }

  if (channel === "elevenst") {
    const requests: Array<{ periodicKey: string; arguments: Record<string, unknown> }> = [];
    for (let start = new Date(firstDay); start.getTime() <= lastDay.getTime(); start = new Date(start.getTime() + 7 * 86_400_000)) {
      const end = new Date(Math.min(start.getTime() + 6 * 86_400_000, lastDay.getTime()));
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);
      requests.push({
        periodicKey: `inquiries:history:${startDate}:${endDate}:product_qna:all`,
        arguments: {
          startDate: startDate.replaceAll("-", ""),
          endDate: endDate.replaceAll("-", ""),
          answerStatus: "00",
        },
      });
    }
    return requests;
  }

  if (channel === "shopee") {
    const requests: Array<{ periodicKey: string; arguments: Record<string, unknown> }> = [];
    for (let start = new Date(firstDay); start.getTime() <= now.getTime();) {
      const end = new Date(Math.min(start.getTime() + 15 * 86_400_000 - 1_000, now.getTime()));
      requests.push({
        periodicKey: `inquiries:history:${start.toISOString()}:${end.toISOString()}:return_refund`,
        arguments: {
          kind: "return_refund",
          pageNo: 1,
          pageSize: 100,
          createTimeFrom: Math.floor(start.getTime() / 1000),
          createTimeTo: Math.floor(end.getTime() / 1000),
        },
      });
      start = new Date(end.getTime() + 1_000);
    }
    return requests;
  }

  if (channel === "temu") {
    const firstCalendarDate = firstDay.toISOString().slice(0, 10);
    const firstSeoulSecond = Math.floor(Date.parse(`${firstCalendarDate}T00:00:00+09:00`) / 1000);
    return [{
      periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:after_sales`,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        updateAtStart: firstSeoulSecond,
        updateAtEnd: Math.floor(now.getTime() / 1000),
      },
    }];
  }

  if (channel === "ebay") {
    const from = new Date(now.getTime() - (historyDays - 1) * 86_400_000);
    const requests: Array<{ periodicKey: string; arguments: Record<string, unknown> }> = [{
      periodicKey: "inquiries:history:conversation:from_ebay",
      arguments: {
        kind: "conversation",
        conversationType: "FROM_EBAY",
        conversationOffset: 0,
      },
    }];
    // Trading API messages are retained for at most one year. Keep every
    // provider call below the adapter's 31-day ceiling and use disjoint
    // millisecond boundaries so a daily repair can safely replay all retained
    // ASQ and Inbox messages without duplicate-window ambiguity.
    for (let start = from; start.getTime() < now.getTime();) {
      const end = new Date(Math.min(start.getTime() + 31 * 86_400_000 - 1, now.getTime()));
      const rangeKey = `${start.toISOString()}:${end.toISOString()}`;
      requests.push({
        periodicKey: `inquiries:history:${rangeKey}:asq`,
        arguments: {
          startCreationTime: start.toISOString(),
          endCreationTime: end.toISOString(),
          pageNumber: 1,
          entriesPerPage: 25,
        },
      }, {
        periodicKey: `inquiries:history:${rangeKey}:mailbox`,
        arguments: {
          kind: "mailbox",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          folderId: 0,
          pageNumber: 1,
          entriesPerPage: 25,
        },
      }, {
        periodicKey: `inquiries:history:${rangeKey}:conversation:from_members`,
        arguments: {
          kind: "conversation",
          conversationType: "FROM_MEMBERS",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          conversationOffset: 0,
        },
      });
      start = new Date(end.getTime() + 1);
    }
    return requests;
  }

  return [];
}
