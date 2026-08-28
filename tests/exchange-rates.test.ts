import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GET } from "../app/api/exchange-rates/route";

const dailyRows = [
  { date: "2026-08-26", base: "KRW", quote: "USD", rate: 1 / 1_380 },
  { date: "2026-08-27", base: "KRW", quote: "USD", rate: 1 / 1_400 },
  { date: "2026-08-26", base: "KRW", quote: "JPY", rate: 100 / 920 },
  { date: "2026-08-27", base: "KRW", quote: "JPY", rate: 100 / 940 },
  { date: "2026-08-26", base: "KRW", quote: "SGD", rate: 1 / 1_080 },
  { date: "2026-08-27", base: "KRW", quote: "SGD", rate: 1 / 1_100 },
  { date: "2026-08-26", base: "KRW", quote: "MYR", rate: 1 / 330 },
  { date: "2026-08-27", base: "KRW", quote: "MYR", rate: 1 / 350 },
];

const marketPayload = {
  data: {
    currency: "KRW",
    rates: {
      USD: String(1 / 1_410),
      JPY: String(100 / 950),
      SGD: String(1 / 1_110),
      MYR: String(1 / 355),
    },
  },
};

function providerFetcher({ marketStatus = 200, dailyStatus = 200 } = {}) {
  const revalidations: number[] = [];
  const cacheModes: Array<{ provider: "coinbase" | "frankfurter"; cache: RequestCache | undefined }> = [];
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const revalidate = (init as RequestInit & { next?: { revalidate?: number } } | undefined)?.next?.revalidate;
    if (typeof revalidate === "number") revalidations.push(revalidate);
    const url = String(input);
    if (url.includes("api.coinbase.com")) {
      cacheModes.push({ provider: "coinbase", cache: init?.cache });
      return Response.json(marketPayload, {
        status: marketStatus,
        headers: { "last-modified": "Fri, 28 Aug 2026 01:01:40 GMT" },
      });
    }
    if (url.includes("api.frankfurter.dev")) {
      cacheModes.push({ provider: "frankfurter", cache: init?.cache });
      return Response.json(dailyRows, { status: dailyStatus });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetcher, revalidations, cacheModes };
}

