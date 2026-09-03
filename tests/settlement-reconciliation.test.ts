import assert from "node:assert/strict";
import test from "node:test";
import {
  computeExpectedDepositAmount,
  reconcileSettlements,
  settlementExpectationKey,
} from "../lib/settlements/reconciliation";
import type {
  SettlementDepositInput,
  SettlementExpectationInput,
} from "../lib/settlements/reconciliation";

const AS_OF = "2026-09-03";

/** 기본 기대액: 100,000 - 12,000 - 3,000 = 85,000 KRW. */
function expectation(overrides: Partial<SettlementExpectationInput> = {}): SettlementExpectationInput {
  return {
    channel: "qoo10",
    settlementNo: "Q-SETTLE-1001",
    currency: "KRW",
    salesAmount: 100_000,
    feeAmount: 12_000,
    shippingAmount: 3_000,
    expectedDate: "2026-09-01",
    source: "api",
    ...overrides,
  };
}

function deposit(overrides: Partial<SettlementDepositInput> = {}): SettlementDepositInput {
  return {
    referenceNo: "BANK-REF-1",
    currency: "KRW",
    amount: 85_000,
    depositedAt: "2026-09-02",
    source: "bank",
    ...overrides,
  };
}

test("matches an exact deposit within the default rounding tolerance", () => {
  const report = reconcileSettlements([expectation()], [deposit({ amount: 85_000.01 })], { asOf: AS_OF });
  assert.equal(report.results.length, 1);
  const result = report.results[0];
  assert.equal(result.status, "matched");
  assert.equal(result.discrepancyType, null);
  assert.equal(result.matchedDepositAmount, 85_000.01);
  assert.equal(result.difference, 0.01);
  assert.deepEqual(result.matchedDepositRefs, ["BANK-REF-1"]);
  assert.equal(result.earliestDepositedAt, "2026-09-02");
  assert.equal(result.latestDepositedAt, "2026-09-02");
  assert.equal(report.unmatchedDeposits.length, 0);
  assert.equal(report.summary.byStatus.matched, 1);
  assert.equal(report.summary.byStatus.missing_deposit, 0);
});

test("flags partial when unattributed deposits cover only part of the expectation", () => {
  const report = reconcileSettlements(
    [expectation()],
    [
      deposit({ referenceNo: "BANK-REF-1", amount: 50_000 }),
      deposit({ referenceNo: "BANK-REF-2", amount: 20_000 }),
    ],
    { asOf: AS_OF },
  );
  const result = report.results[0];
  assert.equal(result.status, "partial");
  assert.equal(result.discrepancyType, "underpaid");
  assert.equal(result.matchedDepositAmount, 70_000);
  assert.equal(result.difference, -15_000);
  assert.equal(result.strongPairedCount, 0);
  assert.deepEqual(result.matchedDepositRefs, ["BANK-REF-1", "BANK-REF-2"]);
  assert.equal(report.unmatchedDeposits.length, 0);
});

test("flags mismatch when the same settlement number is underpaid beyond tolerance", () => {
  const report = reconcileSettlements(
    [expectation()],
    [deposit({ settlementNo: "Q-SETTLE-1001", amount: 60_000 })],
    { asOf: AS_OF },
  );
  const result = report.results[0];
  assert.equal(result.status, "mismatch");
  assert.equal(result.discrepancyType, "amount_mismatch");
  assert.equal(result.matchedDepositAmount, 60_000);
  assert.equal(result.difference, -25_000);
  assert.equal(result.strongPairedCount, 1);
});

test("flags missing deposit for a due expectation without any deposit", () => {
  const report = reconcileSettlements([expectation()], [], { asOf: AS_OF });
  const result = report.results[0];
  assert.equal(result.status, "missing_deposit");
  assert.equal(result.discrepancyType, "no_deposit");
  assert.equal(result.matchedDepositAmount, 0);
  assert.equal(result.difference, -85_000);
  assert.deepEqual(result.matchedDepositRefs, []);
  assert.equal(result.earliestDepositedAt, null);
});

