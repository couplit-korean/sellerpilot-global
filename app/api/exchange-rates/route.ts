type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

const currencies = ["USD", "JPY", "SGD", "MYR"] as const;

export async function GET() {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 10);
  const fromDate = from.toISOString().slice(0, 10);
  const endpoint = new URL("https://api.frankfurter.dev/v2/rates");
  endpoint.searchParams.set("base", "KRW");
  endpoint.searchParams.set("quotes", currencies.join(","));
  endpoint.searchParams.set("from", fromDate);

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3_600 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Frankfurter ${response.status}`);

    const rows = await response.json() as FrankfurterRate[];
    if (!Array.isArray(rows)) throw new Error("Unexpected exchange-rate payload");

    const rates = currencies.map((code) => {
      const history = rows
        .filter((row) => row.base === "KRW" && row.quote === code && Number.isFinite(row.rate) && row.rate > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      const latest = history.at(-1);
      const previous = history.at(-2) ?? latest;
      if (!latest || !previous) throw new Error(`Missing ${code} rate`);

      const unit = code === "JPY" ? 100 : 1;
      const value = unit / latest.rate;
      const previousValue = unit / previous.rate;
      const change = previousValue ? ((value - previousValue) / previousValue) * 100 : 0;
      return {
        code,
        unit,
        value: Number(value.toFixed(2)),
        change: Number(change.toFixed(2)),
        asOf: latest.date,
      };
    });

    return Response.json({
      source: "Frankfurter v2",
      sourceUrl: "https://frankfurter.dev/",
      frequency: "daily-reference",
      asOf: rates.map((rate) => rate.asOf).sort().at(-1),
      rates,
    }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return Response.json({
      error: "기준 환율을 불러오지 못했습니다.",
      detail: error instanceof Error ? error.message : "unknown error",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
