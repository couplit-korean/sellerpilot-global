import type { ActiveChannelKey } from "../channels/catalog";

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

function elevenstDateTime(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 12);
}

function secondsEpoch(value: Date) {
  return Math.floor(value.getTime() / 1000);
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
    // Temu expects epoch seconds (10 digits); milliseconds are rejected as a type error.
    updateAtStart: secondsEpoch(from),
    updateAtEnd: secondsEpoch(now),
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

