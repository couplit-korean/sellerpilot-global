import type { ActiveChannelKey } from "./catalog";

type PeriodicSyncRequest = {
  periodicKey: string;
  arguments: Record<string, unknown>;
};

function coupangDailyDate(value: Date) {
  // Coupang's v5 daily order query requires the market UTC offset after the
  // calendar date. A bare YYYY-MM-DD is rejected after the 2025 API
  // internationalization change.
  return `${new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)}+09:00`;
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
  return null;
}

export function orderSyncRequests(channel: ActiveChannelKey, now = new Date()): PeriodicSyncRequest[] {
  const base = orderSyncArguments(channel, now);
  if (!base) return [];
  if (channel === "coupang") {
    const query = base.query && typeof base.query === "object" && !Array.isArray(base.query)
      ? base.query as Record<string, unknown>
      : {};
    const requests: PeriodicSyncRequest[] = ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY"].map((remoteStatus) => ({
      periodicKey: `orders:${remoteStatus}`,
      arguments: { ...base, query: { ...query, status: remoteStatus } },
    }));
    requests.push({
      periodicKey: "orders:CANCEL",
      arguments: {
        kind: "cancelled",
        query: {
          createdAtFrom: new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10),
          createdAtTo: now.toISOString().slice(0, 10),
          cancelType: "CANCEL",
          maxPerPage: 50,
        },
      },
    });
    return requests;
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
        periodicKey: `orders:${elevenstDateTime(olderStart)}:${elevenstDateTime(recentStart)}`,
        arguments: {
          startTime: elevenstDateTime(olderStart),
          endTime: elevenstDateTime(recentStart),
        },
      },
      {
        periodicKey: `orders:${elevenstDateTime(recentStart)}:${elevenstDateTime(now)}`,
        arguments: base,
      },
    ];
  }
  return [{ periodicKey: "orders", arguments: base }];
}

export function inquirySyncArguments(channel: ActiveChannelKey, now = new Date()): Record<string, unknown>[] {
  // Coupang documents a seven-day maximum, but the provider counts both end
  // points in some markets. Six elapsed days avoids an eight-calendar-day
  // window around timezone boundaries.
  const from = new Date(now.getTime() - 6 * 86_400_000);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);
  if (channel === "coupang") return [
    { kind: "product", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, answeredType: "NOANSWER", pageNum: 1, pageSize: 50 } },
    { kind: "call-center", query: { inquiryStartAt: fromDate, inquiryEndAt: toDate, partnerCounselingStatus: "NO_ANSWER", pageNum: 1, pageSize: 30 } },
  ];
  if (channel === "smartstore") return [{
    query: {
      fromDate: from.toISOString(),
      toDate: now.toISOString(),
      answered: false,
      page: 1,
      size: 100,
    },
  }];
  if (channel === "qoo10") return [{
    params: { search_start_dt: qoo10Date(from), search_end_dt: qoo10Date(now), proc_status: "S1" },
  }];
  return [];
}