test("flags over deposit when the same settlement number receives too much", () => {
  const report = reconcileSettlements(
    [expectation()],
    [deposit({ settlementNo: "Q-SETTLE-1001", amount: 90_000 })],
    { asOf: AS_OF },
  );
  const result = report.results[0];
  assert.equal(result.status, "over_deposit");
  assert.equal(result.discrepancyType, "overpaid");
  assert.equal(result.matchedDepositAmount, 90_000);
  assert.equal(result.difference, 5_000);
});

test("reconciling identical inputs twice is idempotent and duplicate expectations collapse into one result", () => {
  const inputs = {
    expectations: [
      expectation(),
      expectation(), // 같은 (채널, 정산번호, 통화) 중복
      expectation({ settlementNo: "Q-SETTLE-1002" }),
    ],
    deposits: [deposit({ referenceNo: "BANK-REF-1" })],
  };
  const first = reconcileSettlements(inputs.expectations, inputs.deposits, { asOf: AS_OF });
  const second = reconcileSettlements(inputs.expectations, inputs.deposits, { asOf: AS_OF });
  assert.deepEqual(second, first);
  assert.equal(first.summary.totalExpectations, 2);
  assert.equal(first.summary.deduplicatedExpectations, 1);
  assert.equal(
    first.results.filter((result) => result.expectationKey === "qoo10|Q-SETTLE-1001|KRW").length,
    1,
  );
});

test("never reconciles across currencies and reports the leftover deposit", () => {
  const report = reconcileSettlements(
    [expectation()],
    [deposit({ currency: "USD", amount: 85_000 })],
    { asOf: AS_OF },
  );
  assert.equal(report.results[0].status, "missing_deposit");
  assert.equal(report.unmatchedDeposits.length, 1);
  assert.equal(report.unmatchedDeposits[0].currency, "USD");
  assert.equal(report.unmatchedDeposits[0].amount, 85_000);
});

test("reconciles each currency independently and normalizes currency codes", () => {
  const report = reconcileSettlements(
    [
      expectation(), // KRW 85,000
      expectation({
        channel: "shopee",
        settlementNo: "S-9",
        currency: "usd",
        salesAmount: 1_000,
        feeAmount: 100,
        shippingAmount: 0,
      }),
    ],
    [
      deposit({ referenceNo: "KRW-1", amount: 85_000 }),
      deposit({ referenceNo: "USD-1", currency: "usd", amount: 900 }),
    ],
    { asOf: AS_OF },
  );
  const krw = report.results.find((result) => result.currency === "KRW");
  const usd = report.results.find((result) => result.currency === "USD");
  assert.equal(krw?.status, "matched");
  assert.equal(usd?.status, "matched");
  assert.equal(usd?.expectedDepositAmount, 900);
  assert.equal(report.unmatchedDeposits.length, 0);
});

test("applies absolute, per-currency and ratio tolerances", () => {
  // 절대 허용오차: 차액 10 이 허용 범위면 matched.
  let result = reconcileSettlements([expectation()], [deposit({ amount: 85_010 })], {
    asOf: AS_OF,
    tolerance: 10,
  }).results[0];
  assert.equal(result.status, "matched");

  // 허용오차를 넘는 무기명 초과 입금은 짝짓지 않고 남긴다.
  const narrowed = reconcileSettlements([expectation()], [deposit({ amount: 85_010 })], {
    asOf: AS_OF,
    tolerance: 5,
  });
  assert.equal(narrowed.results[0].status, "missing_deposit");
  assert.equal(narrowed.unmatchedDeposits.length, 1);

  // 통화별 허용오차 오버라이드.
  result = reconcileSettlements([expectation()], [deposit({ amount: 84_985 })], {
    asOf: AS_OF,
    tolerance: 1,
    toleranceByCurrency: { KRW: 20 },
  }).results[0];
  assert.equal(result.status, "matched");
  assert.equal(result.tolerance, 20);

  // 비율 허용오차: max(절대값, 예상액 × ratio).
  result = reconcileSettlements(
    [expectation({ salesAmount: 100_000, feeAmount: 0, shippingAmount: 0 })],
    [deposit({ amount: 100_400 })],
    { asOf: AS_OF, tolerance: 1, toleranceRatio: 0.005 },
  ).results[0];
  assert.equal(result.status, "matched");
  assert.equal(result.tolerance, 500);
});

