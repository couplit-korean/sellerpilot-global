import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  fetchMarginReferenceRates,
  MarginCalculatorPage,
  marginExchangeRateRefreshMs,
  marginExchangeRateTimeoutMs,
} from "../app/margin-calculator";

test("margin calculator server render keeps all eight channel tabs and comparison rows", () => {
  const html = renderToStaticMarkup(createElement(MarginCalculatorPage, {
    notify: () => undefined,
    scenarios: [],
    scenarioState: "ready",
    scenarioMessage: null,
    products: [],
  }));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 8);
  assert.equal((html.match(/class="margin-channel-cell"/g) ?? []).length, 8);
  assert.match(html, /배송 · 고정비/);
  assert.match(html, /환율 확인 필요/);
  assert.doesNotMatch(html, /자동 등록 가능|자동 등록 판정/);
});

test("margin UI isolates per-channel shipping, explains exchange conversion and avoids registration claims", async () => {
  const [source, route] = await Promise.all([
    readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/snapshot/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /createChannelCostOverrides/);
  assert.match(source, /changeCostValue\("internationalShipping"/);
  assert.match(source, /매입 원가는 공통이고 배송·3PL·통관 비용은 현재 선택한 채널에만 적용/);
  assert.match(source, /현지 판매가 환산 후 1건 배분/);
  assert.match(source, /확인된 0%라면 0을 직접 입력/);
  assert.match(source, /engineVersion: MARGIN_ENGINE_VERSION/);
  assert.match(source, /productId: selectedProduct\.id/);
  assert.doesNotMatch(source, /자동 등록 가능|자동 등록 판정/);
  assert.match(route, /verifyMarginScenarioForSave/);
  assert.match(route, /p_inputs: verifiedInputs/);
  assert.match(route, /p_result: verifiedResult/);
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
    now: Date.parse("2026-08-28T01:02:03.000Z"),
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

test("margin exchange-rate parsing rejects duplicate currencies and invalid units instead of calculating with guessed rates", async () => {
  const responseFor = (rates: Array<{ code: string; unit: number; value: number }>) => async () => new Response(JSON.stringify({
    source: "synthetic provider",
    frequency: "minute-market",
    fetchedAt: "2026-08-28T01:02:03.000Z",
    rates,
  }), { status: 200, headers: { "content-type": "application/json" } });
  const validRates = [
    { code: "USD", unit: 1, value: 1_400 },
    { code: "JPY", unit: 100, value: 880 },
    { code: "SGD", unit: 1, value: 1_100 },
    { code: "MYR", unit: 1, value: 350 },
  ];

  await assert.rejects(fetchMarginReferenceRates({
    signal: new AbortController().signal,
    fetcher: responseFor([...validRates, { code: "USD", unit: 1, value: 1_401 }]),
  }), /중복 통화/);

  await assert.rejects(fetchMarginReferenceRates({
    signal: new AbortController().signal,
    fetcher: responseFor(validRates.map((rate) => rate.code === "JPY" ? { ...rate, unit: 0 } : rate)),
  }), /필수 기준환율이 누락/);
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
