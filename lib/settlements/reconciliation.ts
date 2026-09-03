/**
 * 정산 대조 (settlement reconciliation) — pure, deterministic logic.
 *
 * 채널 정산 예정 기록(판매금액·수수료·배송비 → 예상 입금액)과 실제 입금
 * 기록을 (채널, 통화) 단위로 대조한다. 정산 예정 데이터는 채널 정산 API
 * (lib/channels/catalog.ts 의 `settlements` 능력, 주기조회)에서 오거나,
 * 정산 API가 확정되지 않은 채널(11번가 등)은 수동 입력에서 온다. 실제
 * 입금은 은행 거래 내역(수동 입력/가져오기)이다.
 *
 * 결정 규칙 (expectation 하나에 대해):
 * - 예정일(expectedDate)이 asOf 이후이고 강결합 입금이 없으면
 *   `unreconciled` — 아직 대조 대상이 아니다.
 * - 강결합: deposit.settlementNo === expectation.settlementNo 또는
 *   deposit.referenceNo === expectation.referenceNo (같은 통화, 채널 범위 내).
 * - 약결합: 같은 통화 + 채널 범위의 미결합 입금을 누적하되
 *   accumulated + amount <= expected + tolerance 까지만 허용한다. 기대액을
 *   허용오차 이상 초과하는 무기명 입금은 여러 정산을 합친 입금일 수 있어
 *   짝짓지 않고 unmatchedDeposits 로 남긴다 (강결합이면 예외 없이 짝지음).
 * - |차액| <= tolerance → matched
 * - 결합 입금 0건 → missing_deposit
 * - 차액 > tolerance → over_deposit (강결합 초과 또는 누적 초과)
 * - 차액 < -tolerance 이고 강결합이 있으면 → mismatch (같은 정산번호인데
 *   금액이 적게 입금된 명시적 불일치), 강결합이 없으면 → partial (일부만
 *   입금, 잔액 입금 대기).
 *
 * 멱등성: 같은 (channel, settlementNo, currency) expectation은 입력에서
 * 중복 제거되고, 이 함수는 순수 함수라 동일 입력 → 동일 결과다. DB 계층
 * (20260903110000_settlement_reconciliation.sql)에서는
 * (owner_id, channel_key, settlement_no, currency) 유니크와
 * settlement_reconciliation_results.expectation_id 유니크로 재실행해도
 * 결과 행이 중복 생성되지 않는다.
 */

export const settlementStatuses = [
  "unreconciled",
  "matched",
  "partial",
  "mismatch",
  "missing_deposit",
  "over_deposit",
] as const;

export type SettlementReconciliationStatus = (typeof settlementStatuses)[number];

export const settlementDiscrepancyTypes = [
  "no_deposit",
  "underpaid",
  "overpaid",
  "amount_mismatch",
] as const;

export type SettlementDiscrepancyType = (typeof settlementDiscrepancyTypes)[number];

/** 정산 예정 데이터 출처. 채널 정산 API 동기화 또는 수동 입력. */
export type SettlementExpectationSource = "api" | "manual";

/** 실제 입금 데이터 출처. 은행 거래 내역이 기본. */
export type SettlementDepositSource = "bank" | "manual" | "api";

export type SettlementExpectationInput = {
  /** 채널 키 (예: "qoo10", "shopee", "elevenst"). */
  channel: string;
  /** 채널 정산번호/배치번호. 수동 입력이면 운영자가 부여한 키. */
  settlementNo: string;
  /** ISO 4217 통화 코드 (KRW, USD, JPY ...). */
  currency: string;
  /** 판매금액. */
  salesAmount: number;
  /** 수수료 (차감). */
  feeAmount: number;
  /** 배송비 (차감). 기본 0. */
  shippingAmount?: number;
  /** 기타 조정 차감액 (기본 0). */
  adjustmentAmount?: number;
  /** 예상 입금액. 생략 시 판매금액 - 수수료 - 배송비 - 조정으로 계산. */
  expectedDepositAmount?: number;
  /** 예상 입금일 (YYYY-MM-DD). */
  expectedDate: string;
  /** 정산 데이터 출처: 채널 정산 API 동기화 또는 수동 입력. */
  source: SettlementExpectationSource;
  /** 채널이 준 정산 참조번호 (선택). */
  referenceNo?: string;
};

