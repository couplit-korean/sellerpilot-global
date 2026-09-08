import assert from "node:assert/strict";
import test from "node:test";
import {
  shopeeHistoryRangeEpoch,
  shopeeHistoryRunIdForRequestKey,
  shopeeHistoryStartMatchesRequestKey,
} from "../lib/cs/channels/shopee/history-start-request";

const requestKey = "00000000-0000-4000-8000-000000004001";

test("Shopee history date parsing rejects normalized invalid dates and future KST dates", () => {
  const nowMs = Date.parse("2026-09-08T12:34:56.789Z");
  assert.throws(() => shopeeHistoryRangeEpoch({ fromDate: "2024-02-30", toDate: "2024-03-01", nowMs }),
    /SHOPEE_HISTORY_DATE_INVALID/);
  assert.throws(() => shopeeHistoryRangeEpoch({ fromDate: "2026-09-08", toDate: "2026-09-09", nowMs }),
    /SHOPEE_HISTORY_DATE_INVALID/);
});

test("today in KST ends at the current instant instead of a future 23:59:59", () => {
  const nowMs = Date.parse("2026-09-08T12:34:56.789Z");
  const range = shopeeHistoryRangeEpoch({ fromDate: "2026-09-08", toDate: "2026-09-08", nowMs });
  assert.equal(range.today, "2026-09-08");
  assert.equal(range.to, Math.floor(nowMs / 1_000));
  assert.equal(range.toUsesCurrentTime, true);
  assert.equal(range.from, Math.floor(Date.parse("2026-09-07T15:00:00.000Z") / 1_000));
});

test("past end dates remain inclusive through 23:59:59 KST", () => {
  const range = shopeeHistoryRangeEpoch({
    fromDate: "2026-09-06", toDate: "2026-09-07", nowMs: Date.parse("2026-09-08T12:34:56.789Z"),
  });
  assert.equal(range.to, Math.floor(Date.parse("2026-09-07T14:59:59.000Z") / 1_000));
  assert.equal(range.toUsesCurrentTime, false);
});

test("historyRunId is derived from and must match the request UUID", () => {
  const historyRunId = shopeeHistoryRunIdForRequestKey(requestKey);
  assert.equal(historyRunId, "shopee-history-00000000000040008000000000004001");
  assert.equal(shopeeHistoryStartMatchesRequestKey(requestKey, { historyRunId }), true);
  assert.equal(shopeeHistoryStartMatchesRequestKey(requestKey, { historyRunId: `${historyRunId}x` }), false);
});
