import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateMargins,
  fetchMarginReferenceRates,
  marginExchangeRateRefreshMs,
  marginExchangeRateTimeoutMs,
} from "../app/margin-calculator";
import type { ChannelKey } from "../app/channel-config";

const form = {
  sellingPrice: 100_000,
  marketReferencePrice: 90_000,
  purchaseCost: 40_000,
  internationalShipping: 10_000,
  localShipping: 0,
  fulfillmentCost: 0,
  fixedCost: 0,
  taxRate: 3,
  adRate: 2,
  reserveRate: 1,
  targetMargin: 25,
};

const paymentFees: Record<ChannelKey, number> = {
  qoo10: 2,
  shopee: 0,
  lazada: 0,
  coupang: 0,
  elevenst: 0,
  smartstore: 0,
  ebay: 0,
  temu: 0,
};

const feeOverrides = (elevenst: number | null): Record<ChannelKey, number | null> => ({
  qoo10: 10,
  shopee: 0,
  lazada: 0,
  coupang: 0,
  elevenst,
  smartstore: 0,
  ebay: 0,
  temu: null,
});

const profiles = [
  { key: "qoo10" as const, currency: "JPY" as const, symbol: "¥", rateToKrw: 8.7789, platformFee: 10, paymentFee: 2 },
  { key: "elevenst" as const, currency: "KRW" as const, symbol: "₩", rateToKrw: 1, platformFee: null, paymentFee: 0, requiresManualFee: true },
];

test("manual-fee channels remain locked for null and zero, then calculate after a positive fee", () => {
  const missing = calculateMargins(form, feeOverrides(null), paymentFees, profiles).find((result) => result.key === "elevenst");
  const zero = calculateMargins(form, feeOverrides(0), paymentFees, profiles).find((result) => result.key === "elevenst");
  const entered = calculateMargins(form, feeOverrides(12), paymentFees, profiles).find((result) => result.key === "elevenst");

  assert.equal(missing?.feeReady, false);
  assert.equal(missing?.exchangeRateReady, true);
  assert.equal(missing?.calculationReady, false);
  assert.equal(zero?.feeReady, false);
  assert.equal(entered?.feeReady, true);
  assert.equal(entered?.calculationReady, true);
  assert.equal(entered?.variableRate, 18);
  assert.equal(entered?.profit, 32_000);
  assert.equal(entered?.margin, 32);
  assert.equal(entered?.breakEvenPrice, 61_000);
  assert.equal(entered?.recommendedPrice, 87_800);
});

test("known-fee channel calculation is unchanged and manual UI fails closed", async () => {
  const qoo10 = calculateMargins(form, feeOverrides(null), paymentFees, profiles).find((result) => result.key === "qoo10");
  assert.equal(qoo10?.feeReady, true);
  assert.equal(qoo10?.exchangeRateReady, true);
  assert.equal(qoo10?.calculationReady, true);
  assert.equal(qoo10?.variableRate, 18);
  assert.equal(qoo10?.profit, 32_000);
  assert.equal(qoo10?.margin, 32);
  assert.equal(qoo10?.breakEvenPrice, 61_000);
  assert.equal(qoo10?.recommendedPrice, 87_800);

  const source = await readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8");
  assert.match(source, /key: "elevenst"[^\n]*platformFee: null/);
  assert.match(source, /key: "temu"[^\n]*platformFee: null/);
  assert.match(source, /!channel\.requiresManualFee \|\| platformFee > 0/);
  assert.match(source, /플랫폼 수수료를 직접 입력하세요/);
  assert.match(source, /selectedResult\.calculationReady \? formatWon\(selectedResult\.profit\) : "계산 대기"/);
  assert.match(source, /selectedResult\.calculationReady \? formatWon\(selectedResult\.recommendedPrice\) : "—"/);
  assert.match(source, /selectedResult\.calculationReady \? <><div className="margin-stack-bar"/);
  assert.match(source, /disabled=\{!selectedResult\.calculationReady \|\| !selectedResult\.recommendedPrice\}/);
  assert.match(source, /disabled=\{savingScenario \|\| !selectedResult\.calculationReady\}/);
});