export type SettlementDepositInput = {
  /** 호출자가 부여한 안정 ID (선택). 결과의 근거로 반환된다. */
  depositId?: string;
  /** 입금이 귀속되는 채널 (은행 입금이면 보통 없음). */
  channel?: string;
  /** 은행 메모에 정산번호가 있으면 기재 (선택). */
  settlementNo?: string;
  /** 입금 참조번호/거래 메모. 필수. */
  referenceNo: string;
  /** ISO 4217 통화 코드. */
  currency: string;
  /** 실제 입금액 (> 0). */
  amount: number;
  /** 입금일 (YYYY-MM-DD). */
  depositedAt: string;
  /** 입금 출처. */
  source: SettlementDepositSource;
};

export type SettlementReconciliationOptions = {
  /** 대조 기준일. expectedDate > asOf 이면 미도래로 unreconciled 처리. 기본: 오늘(UTC). */
  asOf?: string;
  /** 절대 허용오차 기본값 (반올림·환율차 흡수). 기본 0.01. */
  tolerance?: number;
  /** 통화별 절대 허용오차 오버라이드. */
  toleranceByCurrency?: Record<string, number>;
  /** 예상액 대비 비율 허용오차. 유효 허용오차 = max(절대값, 예상액 × ratio). 기본 0. */
  toleranceRatio?: number;
};

export type SettlementReconciliationResult = {
  /** (채널|정산번호|통화) 멱등 키. */
  expectationKey: string;
  channel: string;
  settlementNo: string;
  currency: string;
  expectedDepositAmount: number;
  matchedDepositAmount: number;
  /** matchedDepositAmount - expectedDepositAmount. unreconciled 는 0. */
  difference: number;
  status: SettlementReconciliationStatus;
  /** 불일치 유형. matched/unreconciled 는 null. */
  discrepancyType: SettlementDiscrepancyType | null;
  /** 이 expectation 에 적용된 유효 허용오차. */
  tolerance: number;
  /** 강결합(정산번호/참조번호 일치)으로 결합된 입금 수. */
  strongPairedCount: number;
  matchedDepositIds: string[];
  matchedDepositRefs: string[];
  /** 결합된 입금 중 최초 입금일. */
  earliestDepositedAt: string | null;
  /** 결합된 입금 중 최후 입금일. */
  latestDepositedAt: string | null;
};

export type SettlementUnmatchedDeposit = {
  depositId: string | null;
  channel: string | null;
  settlementNo: string | null;
  referenceNo: string;
  currency: string;
  amount: number;
  depositedAt: string;
};

export type SettlementReconciliationReport = {
  asOf: string;
  results: SettlementReconciliationResult[];
  unmatchedDeposits: SettlementUnmatchedDeposit[];
  summary: {
    totalExpectations: number;
    /** 입력에서 (채널|정산번호|통화) 키가 중복돼 제거된 건수. */
    deduplicatedExpectations: number;
    totalDeposits: number;
    unmatchedDeposits: number;
    byStatus: Record<SettlementReconciliationStatus, number>;
  };
};

type NormalizedExpectation = {
  key: string;
  channel: string;
  settlementNo: string;
  currency: string;
  expectedDepositAmount: number;
  expectedDate: string;
  source: SettlementExpectationSource;
  referenceNo: string | null;
  inputIndex: number;
};

type NormalizedDeposit = {
  inputIndex: number;
  depositId: string | null;
  channel: string | null;
  settlementNo: string | null;
  referenceNo: string;
  currency: string;
  amount: number;
  depositedAt: string;
  source: SettlementDepositSource;
};

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeCurrency(value: string, context: string): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(code)) {
    throw new Error(`SETTLEMENT_CURRENCY_INVALID:${context}`);
  }
  return code;
}