test("leaves not-yet-due expectations unreconciled but reconciles early strong deposits", () => {
  const report = reconcileSettlements(
    [
      expectation({ expectedDate: "2026-09-10" }),
      expectation({ settlementNo: "EARLY-1", expectedDate: "2026-09-10" }),
    ],
    [deposit({ settlementNo: "EARLY-1", referenceNo: "BANK-EARLY", amount: 85_000 })],
    { asOf: AS_OF },
  );
  const futureResult = report.results.find((result) => result.settlementNo === "Q-SETTLE-1001");
  const earlyResult = report.results.find((result) => result.settlementNo === "EARLY-1");
  assert.equal(futureResult?.status, "unreconciled");
  assert.equal(futureResult?.difference, 0);
  assert.equal(futureResult?.matchedDepositAmount, 0);
  assert.equal(earlyResult?.status, "matched");
  assert.equal(earlyResult?.strongPairedCount, 1);
});

test("pairs deposits by reference number even without a settlement number", () => {
  const report = reconcileSettlements(
    [expectation({ referenceNo: "CHANNEL-REF-9" })],
    [deposit({ referenceNo: "CHANNEL-REF-9" })],
    { asOf: AS_OF },
  );
  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].strongPairedCount, 1);
});

test("keeps channel-scoped deposits away from other channels", () => {
  const report = reconcileSettlements(
    [expectation()],
    [deposit({ channel: "shopee", amount: 85_000 })],
    { asOf: AS_OF },
  );
  assert.equal(report.results[0].status, "missing_deposit");
  assert.equal(report.unmatchedDeposits.length, 1);
});

test("distributes unattributed deposits greedily across expectations", () => {
  const report = reconcileSettlements(
    [expectation(), expectation({ settlementNo: "Q-SETTLE-1002" })],
    [deposit({ referenceNo: "BANK-A" }), deposit({ referenceNo: "BANK-B" })],
    { asOf: AS_OF },
  );
  assert.equal(report.summary.byStatus.matched, 2);
  assert.equal(report.unmatchedDeposits.length, 0);
  const refs = report.results.flatMap((result) => result.matchedDepositRefs).sort();
  assert.deepEqual(refs, ["BANK-A", "BANK-B"]);
});

test("derives the expected deposit from sales, fees, shipping and adjustments", () => {
  const input = expectation({ adjustmentAmount: 500 });
  assert.equal(computeExpectedDepositAmount(input), 84_500);
  const report = reconcileSettlements([input], [deposit({ amount: 84_500 })], { asOf: AS_OF });
  assert.equal(report.results[0].status, "matched");
  assert.equal(report.results[0].expectedDepositAmount, 84_500);
});

test("includes deposit evidence: ids, references and deposit dates", () => {
  const report = reconcileSettlements(
    [expectation()],
    [
      deposit({ depositId: "dep-1", amount: 50_000 }),
      deposit({ depositId: "dep-2", amount: 35_000, depositedAt: "2026-09-01" }),
    ],
    { asOf: AS_OF },
  );
  const result = report.results[0];
  assert.equal(result.status, "matched");
  assert.deepEqual(result.matchedDepositIds, ["dep-1", "dep-2"]);
  assert.equal(result.earliestDepositedAt, "2026-09-01");
  assert.equal(result.latestDepositedAt, "2026-09-02");
});

