import { inquiryHistorySyncRequests } from "../../sync-arguments.ts";

type HistoryRequest = ReturnType<typeof inquiryHistorySyncRequests>[number];

export type CoupangHistoryRecoveryBatch = {
  fromDate: string;
  toDate: string;
  historyDays: number;
  expectedInitialJobs: number;
  requests: HistoryRequest[];
};

export type CoupangHistoryRunState = {
  fromDate: string;
  toDate: string;
  historyDays: number;
  expectedInitialJobs: number;
  totalJobs: number;
  queuedJobs: number;
  runningJobs: number;
  succeededJobs: number;
  failedJobs: number;
  status: string;
  completedAt?: string | null;
};

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("COUPANG_HISTORY_DATE_INVALID");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("COUPANG_HISTORY_DATE_INVALID");
  }
  return parsed;
}

function shiftDays(value: string, days: number) {
  const date = calendarDate(value);
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function requestDateRange(request: HistoryRequest) {
  const argumentsRecord: Record<string, unknown> = request.arguments;
  const query = argumentsRecord.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("COUPANG_HISTORY_SCOPE_INVALID");
  }
  const values = query as Record<string, unknown>;
  const from = String(values.inquiryStartAt ?? values.createdAtFrom ?? "").slice(0, 10);
  const to = String(values.inquiryEndAt ?? values.createdAtTo ?? "").slice(0, 10);
  calendarDate(from);
  calendarDate(to);
  const duration = calendarDate(to).getTime() - calendarDate(from).getTime();
  if (duration < 0 || duration > 6 * 86_400_000) {
    throw new Error("COUPANG_HISTORY_SCOPE_RANGE_INVALID");
  }
  return { from, to };
}

/** Build one deterministic, replayable 7-30 day Coupang history batch. */
export function coupangHistoryRecoveryBatch(
  toDate: string,
  historyDays = 30,
): CoupangHistoryRecoveryBatch {
  calendarDate(toDate);
  if (!Number.isInteger(historyDays) || historyDays < 7 || historyDays > 30) {
    throw new Error("COUPANG_HISTORY_DAYS_INVALID");
  }
  const fromDate = shiftDays(toDate, -(historyDays - 1));
  // Noon KST avoids either UTC boundary while preserving the requested Korean
  // calendar end date in the existing shared request generator.
  const requests = inquiryHistorySyncRequests(
    "coupang",
    new Date(`${toDate}T12:00:00.000+09:00`),
    historyDays,
  );
  const windows = new Map<string, Set<string>>();
  for (const request of requests) {
    const range = requestDateRange(request);
    if (range.from < fromDate || range.to > toDate) throw new Error("COUPANG_HISTORY_SCOPE_RANGE_INVALID");
    const key = `${range.from}:${range.to}`;
    const scopes = windows.get(key) ?? new Set<string>();
    const argumentsRecord: Record<string, unknown> = request.arguments;
    const kind = String(argumentsRecord.kind ?? "");
    const query = argumentsRecord.query as Record<string, unknown>;
    const scope = kind === "call-center"
      ? `${kind}:${String(query.partnerCounselingStatus ?? "")}`
      : `${kind}:ALL`;
    if (scopes.has(scope)) throw new Error("COUPANG_HISTORY_SCOPE_DUPLICATE");
    scopes.add(scope);
    windows.set(key, scopes);
  }
  const expectedScopes = new Set([
    "product:ALL",
    "call-center:NONE",
    "call-center:ANSWER",
    "call-center:NO_ANSWER",
    "call-center:TRANSFER",
    "return_request:ALL",
    "cancel_request:ALL",
    "exchange_request:ALL",
  ]);
  for (const scopes of windows.values()) {
    if (scopes.size !== expectedScopes.size
        || [...expectedScopes].some((scope) => !scopes.has(scope))) {
      throw new Error("COUPANG_HISTORY_SCOPE_INCOMPLETE");
    }
  }
  const expectedWindowKeys = new Set<string>();
  for (let start = fromDate; start <= toDate; start = shiftDays(start, 7)) {
    const end = shiftDays(start, 6) < toDate ? shiftDays(start, 6) : toDate;
    expectedWindowKeys.add(`${start}:${end}`);
  }
  if (windows.size !== expectedWindowKeys.size
      || [...expectedWindowKeys].some((key) => !windows.has(key))) {
    throw new Error("COUPANG_HISTORY_WINDOWS_INCOMPLETE");
  }
  const expectedInitialJobs = Math.ceil(historyDays / 7) * expectedScopes.size;
  if (requests.length !== expectedInitialJobs) throw new Error("COUPANG_HISTORY_JOB_COUNT_INVALID");
  return { fromDate, toDate, historyDays, expectedInitialJobs, requests };
}

/** Advance only a fully completed batch; otherwise replay the identical end date. */
export function coupangHistoryRecoveryCheckpoint(run: CoupangHistoryRunState) {
  calendarDate(run.fromDate);
  calendarDate(run.toDate);
  if (!Number.isInteger(run.historyDays) || run.historyDays < 7 || run.historyDays > 30
      || run.fromDate !== shiftDays(run.toDate, -(run.historyDays - 1))) {
    throw new Error("COUPANG_HISTORY_RUN_RANGE_INVALID");
  }
  const expectedInitialJobs = Math.ceil(run.historyDays / 7) * 8;
  if (run.expectedInitialJobs !== expectedInitialJobs
      || ![run.totalJobs, run.queuedJobs, run.runningJobs, run.succeededJobs, run.failedJobs]
        .every((value) => Number.isInteger(value) && value >= 0)
      || run.queuedJobs + run.runningJobs + run.succeededJobs + run.failedJobs !== run.totalJobs
      || run.totalJobs < expectedInitialJobs) {
    throw new Error("COUPANG_HISTORY_RUN_COUNTS_INVALID");
  }
  const complete = run.status === "succeeded"
    && run.queuedJobs === 0
    && run.runningJobs === 0
    && run.failedJobs === 0
    && run.succeededJobs === run.totalJobs
    && Boolean(run.completedAt);
  return {
    canAdvance: complete,
    replayEndDate: run.toDate,
    nextEndDate: complete ? shiftDays(run.fromDate, -1) : null,
  };
}