async function requestSnapshot(fetcher: ReturnType<typeof providerFetcher>["fetcher"]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher as typeof fetch;
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    return {
      response,
      snapshot: await response.json() as {
        source: string;
        frequency: "minute-market" | "daily-reference-fallback";
        fallback: boolean;
        providerAsOf: string | null;
        fetchedAt: string;
        asOf: string;
        changeBasis: "latest-daily-reference" | "previous-daily-reference" | "unavailable";
        rates: Array<{ code: string; unit: number; value: number; change: number | null }>;
      },
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("minute exchange rates use the official keyless Coinbase response inside the one-minute refresh boundary", async () => {
  const { fetcher, revalidations, cacheModes } = providerFetcher();
  const { response, snapshot } = await requestSnapshot(fetcher);

  assert.equal(snapshot.source, "Coinbase Data API");
  assert.equal(snapshot.frequency, "minute-market");
  assert.equal(snapshot.fallback, false);
  assert.equal(snapshot.providerAsOf, "2026-08-28T01:01:40.000Z");
  assert.ok(!Number.isNaN(new Date(snapshot.fetchedAt).getTime()));
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=55");
  assert.equal(snapshot.changeBasis, "latest-daily-reference");
  assert.deepEqual(snapshot.rates.map(({ code, unit, value }) => ({ code, unit, value })), [
    { code: "USD", unit: 1, value: 1_410 },
    { code: "JPY", unit: 100, value: 950 },
    { code: "SGD", unit: 1, value: 1_110 },
    { code: "MYR", unit: 1, value: 355 },
  ]);
  assert.deepEqual(revalidations, [3_600]);
  assert.deepEqual(cacheModes, [
    { provider: "coinbase", cache: "no-store" },
    { provider: "frankfurter", cache: undefined },
  ]);
  assert.ok(snapshot.rates.every((rate) => typeof rate.change === "number"));
});

test("Coinbase failure falls back to the existing daily reference rates without claiming minute freshness", async () => {
  const { fetcher } = providerFetcher({ marketStatus: 503 });
  const { snapshot } = await requestSnapshot(fetcher);

  assert.equal(snapshot.frequency, "daily-reference-fallback");
  assert.equal(snapshot.fallback, true);
  assert.equal(snapshot.providerAsOf, null);
  assert.equal(snapshot.asOf, "2026-08-27");
  assert.equal(snapshot.changeBasis, "previous-daily-reference");
  assert.deepEqual(snapshot.rates.map(({ code, value }) => ({ code, value })), [
    { code: "USD", value: 1_400 },
    { code: "JPY", value: 940 },
    { code: "SGD", value: 1_100 },
    { code: "MYR", value: 350 },
  ]);
  assert.ok(snapshot.rates.every((rate) => typeof rate.change === "number"));
});

test("a valid minute response remains usable when the daily comparison provider is unavailable", async () => {
  const { fetcher } = providerFetcher({ dailyStatus: 503 });
  const { snapshot } = await requestSnapshot(fetcher);

  assert.equal(snapshot.frequency, "minute-market");
  assert.equal(snapshot.changeBasis, "unavailable");
  assert.ok(snapshot.rates.every((rate) => rate.change === null));
});

test("both exchange-rate UIs poll every minute with in-flight and unmount fences", async () => {
  const [page, margin, route, mobileCss] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/margin-calculator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/exchange-rates/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /cache: "no-store"/);
  assert.match(route, /s-maxage=\$\{minuteMarketCdnSeconds\}/);
  assert.doesNotMatch(route, /stale-while-revalidate/);
  assert.match(route, /daily-reference-fallback/);

  assert.match(page, /const dashboardExchangeRateRefreshMs = 60_000/);
  assert.match(page, /if \(exchangeRateRequestRef\.current\) return/);
  assert.match(page, /!exchangeRateMountedRef\.current \|\| controller\.signal\.aborted/);
  assert.match(page, /exchangeRateReceivedRef\.current = true/);
  assert.match(page, /현재 환율 최초 수신 실패 · 수치를 표시하지 않고 다시 조회 중/);
  assert.match(page, /최근 자동 갱신 실패\(직전 실수신값 유지\)/);
  assert.match(page, /exchangeRateRequestRef\.current\?\.abort/);
  assert.match(page, /window\.clearInterval\(interval\)/);
  assert.match(page, /document\.removeEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(page, /\{ code: "USD", unit: 1, value: null, change: null \}/);
  assert.match(page, /rate\.value === null \? "—"/);
  assert.doesNotMatch(page, /value: 1378\.4|value: 931\.12|value: 1072\.65|value: 325\.84/);

  assert.match(margin, /export const marginExchangeRateRefreshMs = 60_000/);
  assert.match(margin, /if \(rateRequestRef\.current\) return/);
  assert.match(margin, /if \(!active \|\| controller\.signal\.aborted\) return/);
  assert.match(margin, /rateReceivedRef\.current = true/);
  assert.match(margin, /실시간 환율 최초 수신 실패 · 해외 채널 계산 잠김/);
  assert.match(margin, /최근 자동 갱신 실패\(직전 실수신값 유지\)/);
  assert.match(margin, /rateRequestRef\.current\?\.abort/);
  assert.match(margin, /window\.clearInterval\(interval\)/);
  assert.match(margin, /document\.removeEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(margin, /rateToKrw: null/);
  assert.match(margin, /실시간 환율 수신 전 · 해외 채널 계산 잠김/);
  assert.doesNotMatch(margin, /rateToKrw: 8\.7789|rateToKrw: 1098\.9|rateToKrw: 344\.83|rateToKrw: 1388\.89/);

  assert.match(mobileCss, /\.exchange-title > small \{[\s\S]{0,180}overflow-wrap: anywhere;[\s\S]{0,100}white-space: normal;/);
});
