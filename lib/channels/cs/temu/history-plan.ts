export type TemuAfterSalesHistoryScope = {
  region: string;
  sellerAccountKeyHash: string;
  earliestProviderDate: string;
  providerRangeVerifiedAt: string;
};

export type TemuAfterSalesHistoryWindow = {
  periodicKey: string;
  scope: {
    region: string;
    sellerAccountKeyHash: string;
    statusGroup: number;
  };
  from: string;
  to: string;
  timezone: "Asia/Seoul";
  arguments: {
    kind: "after_sales";
    includeDetails: true;
    pageNo: 1;
    pageSize: 200;
    afterSalesStatusGroup: number;
    updateAtStart: number;
    updateAtEnd: number;
  };
};

const DAY_MS = 86_400_000;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function seoulDayStart(date: string) {
  if (!CALENDAR_DATE.test(date)) throw new Error("TEMU_HISTORY_DATE_INVALID");
  const value = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(value) || new Date(value + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) !== date) {
    throw new Error("TEMU_HISTORY_DATE_INVALID");
  }
  return value;
}

function calendarDateAtSeoulStart(value: number) {
  return new Date(value + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Creates fixed KST calendar-day/status windows only inside a provider range
 * that was verified outside this module. Seller identity is carried as a hash
 * for progress/UI correlation and is never sent as an undocumented API field.
 */
export function planTemuAfterSalesHistory(input: {
  fromDate: string;
  toDate: string;
  statusGroups?: number[];
  scope: TemuAfterSalesHistoryScope;
}): TemuAfterSalesHistoryWindow[] {
  const start = seoulDayStart(input.fromDate);
  const end = seoulDayStart(input.toDate);
  const earliest = seoulDayStart(input.scope.earliestProviderDate);
  if (start > end) throw new Error("TEMU_HISTORY_RANGE_INVALID");
  if (start < earliest) throw new Error("TEMU_HISTORY_PROVIDER_RANGE_UNVERIFIED");
  if (end - start > 365 * DAY_MS) throw new Error("TEMU_HISTORY_RANGE_TOO_LARGE");
  if (!input.scope.region.trim()) throw new Error("TEMU_HISTORY_REGION_REQUIRED");
  if (!SHA256.test(input.scope.sellerAccountKeyHash)) throw new Error("TEMU_HISTORY_SELLER_SCOPE_INVALID");
  if (!Number.isFinite(Date.parse(input.scope.providerRangeVerifiedAt))) {
    throw new Error("TEMU_HISTORY_PROVIDER_RANGE_EVIDENCE_INVALID");
  }

  const statuses = input.statusGroups ?? [1, 2, 3, 4, 5, 6, 7];
  if (!statuses.length
      || statuses.length > 7
      || statuses.some((status) => !Number.isInteger(status) || status < 1 || status > 7)
      || new Set(statuses).size !== statuses.length) {
    throw new Error("TEMU_HISTORY_STATUS_GROUP_INVALID");
  }

  const windows: TemuAfterSalesHistoryWindow[] = [];
  for (let day = start; day <= end; day += DAY_MS) {
    const date = calendarDateAtSeoulStart(day);
    for (const statusGroup of statuses) {
      windows.push({
        periodicKey: `inquiries:history:${date}:${date}:after_sales:${statusGroup}`,
        scope: {
          region: input.scope.region,
          sellerAccountKeyHash: input.scope.sellerAccountKeyHash,
          statusGroup,
        },
        from: `${date}T00:00:00+09:00`,
        to: `${date}T23:59:59+09:00`,
        timezone: "Asia/Seoul",
        arguments: {
          kind: "after_sales",
          includeDetails: true,
          pageNo: 1,
          pageSize: 200,
          afterSalesStatusGroup: statusGroup,
          updateAtStart: Math.floor(day / 1000),
          updateAtEnd: Math.floor((day + DAY_MS - 1_000) / 1000),
        },
      });
    }
  }
  return windows;
}
