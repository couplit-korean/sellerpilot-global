import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateMargins,
  fetchMarginReferenceRates,
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
  assert.equal(zero?.feeReady, false);
  assert.equal(entered?.feeReady, true);
  assert.equal(entered?.variableRate, 18);
  assert.equal(entered?.profit, 32_000);
  assert.equal(entered?.margin, 32);
  assert.equal(entered?.breakEvenPrice, 61_000);
  assert.equal(entered?.recommendedPrice, 87_800);
});

test("known-fee channel calculation is unchanged and manual UI fails closed", async () => {
  const qoo10 = calculateMargins(form, feeOverrides(null), paymentFees, profiles).find((result) => result.key === "qoo10");
  assert.equal(qoo10?.feeReady, true);
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
  assert.match(source, /selectedResult\.feeReady \? formatWon\(selectedResult\.profit\) : "계산 대기"/);
  assert.match(source, /selectedResult\.feeReady \? formatWon\(selectedResult\.recommendedPrice\) : "—"/);
  assert.match(source, /selectedResult\.feeReady \? <><div className="margin-stack-bar"/);
  assert.match(source, /disabled=\{!selectedResult\.feeReady \|\| !selectedResult\.recommendedPrice\}/);
  assert.match(source, /disabled=\{savingScenario \|\| !selectedResult\.feeReady\}/);
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
      source: "검증 기준환율",
      asOf: "2026-08-28",
      rates: [{ code: "JPY", unit: 100, value: 880 }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(loaded, {
    rates: { JPY: 8.8 },
    basis: "검증 기준환율 · 2026-08-28",
  });
});

test("margin exchange-rate lifecycle cancels prior and unmounted requests before state writes", async () => {
  const source = await readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8");
  const effectStart = source.indexOf("rateRequestRef.current?.abort");
  const requestStart = source.indexOf("const controller = new AbortController()", effectStart);
  const fetchStart = source.indexOf("fetchMarginReferenceRates({ signal: controller.signal })", requestStart);
  const activeFence = source.indexOf("if (!active || controller.signal.aborted) return", fetchStart);
  const stateWrite = source.indexOf("setReferenceRates(loaded.rates)", activeFence);
  const cleanupStart = source.indexOf("return () =>", stateWrite);
  const cleanupAbort = source.indexOf("controller.abort", cleanupStart);

  assert.ok(effectStart >= 0 && requestStart > effectStart && fetchStart > requestStart);
  assert.ok(activeFence > fetchStart && stateWrite > activeFence);
  assert.ok(cleanupStart > stateWrite && cleanupAbort > cleanupStart);
  assert.match(source, /if \(active && !controller\.signal\.aborted\) setRateBasis/);
  assert.match(source, /setRateBasis\("최근 기준환율 대체값 · API 재확인 필요"\)/);
});