function normalizeDate(value: string, context: string): string {
  const text = String(value ?? "").trim();
  if (!DATE_PATTERN.test(text)) {
    throw new Error(`SETTLEMENT_DATE_INVALID:${context}`);
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`SETTLEMENT_DATE_INVALID:${context}`);
  }
  return text;
}

function requireAmount(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`SETTLEMENT_AMOUNT_INVALID:${context}`);
  }
  return value;
}

function optionalAmount(value: unknown): number {
  if (value === undefined) return 0;
  return requireAmount(value, "amount");
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** (채널|정산번호|통화) 멱등 키. DB 유니크 제약과 같은 형식. */
export function settlementExpectationKey(channel: string, settlementNo: string, currency: string): string {
  const code = normalizeCurrency(currency, "expectationKey");
  const normalizedChannel = String(channel ?? "").trim();
  const normalizedSettlementNo = String(settlementNo ?? "").trim();
  if (!normalizedChannel || !normalizedSettlementNo) {
    throw new Error("SETTLEMENT_EXPECTATION_KEY_INVALID");
  }
  return `${normalizedChannel}|${normalizedSettlementNo}|${code}`;
}

/** 예상 입금액 계산: 명시값이 있으면 그대로, 없으면 판매금액 - 수수료 - 배송비 - 조정. */
export function computeExpectedDepositAmount(input: SettlementExpectationInput): number {
  const sales = requireAmount(input.salesAmount, "salesAmount");
  const fee = optionalAmount(input.feeAmount);
  const shipping = optionalAmount(input.shippingAmount);
  const adjustment = optionalAmount(input.adjustmentAmount);
  if (input.expectedDepositAmount !== undefined) {
    return round2(requireAmount(input.expectedDepositAmount, "expectedDepositAmount"));
  }
  const computed = sales - fee - shipping - adjustment;
  if (computed < 0) {
    throw new Error("SETTLEMENT_EXPECTED_AMOUNT_NEGATIVE");
  }
  return round2(computed);
}

function normalizeExpectation(input: SettlementExpectationInput, inputIndex: number): NormalizedExpectation {
  const channel = String(input.channel ?? "").trim();
  const settlementNo = String(input.settlementNo ?? "").trim();
  if (!channel || channel.length > 60) {
    throw new Error("SETTLEMENT_EXPECTATION_CHANNEL_INVALID");
  }
  if (!settlementNo || settlementNo.length > 240) {
    throw new Error("SETTLEMENT_EXPECTATION_SETTLEMENT_NO_INVALID");
  }
  const currency = normalizeCurrency(input.currency, "expectation");
  const expectedDepositAmount = computeExpectedDepositAmount(input);
  const expectedDate = normalizeDate(input.expectedDate, "expectedDate");
  if (input.source !== "api" && input.source !== "manual") {
    throw new Error("SETTLEMENT_EXPECTATION_SOURCE_INVALID");
  }
  const referenceNo =
    typeof input.referenceNo === "string" && input.referenceNo.trim() ? input.referenceNo.trim() : null;
  return {
    key: settlementExpectationKey(channel, settlementNo, currency),
    channel,
    settlementNo,
    currency,
    expectedDepositAmount,
    expectedDate,
    source: input.source,
    referenceNo,
    inputIndex,
  };
}

function normalizeDeposit(input: SettlementDepositInput, inputIndex: number): NormalizedDeposit {
  const referenceNo = String(input.referenceNo ?? "").trim();
  if (!referenceNo || referenceNo.length > 240) {
    throw new Error("SETTLEMENT_DEPOSIT_REFERENCE_NO_INVALID");
  }
  const currency = normalizeCurrency(input.currency, "deposit");
  const amount = requireAmount(input.amount, "depositAmount");
  if (amount <= 0) {
    throw new Error("SETTLEMENT_DEPOSIT_AMOUNT_INVALID");
  }
  const depositedAt = normalizeDate(input.depositedAt, "depositedAt");
  if (input.source !== "bank" && input.source !== "manual" && input.source !== "api") {
    throw new Error("SETTLEMENT_DEPOSIT_SOURCE_INVALID");
  }
  const channel = typeof input.channel === "string" && input.channel.trim() ? input.channel.trim() : null;
  const settlementNo =
    typeof input.settlementNo === "string" && input.settlementNo.trim() ? input.settlementNo.trim() : null;
  const depositId = typeof input.depositId === "string" && input.depositId.trim() ? input.depositId.trim() : null;
  return {
    inputIndex,
    depositId,
    channel,
    settlementNo,
    referenceNo,
    currency,
    amount,
    depositedAt,
    source: input.source,
  };
}

function effectiveTolerance(
  expected: number,
  currency: string,
  options: { absolute: number; ratio: number; byCurrency: Record<string, number> },
): number {
  const absolute = options.byCurrency[currency] ?? options.absolute;
  return Math.max(absolute, options.ratio * expected);
}

/** 입력 정산 예정 기록과 실제 입금 기록을 대조한다. 동일 입력 → 동일 결과. */
export function reconcileSettlements(
  expectationInputs: readonly SettlementExpectationInput[],
  depositInputs: readonly SettlementDepositInput[],
  options: SettlementReconciliationOptions = {},
): SettlementReconciliationReport {
  const asOf =
    options.asOf === undefined ? new Date().toISOString().slice(0, 10) : normalizeDate(options.asOf, "asOf");
  const absoluteTolerance = options.tolerance === undefined ? 0.01 : requireAmount(options.tolerance, "tolerance");
  const ratioTolerance =
    options.toleranceRatio === undefined ? 0 : requireAmount(options.toleranceRatio, "toleranceRatio");
  const byCurrency: Record<string, number> = {};
  if (options.toleranceByCurrency !== undefined) {
    for (const [currency, value] of Object.entries(options.toleranceByCurrency)) {
      byCurrency[normalizeCurrency(currency, "toleranceByCurrency")] = requireAmount(
        value,
        "toleranceByCurrency",
      );
    }
  }

  // (채널|정산번호|통화) 기준 중복 입력 제거 — 같은 expectation에 대해
  // 결과가 중복 생성되지 않게 하는 멱등 처리.
  const expectations: NormalizedExpectation[] = [];
  const seen = new Set<string>();
  let deduplicated = 0;
  expectationInputs.forEach((input, inputIndex) => {
    const normalized = normalizeExpectation(input, inputIndex);
    if (seen.has(normalized.key)) {
      deduplicated += 1;
      return;
    }
    seen.add(normalized.key);
    expectations.push(normalized);
  });

  const deposits = depositInputs.map((input, inputIndex) => normalizeDeposit(input, inputIndex));

  const consumed = new Set<number>();
  const pairing = expectations.map(() => ({ indices: [] as number[], strongCount: 0, accumulated: 0 }));

  const pair = (expectationIndex: number, depositIndex: number, strong: boolean) => {
    const entry = pairing[expectationIndex];
    entry.indices.push(depositIndex);
    entry.accumulated += deposits[depositIndex].amount;
    if (strong) entry.strongCount += 1;
    consumed.add(depositIndex);
  };

  // 1차: 강결합 (정산번호/참조번호 일치). 초과 입금도 예외 없이 결합한다.
  for (let i = 0; i < expectations.length; i += 1) {
    const expectation = expectations[i];
    for (let j = 0; j < deposits.length; j += 1) {
      if (consumed.has(j)) continue;
      const candidate = deposits[j];
      if (candidate.currency !== expectation.currency) continue;
      if (candidate.channel !== null && candidate.channel !== expectation.channel) continue;
      if (
        candidate.settlementNo === expectation.settlementNo ||
        (expectation.referenceNo !== null && candidate.referenceNo === expectation.referenceNo)
      ) {
        pair(i, j, true);
      }
    }
  }

  // 2차: 약결합 (금액 근접). 기대액 + 허용오차를 넘지 않는 입금만 누적한다.
  for (let i = 0; i < expectations.length; i += 1) {
    const expectation = expectations[i];
    const tolerance = effectiveTolerance(expectation.expectedDepositAmount, expectation.currency, {
      absolute: absoluteTolerance,
      ratio: ratioTolerance,
      byCurrency,
    });
    const due = expectation.expectedDate <= asOf;
    if (!due && pairing[i].strongCount === 0) continue;
    while (Math.abs(pairing[i].accumulated - expectation.expectedDepositAmount) > tolerance) {
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let j = 0; j < deposits.length; j += 1) {
        if (consumed.has(j)) continue;
        const candidate = deposits[j];
        if (candidate.currency !== expectation.currency) continue;
        if (candidate.channel !== null && candidate.channel !== expectation.channel) continue;
        const projected = pairing[i].accumulated + candidate.amount;
        if (projected > expectation.expectedDepositAmount + tolerance) continue;
        const distance = Math.abs(expectation.expectedDepositAmount - projected);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = j;
        }
      }
      if (bestIndex < 0) break;
      pair(i, bestIndex, false);
    }
  }

  const results: SettlementReconciliationResult[] = expectations.map((expectation, i) => {
    const tolerance = effectiveTolerance(expectation.expectedDepositAmount, expectation.currency, {
      absolute: absoluteTolerance,
      ratio: ratioTolerance,
      byCurrency,
    });
    const due = expectation.expectedDate <= asOf;
    const accumulated = pairing[i].accumulated;
    const strongCount = pairing[i].strongCount;
    const rawDifference = accumulated - expectation.expectedDepositAmount;

    let status: SettlementReconciliationStatus;
    let discrepancyType: SettlementDiscrepancyType | null = null;
    if (!due && strongCount === 0) {
      status = "unreconciled";
    } else if (Math.abs(rawDifference) <= tolerance + 1e-9) {
      status = "matched";
    } else if (accumulated === 0) {
      status = "missing_deposit";
      discrepancyType = "no_deposit";
    } else if (rawDifference > 0) {
      status = "over_deposit";
      discrepancyType = "overpaid";
    } else if (strongCount > 0) {
      status = "mismatch";
      discrepancyType = "amount_mismatch";
    } else {
      status = "partial";
      discrepancyType = "underpaid";
    }

    const pairedDeposits = pairing[i].indices.map((j) => deposits[j]);
    const matchedDepositIds = pairedDeposits
      .map((d) => d.depositId)
      .filter((value): value is string => value !== null);
    const matchedDepositRefs = pairedDeposits.map((d) => d.referenceNo);
    const depositedDates = pairedDeposits.map((d) => d.depositedAt);
    const earliestDepositedAt = depositedDates.length > 0 ? depositedDates.reduce((a, b) => (a < b ? a : b)) : null;
    const latestDepositedAt = depositedDates.length > 0 ? depositedDates.reduce((a, b) => (a > b ? a : b)) : null;

    return {
      expectationKey: expectation.key,
      channel: expectation.channel,
      settlementNo: expectation.settlementNo,
      currency: expectation.currency,
      expectedDepositAmount: round2(expectation.expectedDepositAmount),
      matchedDepositAmount: round2(accumulated),
      difference: status === "unreconciled" ? 0 : round2(rawDifference),
      status,
      discrepancyType,
      tolerance: round2(tolerance),
      strongPairedCount: strongCount,
      matchedDepositIds,
      matchedDepositRefs,
      earliestDepositedAt,
      latestDepositedAt,
    };
  });

  const unmatchedDeposits: SettlementUnmatchedDeposit[] = deposits
    .filter((_deposit, index) => !consumed.has(index))
    .map((deposit) => ({
      depositId: deposit.depositId,
      channel: deposit.channel,
      settlementNo: deposit.settlementNo,
      referenceNo: deposit.referenceNo,
      currency: deposit.currency,
      amount: round2(deposit.amount),
      depositedAt: deposit.depositedAt,
    }));

  const byStatus = Object.fromEntries(
    settlementStatuses.map((status) => [status, 0]),
  ) as Record<SettlementReconciliationStatus, number>;
  for (const result of results) {
    byStatus[result.status] += 1;
  }

  return {
    asOf,
    results,
    unmatchedDeposits,
    summary: {
      totalExpectations: expectations.length,
      deduplicatedExpectations: deduplicated,
      totalDeposits: deposits.length,
      unmatchedDeposits: unmatchedDeposits.length,
      byStatus,
    },
  };
}