test("foreign channels fail closed until a real exchange rate is supplied while KRW remains usable", () => {
  const missingForeignRate = calculateMargins(form, feeOverrides(null), paymentFees, [
    { key: "qoo10" as const, currency: "JPY" as const, symbol: "¥", rateToKrw: null, platformFee: 10, paymentFee: 2 },
  ])[0];
  assert.equal(missingForeignRate.feeReady, true);
  assert.equal(missingForeignRate.exchangeRateReady, false);
  assert.equal(missingForeignRate.calculationReady, false);
  assert.equal(missingForeignRate.status, "환율 확인 필요");
  assert.equal(missingForeignRate.profit, 0);
  assert.equal(missingForeignRate.margin, 0);
  assert.equal(missingForeignRate.breakEvenPrice, 0);
  assert.equal(missingForeignRate.recommendedPrice, 0);

  const krwWithoutExternalRate = calculateMargins(form, feeOverrides(12), paymentFees, [
    { key: "elevenst" as const, currency: "KRW" as const, symbol: "₩", rateToKrw: 1, platformFee: null, paymentFee: 0, requiresManualFee: true },
  ])[0];
  assert.equal(krwWithoutExternalRate.exchangeRateReady, true);
  assert.equal(krwWithoutExternalRate.calculationReady, true);
  assert.equal(krwWithoutExternalRate.profit, 32_000);
  assert.equal(krwWithoutExternalRate.recommendedPrice, 87_800);
});

test("margin exchange-rate request times out and aborts a stalled fetch", async () => {
  let requestSignal: AbortSignal | undefined;
  const pending = fetchMarginReferenceRates({
    signal: new AbortController().signal,
    timeoutMs: 5,
    fetcher: async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return await new Promise<Response>(() => undefined);
    },
  });

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
  );
  assert.equal(requestSignal?.aborted, true);
  assert.equal(marginExchangeRateTimeoutMs, 12_000);
});

test("margin exchange-rate request propagates owner cancellation and parses a valid response", async () => {
  const owner = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const cancelled = fetchMarginReferenceRates({
    signal: owner.signal,
    fetcher: async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return await new Promise<Response>(() => undefined);
    },
  });
  owner.abort(new DOMException("화면 전환", "AbortError"));
  await assert.rejects(
    cancelled,
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(requestSignal?.aborted, true);

  const loaded = await fetchMarginReferenceRates({
    signal: new AbortController().signal,
    fetcher: async () => new Response(JSON.stringify({
      source: "Coinbase Data API",
      frequency: "minute-market",
      asOf: "2026-08-28T01:01:40.000Z",
      providerAsOf: "2026-08-28T01:01:40.000Z",
      fetchedAt: "2026-08-28T01:02:03.000Z",
      rates: [
        { code: "USD", unit: 1, value: 1_400 },
        { code: "JPY", unit: 100, value: 880 },
        { code: "SGD", unit: 1, value: 1_100 },
        { code: "MYR", unit: 1, value: 350 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(loaded.rates, { USD: 1_400, JPY: 8.8, SGD: 1_100, MYR: 350 });
  assert.match(loaded.basis, /Coinbase Data API · 60초 자동 조회 · 공급자 갱신/);
  assert.match(loaded.basis, /수신/);
  assert.equal(marginExchangeRateRefreshMs, 60_000);
});

test("margin exchange-rate lifecycle deduplicates interval requests and cancels unmounted work before state writes", async () => {
  const source = await readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8");
  const effectStart = source.indexOf("let active = true", source.indexOf("const rateRequestRef"));
  const duplicateFence = source.indexOf("if (rateRequestRef.current) return", effectStart);
  const requestStart = source.indexOf("const controller = new AbortController()", duplicateFence);
  const fetchStart = source.indexOf("fetchMarginReferenceRates({ signal: controller.signal })", requestStart);
  const activeFence = source.indexOf("if (!active || controller.signal.aborted) return", fetchStart);
  const stateWrite = source.indexOf("setReferenceRates(loaded.rates)", activeFence);
  const interval = source.indexOf("window.setInterval(() => void loadRates(), marginExchangeRateRefreshMs)", stateWrite);
  const cleanupStart = source.indexOf("return () =>", interval);
  const cleanupAbort = source.indexOf("rateRequestRef.current?.abort", cleanupStart);

  assert.ok(effectStart >= 0 && duplicateFence > effectStart && requestStart > duplicateFence && fetchStart > requestStart);
  assert.ok(activeFence > fetchStart && stateWrite > activeFence);
  assert.ok(interval > stateWrite && cleanupStart > interval && cleanupAbort > cleanupStart);
  assert.match(source, /window\.clearInterval\(interval\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(source, /실시간 환율 최초 수신 실패 · 해외 채널 계산 잠김/);
  assert.match(source, /최근 자동 갱신 실패\(직전 실수신값 유지\)/);
});
