import assert from "node:assert/strict";
import test from "node:test";
import {
  coupangHistoryRecoveryBatch,
  coupangHistoryRecoveryCheckpoint,
} from "../lib/channels/cs/coupang/history-recovery.ts";

function successfulRun(overrides: Record<string, unknown> = {}) {
  return {
    fromDate: "2024-01-31",
    toDate: "2024-02-29",
    historyDays: 30,
    expectedInitialJobs: 40,
    totalJobs: 40,
    queuedJobs: 0,
    runningJobs: 0,
    succeededJobs: 40,
    failedJobs: 0,
    status: "succeeded",
    completedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

test("Coupang 30-day recovery creates five fixed windows and all eight scopes", () => {
  const batch = coupangHistoryRecoveryBatch("2024-02-29", 30);
  assert.equal(batch.fromDate, "2024-01-31");
  assert.equal(batch.toDate, "2024-02-29");
  assert.equal(batch.expectedInitialJobs, 40);
  assert.equal(batch.requests.length, 40);

  const windows = new Map<string, string[]>();
  for (const request of batch.requests) {
    const query = request.arguments.query as Record<string, unknown>;
    const from = String(query.inquiryStartAt ?? query.createdAtFrom).slice(0, 10);
    const to = String(query.inquiryEndAt ?? query.createdAtTo).slice(0, 10);
    const key = `${from}:${to}`;
    windows.set(key, [...(windows.get(key) ?? []), String(request.arguments.kind)]);
  }
  assert.equal(windows.size, 5);
  for (const kinds of windows.values()) {
    assert.equal(kinds.length, 8);
    assert.deepEqual(new Set(kinds), new Set([
      "product", "call-center", "return_request", "cancel_request", "exchange_request",
    ]));
    assert.equal(kinds.filter((kind) => kind === "call-center").length, 4);
  }
});

test("Coupang seven-day recovery remains one complete eight-scope unit", () => {
  const batch = coupangHistoryRecoveryBatch("2024-02-29", 7);
  assert.equal(batch.fromDate, "2024-02-23");
  assert.equal(batch.expectedInitialJobs, 8);
  assert.equal(batch.requests.length, 8);
});

test("Coupang recovery rejects invalid dates and unsupported history lengths", () => {
  assert.throws(() => coupangHistoryRecoveryBatch("2024-02-30", 30), /COUPANG_HISTORY_DATE_INVALID/u);
  assert.throws(() => coupangHistoryRecoveryBatch("2024-02-29", 6), /COUPANG_HISTORY_DAYS_INVALID/u);
  assert.throws(() => coupangHistoryRecoveryBatch("2024-02-29", 31), /COUPANG_HISTORY_DAYS_INVALID/u);
});

test("Coupang recovery advances only a fully successful fixed batch", () => {
  assert.deepEqual(coupangHistoryRecoveryCheckpoint(successfulRun()), {
    canAdvance: true,
    replayEndDate: "2024-02-29",
    nextEndDate: "2024-01-30",
  });
  assert.deepEqual(coupangHistoryRecoveryCheckpoint(successfulRun({
    totalJobs: 42,
    succeededJobs: 42,
  })), {
    canAdvance: true,
    replayEndDate: "2024-02-29",
    nextEndDate: "2024-01-30",
  });
});

test("Coupang interrupted or failed recovery replays the identical end date", () => {
  for (const run of [
    successfulRun({ status: "running", queuedJobs: 1, succeededJobs: 39, completedAt: null }),
    successfulRun({ status: "failed", succeededJobs: 39, failedJobs: 1, completedAt: null }),
  ]) {
    assert.deepEqual(coupangHistoryRecoveryCheckpoint(run), {
      canAdvance: false,
      replayEndDate: "2024-02-29",
      nextEndDate: null,
    });
  }
});

test("Coupang recovery rejects inconsistent job ledgers", () => {
  assert.throws(
    () => coupangHistoryRecoveryCheckpoint(successfulRun({ totalJobs: 41 })),
    /COUPANG_HISTORY_RUN_COUNTS_INVALID/u,
  );
  assert.throws(
    () => coupangHistoryRecoveryCheckpoint(successfulRun({ fromDate: "2024-02-01" })),
    /COUPANG_HISTORY_RUN_RANGE_INVALID/u,
  );
});
