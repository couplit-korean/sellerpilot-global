import assert from "node:assert/strict";
import test from "node:test";
import {
  recordTemuDetailRetryWithReplay,
  requireTemuDetailRetryReceipt,
} from "../lib/channels/cs/temu/retry-rpc";

const expected = {
  reason: "retryable_read_failure" as const,
  arguments: {
    kind: "after_sales",
    includeDetails: true,
    pageNo: 1,
    pageSize: 200,
    updateAtStart: 1_787_000_000,
    updateAtEnd: 1_788_000_000,
    detailQueue: [{ parentAfterSalesSn: "AFTER-3", parentOrderSn: "ORDER-3" }],
    retryReplayQueue: [
      { parentAfterSalesSn: "AFTER-1", parentOrderSn: "ORDER-1" },
      { parentAfterSalesSn: "AFTER-2", parentOrderSn: "ORDER-2" },
    ],
    sellerpilotTemuDetailRetryCount: 1,
  },
  retryCount: 1,
  retryAfterSeconds: 5,
  deferredCount: 1,
  replayCount: 2,
  providerStatus: 503,
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    contract: "temu-after-sales-detail-retry-v2",
    status: "deferred",
    retryCount: 1,
    retryAfterSeconds: 5,
    deferredCount: 1,
    replayCount: 2,
    failureCode: "TEMU_AFTER_SALES_DETAIL_READ_FAILED",
    replayed: false,
    ...overrides,
  };
}

test("Temu retry receipt accepts the atomic first-write and idempotent replay forms", () => {
  assert.equal(requireTemuDetailRetryReceipt({
    data: receipt(),
    error: null,
  }, expected).replayed, false);
  assert.equal(requireTemuDetailRetryReceipt({
    data: receipt({ replayed: true }),
    error: null,
  }, expected).replayed, true);
});

test("Temu retry receipt fails closed when the proposal SQL RPC is not installed", () => {
  for (const code of ["PGRST202", "42883"]) {
    assert.throws(() => requireTemuDetailRetryReceipt({
      data: null,
      error: { code },
    }, expected), /TEMU_AFTER_SALES_DETAIL_RETRY_SCHEMA_NOT_READY/);
  }
});

test("Temu retry receipt rejects transport loss and mismatched durable state", () => {
  assert.throws(() => requireTemuDetailRetryReceipt({
    data: null,
    error: { code: "transport_error" },
  }, expected), /TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED/);
  for (const invalid of [
    receipt({ retryCount: 2 }),
    receipt({ replayCount: 1 }),
    receipt({ failureCode: "OTHER_FAILURE" }),
    receipt({ replayed: "yes" }),
    receipt({ contract: "temu-after-sales-detail-retry-v1" }),
  ]) {
    assert.throws(() => requireTemuDetailRetryReceipt({
      data: invalid,
      error: null,
    }, expected), /TEMU_AFTER_SALES_DETAIL_RETRY_RECEIPT_INVALID/);
  }
});

test("Temu retry RPC replays one exact call after response loss", async () => {
  let calls = 0;
  const replayed = await recordTemuDetailRetryWithReplay(async () => {
    calls += 1;
    return calls === 1
      ? { data: null, error: { code: "transport_error" } }
      : { data: receipt({ replayed: true }), error: null };
  }, expected);
  assert.equal(calls, 2);
  assert.equal(replayed.replayed, true);
});

test("Temu retry RPC does not replay deterministic missing-schema failures", async () => {
  let calls = 0;
  await assert.rejects(recordTemuDetailRetryWithReplay(async () => {
    calls += 1;
    return { data: null, error: { code: "PGRST202" } };
  }, expected), /TEMU_AFTER_SALES_DETAIL_RETRY_SCHEMA_NOT_READY/);
  assert.equal(calls, 1);
});

test("Temu retry RPC stops after one uncertain-response replay", async () => {
  let calls = 0;
  await assert.rejects(recordTemuDetailRetryWithReplay(async () => {
    calls += 1;
    return { data: null, error: { code: "transport_error" } };
  }, expected), /TEMU_AFTER_SALES_DETAIL_RETRY_RECORDING_FAILED/);
  assert.equal(calls, 2);
});
