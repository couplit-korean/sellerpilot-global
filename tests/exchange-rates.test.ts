import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GET } from "../app/api/exchange-rates/route";
import { productCurrencies } from "../lib/product-intake";

type TestCurrencyCode = (typeof productCurrencies)[number];
type TestProviderCurrencyCode = Exclude<TestCurrencyCode, "KRW">;

const providerCurrencyCodes = productCurrencies.filter(
  (code): code is TestProviderCurrencyCode => code !== "KRW",
);
const previousKrwPerUnit: Record<TestCurrencyCode, number> = {
  KRW: 1, JPY: 9.2, USD: 1_380, SGD: 1_080, MYR: 330, PHP: 23.5, VND: 0.05,
  THB: 38, TWD: 41, BRL: 245, MXN: 70, IDR: 0.08, EUR: 1_500,
};
const latestKrwPerUnit: Record<TestCurrencyCode, number> = {
  KRW: 1, JPY: 9.4, USD: 1_400, SGD: 1_100, MYR: 350, PHP: 24, VND: 0.05,
  THB: 40, TWD: 43, BRL: 250, MXN: 72, IDR: 0.09, EUR: 1_520,
};
const marketKrwPerUnit: Record<TestCurrencyCode, number> = {
  KRW: 1, JPY: 9.5, USD: 1_410, SGD: 1_110, MYR: 355, PHP: 24.2, VND: 0.05,
  THB: 41, TWD: 44, BRL: 252, MXN: 73, IDR: 0.09, EUR: 1_530,
};

const dailyRows = providerCurrencyCodes.flatMap((quote) => [
  { date: "2026-08-26", base: "KRW", quote, rate: 1 / previousKrwPerUnit[quote] },
  { date: "2026-08-27", base: "KRW", quote, rate: 1 / latestKrwPerUnit[quote] },
]);

const marketPayload = {
  data: {
    currency: "KRW",
    rates: Object.fromEntries(providerCurrencyCodes.map((code) => [code, String(1 / marketKrwPerUnit[code])])),
  },
};

function expectedSnapshotRows(values: Record<TestCurrencyCode, number>) {
  return productCurrencies.map((code) => {
    const unit = code === "JPY" ? 100 : 1;
    return { code, unit, value: Number((unit * values[code]).toFixed(2)) };
  });
}

function providerFetcher({
  marketStatus = 200,
  dailyStatus = 200,
  omitMarketCurrency,
  omitDailyCurrency,
}: {
  marketStatus?: number;
  dailyStatus?: number;
  omitMarketCurrency?: TestProviderCurrencyCode;
  omitDailyCurrency?: TestProviderCurrencyCode;
} = {}) {
  const revalidations: number[] = [];
  const cacheModes: Array<{ provider: "coinbase" | "frankfurter"; cache: RequestCache | undefined }> = [];
  const dailyRequests: string[] = [];
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    const revalidate = (init as RequestInit & { next?: { revalidate?: number } } | undefined)?.next?.revalidate;
    if (typeof revalidate === "number") revalidations.push(revalidate);
    const url = String(input);
    if (url.includes("api.coinbase.com")) {
      cacheModes.push({ provider: "coinbase", cache: init?.cache });
      const rates = Object.fromEntries(Object.entries(marketPayload.data.rates)
        .filter(([code]) => code !== omitMarketCurrency));
      return Response.json({ data: { ...marketPayload.data, rates } }, {
        status: marketStatus,
        headers: { "last-modified": "Fri, 28 Aug 2026 01:01:40 GMT" },
      });
    }
    if (url.includes("api.frankfurter.dev")) {
      cacheModes.push({ provider: "frankfurter", cache: init?.cache });
      dailyRequests.push(url);
      return Response.json(dailyRows.filter((row) => row.quote !== omitDailyCurrency), { status: dailyStatus });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetcher, revalidations, cacheModes, dailyRequests };
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
  const { fetcher, revalidations, cacheModes, dailyRequests } = providerFetcher();
  const { response, snapshot } = await requestSnapshot(fetcher);

  assert.equal(snapshot.source, "Coinbase Data API");
  assert.equal(snapshot.frequency, "minute-market");
  assert.equal(snapshot.fallback, false);
  assert.equal(snapshot.providerAsOf, "2026-08-28T01:01:40.000Z");
  assert.ok(!Number.isNaN(new Date(snapshot.fetchedAt).getTime()));
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=55");
  assert.equal(snapshot.changeBasis, "latest-daily-reference");
  assert.deepEqual(snapshot.rates.map(({ code, unit, value }) => ({ code, unit, value })), expectedSnapshotRows(marketKrwPerUnit));
  assert.deepEqual(new URL(dailyRequests[0]).searchParams.get("quotes")?.split(","), providerCurrencyCodes);
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
  assert.deepEqual(
    snapshot.rates.map(({ code, unit, value }) => ({ code, unit, value })),
    expectedSnapshotRows(latestKrwPerUnit),
  );
  assert.ok(snapshot.rates.every((rate) => typeof rate.change === "number"));
});

test("a partial current provider response never invents a missing market rate", async () => {
  const { fetcher } = providerFetcher({ omitMarketCurrency: "EUR" });
  const { snapshot } = await requestSnapshot(fetcher);

  assert.equal(snapshot.frequency, "daily-reference-fallback");
  assert.equal(snapshot.fallback, true);
  assert.deepEqual(
    snapshot.rates.map(({ code, unit, value }) => ({ code, unit, value })),
    expectedSnapshotRows(latestKrwPerUnit),
  );
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
  assert.match(page, /const dashboardRates = rates\.filter\(\(rate\) => dashboardExchangeRateCodes\.has\(rate\.code\)\)/);
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
