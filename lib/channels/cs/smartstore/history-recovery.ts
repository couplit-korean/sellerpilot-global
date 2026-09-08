import { createHash } from "node:crypto";

const DAY_MILLISECONDS = 86_400_000;

export type SmartstoreHistoryKind = "product" | "customer";

export type SmartstoreHistoryWindow = {
  key: string;
  fromDate: string;
  toDate: string;
  timezone: "Asia/Seoul";
  requests: Array<{
    kind: SmartstoreHistoryKind;
    periodicKey: string;
    arguments: Record<string, unknown>;
  }>;
};

function calendarMilliseconds(value: string, name: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`SMARTSTORE_HISTORY_${name}_INVALID`);
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    throw new Error(`SMARTSTORE_HISTORY_${name}_INVALID`);
  }
  return milliseconds;
}

function calendarDate(milliseconds: number) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function historyWindow(fromDate: string, toDate: string): SmartstoreHistoryWindow {
  return {
    key: `smartstore:history:v1:${fromDate}:${toDate}`,
    fromDate,
    toDate,
    timezone: "Asia/Seoul",
    requests: [{
      kind: "product",
      periodicKey: `inquiries:history:${fromDate}:${toDate}:product:all`,
      arguments: {
        kind: "product",
        query: {
          fromDate: `${fromDate}T00:00:00.000+09:00`,
          toDate: `${toDate}T23:59:59.999+09:00`,
          page: 1,
          size: 100,
        },
      },
    }, {
      kind: "customer",
      periodicKey: `inquiries:history:${fromDate}:${toDate}:customer:all`,
      arguments: {
        kind: "customer",
        query: {
          startSearchDate: fromDate,
          endSearchDate: toDate,
          page: 1,
          size: 200,
        },
      },
    }],
  };
}

export function buildSmartstoreHistoryWindows(floorDate: string, throughDate: string) {
  const floor = calendarMilliseconds(floorDate, "FLOOR_DATE");
  let end = calendarMilliseconds(throughDate, "THROUGH_DATE");
  if (floor > end) throw new Error("SMARTSTORE_HISTORY_RANGE_INVALID");
  const windows: SmartstoreHistoryWindow[] = [];
  while (end >= floor) {
    const start = Math.max(floor, end - 29 * DAY_MILLISECONDS);
    windows.push(historyWindow(calendarDate(start), calendarDate(end)));
    end = start - DAY_MILLISECONDS;
  }
  return windows;
}

export function smartstoreHistoryPlanDigest(windows: readonly SmartstoreHistoryWindow[]) {
  return createHash("sha256").update(windows.map(window => window.key).join("\n")).digest("hex");
}

export function resumeSmartstoreHistoryWindows(
  windows: readonly SmartstoreHistoryWindow[],
  completedWindowKeys: readonly string[],
) {
  const knownKeys = new Set(windows.map(window => window.key));
  if (knownKeys.size !== windows.length) throw new Error("SMARTSTORE_HISTORY_PLAN_DUPLICATE_WINDOW");
  for (const key of completedWindowKeys) {
    if (!knownKeys.has(key)) throw new Error("SMARTSTORE_HISTORY_CHECKPOINT_UNKNOWN_WINDOW");
  }
  const completed = new Set(completedWindowKeys);
  const remainingWindows = windows.filter(window => !completed.has(window.key));
  return {
    nextWindow: remainingWindows[0] ?? null,
    remainingWindows,
    completedDistinctCount: completed.size,
    duplicateCompletionCount: completedWindowKeys.length - completed.size,
  };
}

