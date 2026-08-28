import { productCurrencies } from "../../../lib/product-intake";

type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

type CoinbaseExchangeRatePayload = {
  data?: {
    currency?: string;
    rates?: Record<string, string>;
  };
};

type ExchangeRateRow = {
  code: CurrencyCode;
  unit: number;
  value: number;
  change: number | null;
  asOf: string;
};

type DailyReferenceRate = ExchangeRateRow & {
  previousValue: number;
};

type ExchangeRateSnapshot = {
  source: string;
  sourceUrl: string;
  frequency: "minute-market" | "daily-reference-fallback";
  asOf: string;
  providerAsOf: string | null;
  fetchedAt: string;
  fallback: boolean;
  changeBasis: "latest-daily-reference" | "previous-daily-reference" | "unavailable";
  rates: ExchangeRateRow[];
};

type ExchangeRateFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type CurrencyCode = (typeof productCurrencies)[number];
type ProviderCurrencyCode = Exclude<CurrencyCode, "KRW">;

// Keep the snapshot aligned with every currency accepted by product intake.
// KRW is the identity row; providers are queried only for foreign currencies.
const currencies: readonly CurrencyCode[] = productCurrencies;
const providerCurrencies = productCurrencies.filter(
  (code): code is ProviderCurrencyCode => code !== "KRW",
);

const coinbaseEndpoint = "https://api.coinbase.com/v2/exchange-rates?currency=KRW";
const coinbaseDocumentationUrl = "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates";
const frankfurterDocumentationUrl = "https://frankfurter.dev/";
// Coinbase already exposes a current snapshot. Keep one cache boundary at the
// CDN response instead of stacking Next's data cache under the CDN cache.
const minuteMarketCdnSeconds = 55;
const dailyReferenceRevalidateSeconds = 3_600;
const providerTimeoutMs = 8_000;

function currencyUnit(code: CurrencyCode) {
  return code === "JPY" ? 100 : 1;
}

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function fixedRate(value: number) {
  return Number(value.toFixed(2));
}

function rateChange(value: number, referenceValue: number) {
  return referenceValue > 0
    ? Number((((value - referenceValue) / referenceValue) * 100).toFixed(2))
    : null;
}

function normalizedHttpDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function loadCoinbaseMarketRates(fetcher: ExchangeRateFetcher) {
  const response = await fetcher(coinbaseEndpoint, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(providerTimeoutMs),
  });
  if (!response.ok) throw new Error(`Coinbase ${response.status}`);

  const payload = await response.json() as CoinbaseExchangeRatePayload;
  if (payload.data?.currency !== "KRW" || !payload.data.rates) {
    throw new Error("Unexpected Coinbase exchange-rate payload");
  }
  const values = Object.fromEntries(currencies.map((code) => {
    if (code === "KRW") return [code, 1];
    const quotedPerKrw = finitePositive(payload.data?.rates?.[code]);
    if (quotedPerKrw === null) throw new Error(`Missing Coinbase ${code} rate`);
    return [code, fixedRate(currencyUnit(code) / quotedPerKrw)];
  })) as Record<CurrencyCode, number>;

  return {
    values,
    providerAsOf: normalizedHttpDate(response.headers.get("last-modified")),
  };
}

async function loadFrankfurterDailyRates(fetcher: ExchangeRateFetcher, now: Date) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 10);
  const endpoint = new URL("https://api.frankfurter.dev/v2/rates");
  endpoint.searchParams.set("base", "KRW");
  endpoint.searchParams.set("quotes", providerCurrencies.join(","));
  endpoint.searchParams.set("from", from.toISOString().slice(0, 10));

  const response = await fetcher(endpoint, {
    headers: { Accept: "application/json" },
    next: { revalidate: dailyReferenceRevalidateSeconds },
    signal: AbortSignal.timeout(providerTimeoutMs),
  });
  if (!response.ok) throw new Error(`Frankfurter ${response.status}`);

  const rows = await response.json() as FrankfurterRate[];
  if (!Array.isArray(rows)) throw new Error("Unexpected Frankfurter exchange-rate payload");

  const snapshotAsOf = rows
    .filter((row) => row.base === "KRW" && providerCurrencies.includes(row.quote as ProviderCurrencyCode))
    .map((row) => row.date)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!snapshotAsOf) throw new Error("Missing Frankfurter reference date");

  return currencies.map((code): DailyReferenceRate => {
    if (code === "KRW") {
      return {
        code,
        unit: 1,
        value: 1,
        previousValue: 1,
        change: 0,
        asOf: snapshotAsOf,
      };
    }
    const history = rows
      .filter((row) => row.base === "KRW" && row.quote === code && finitePositive(row.rate) !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
    const latest = history.at(-1);
    const previous = history.at(-2) ?? latest;
    if (!latest || !previous) throw new Error(`Missing Frankfurter ${code} rate`);
    const unit = currencyUnit(code);
    const value = fixedRate(unit / latest.rate);
    const previousValue = fixedRate(unit / previous.rate);
    return {
      code,
      unit,
      value,
      previousValue,
      change: rateChange(value, previousValue),
      asOf: latest.date,
    };
  });
}

async function loadExchangeRateSnapshot({
  fetcher = fetch,
  now = new Date(),
}: {
  fetcher?: ExchangeRateFetcher;
  now?: Date;
} = {}): Promise<ExchangeRateSnapshot> {
  const fetchedAt = now.toISOString();
  const [marketResult, dailyResult] = await Promise.allSettled([
    loadCoinbaseMarketRates(fetcher),
    loadFrankfurterDailyRates(fetcher, now),
  ]);

  if (marketResult.status === "fulfilled") {
    const dailyByCode = dailyResult.status === "fulfilled"
      ? new Map(dailyResult.value.map((rate) => [rate.code, rate]))
      : null;
    const asOf = marketResult.value.providerAsOf ?? fetchedAt;
    return {
      source: "Coinbase Data API",
      sourceUrl: coinbaseDocumentationUrl,
      frequency: "minute-market",
      asOf,
      providerAsOf: marketResult.value.providerAsOf,
      fetchedAt,
      fallback: false,
      changeBasis: dailyByCode ? "latest-daily-reference" : "unavailable",
      rates: currencies.map((code) => {
        const value = marketResult.value.values[code];
        const dailyReference = dailyByCode?.get(code);
        return {
          code,
          unit: currencyUnit(code),
          value,
          change: dailyReference ? rateChange(value, dailyReference.value) : null,
          asOf,
        };
      }),
    };
  }

  if (dailyResult.status === "fulfilled") {
    const asOf = dailyResult.value.map((rate) => rate.asOf).sort().at(-1) ?? fetchedAt;
    return {
      source: "Frankfurter v2 일일 기준환율",
      sourceUrl: frankfurterDocumentationUrl,
      frequency: "daily-reference-fallback",
      asOf,
      providerAsOf: null,
      fetchedAt,
      fallback: true,
      changeBasis: "previous-daily-reference",
      rates: dailyResult.value.map((rate) => ({
        code: rate.code,
        unit: rate.unit,
        value: rate.value,
        change: rate.change,
        asOf: rate.asOf,
      })),
    };
  }

  throw new AggregateError(
    [marketResult.reason, dailyResult.reason],
    "All exchange-rate providers failed",
  );
}

export async function GET() {
  try {
    const snapshot = await loadExchangeRateSnapshot();
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": `public, max-age=0, s-maxage=${minuteMarketCdnSeconds}`,
      },
    });
  } catch {
    return Response.json({
      error: "현재 환율과 일일 기준환율을 모두 불러오지 못했습니다.",
    }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