test("summarizes all six statuses across a mixed batch", () => {
  const report = reconcileSettlements(
    [
      expectation(), // matched (85,000)
      expectation({ settlementNo: "S2" }), // partial (50,000 + 20,000)
      expectation({ settlementNo: "S3", expectedDate: "2026-09-10" }), // unreconciled
      expectation({ settlementNo: "S4" }), // missing
      expectation({ settlementNo: "S5" }), // mismatch (같은 정산번호 60,000)
      expectation({ settlementNo: "S6" }), // over (같은 정산번호 90,000)
    ],
    [
      deposit({ referenceNo: "R1" }),
      deposit({ referenceNo: "R2", amount: 50_000 }),
      deposit({ referenceNo: "R3", amount: 20_000 }),
      deposit({ referenceNo: "R4", settlementNo: "S5", amount: 60_000 }),
      deposit({ referenceNo: "R5", settlementNo: "S6", amount: 90_000 }),
    ],
    { asOf: AS_OF },
  );
  assert.equal(report.summary.totalExpectations, 6);
  assert.equal(report.summary.totalDeposits, 5);
  assert.equal(report.summary.unmatchedDeposits, 0);
  assert.equal(report.summary.byStatus.matched, 1);
  assert.equal(report.summary.byStatus.partial, 1);
  assert.equal(report.summary.byStatus.mismatch, 1);
  assert.equal(report.summary.byStatus.missing_deposit, 1);
  assert.equal(report.summary.byStatus.over_deposit, 1);
  assert.equal(report.summary.byStatus.unreconciled, 1);
  assert.equal(
    report.results.find((result) => result.settlementNo === "S2")?.status,
    "partial",
  );
});

test("rejects malformed inputs with typed errors", () => {
  assert.throws(
    () => reconcileSettlements([expectation({ currency: "US" })], [], { asOf: AS_OF }),
    /SETTLEMENT_CURRENCY_INVALID/,
  );
  assert.throws(
    () => reconcileSettlements([expectation({ salesAmount: -1 })], [], { asOf: AS_OF }),
    /SETTLEMENT_AMOUNT_INVALID/,
  );
  assert.throws(
    () => reconcileSettlements([expectation({ feeAmount: 200_000 })], [], { asOf: AS_OF }),
    /SETTLEMENT_EXPECTED_AMOUNT_NEGATIVE/,
  );
  assert.throws(
    () => reconcileSettlements([expectation({ expectedDate: "2026-13-99" })], [], { asOf: AS_OF }),
    /SETTLEMENT_DATE_INVALID/,
  );
  assert.throws(
    () => reconcileSettlements([expectation()], [deposit({ amount: 0 })], { asOf: AS_OF }),
    /SETTLEMENT_DEPOSIT_AMOUNT_INVALID/,
  );
  assert.throws(
    () => reconcileSettlements([expectation()], [deposit({ referenceNo: " " })], { asOf: AS_OF }),
    /SETTLEMENT_DEPOSIT_REFERENCE_NO_INVALID/,
  );
  assert.throws(
    () =>
      reconcileSettlements([{ ...expectation(), source: "unknown" as never }], [], {
        asOf: AS_OF,
      }),
    /SETTLEMENT_EXPECTATION_SOURCE_INVALID/,
  );
  assert.throws(
    () => reconcileSettlements([expectation()], [], { asOf: AS_OF, tolerance: -1 }),
    /SETTLEMENT_AMOUNT_INVALID/,
  );
});

test("builds stable expectation keys", () => {
  assert.equal(settlementExpectationKey("qoo10", "Q-SETTLE-1001", "krw"), "qoo10|Q-SETTLE-1001|KRW");
  assert.throws(() => settlementExpectationKey("qoo10", "", "KRW"), /SETTLEMENT_EXPECTATION_KEY_INVALID/);
});
