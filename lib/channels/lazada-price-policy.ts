type UnknownRecord = Record<string, unknown>;

export const lazadaKrwMyrPricePolicyContract =
  "lazada_krw_myr_reference_price_v1" as const;

export type LazadaKrwMyrRateEvidence = {
  krwPerMyr: number;
  fetchedAt: string;
  asOf: string;
  source: string;
  sourceUrl: string;
  frequency: "minute-market" | "daily-reference-fallback";
};

export type LazadaKrwMyrPricePolicy = {
  contract: typeof lazadaKrwMyrPricePolicyContract;
  sourceCurrency: "KRW";
  sourcePriceKrw: number;
  targetCurrency: "MYR";
  targetPriceMyr: number;
  rate: LazadaKrwMyrRateEvidence;
};

const coinbaseExchangeRateEndpoint =
  "https://api.coinbase.com/v2/exchange-rates?currency=KRW";
export const coinbaseExchangeRateDocumentationUrl =
  "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates";

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function exactIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function lazadaMyrPriceFromKrw(sourcePriceKrw: number, krwPerMyr: number) {
  if (!Number.isFinite(sourcePriceKrw) || sourcePriceKrw <= 0
      || !Number.isFinite(krwPerMyr) || krwPerMyr <= 0) return null;
  return Math.ceil((sourcePriceKrw / krwPerMyr) * 100) / 100;
}

export function buildLazadaKrwMyrPricePolicy(input: {
  sourcePriceKrw: number;
  rate: LazadaKrwMyrRateEvidence;
}): LazadaKrwMyrPricePolicy | null {
  const targetPriceMyr = lazadaMyrPriceFromKrw(input.sourcePriceKrw, input.rate.krwPerMyr);
  if (targetPriceMyr === null
      || !exactIsoDate(input.rate.fetchedAt)
      || !exactIsoDate(input.rate.asOf)
      || !input.rate.source.trim()
      || !input.rate.sourceUrl.startsWith("https://")
      || !["minute-market", "daily-reference-fallback"].includes(input.rate.frequency)) return null;
  return {
    contract: lazadaKrwMyrPricePolicyContract,
    sourceCurrency: "KRW",
    sourcePriceKrw: input.sourcePriceKrw,
    targetCurrency: "MYR",
    targetPriceMyr,
    rate: structuredClone(input.rate),
  };
}

export function lazadaKrwMyrPricePolicyFromArguments(argumentsValue: UnknownRecord) {
  const source = recordValue(argumentsValue.sellerpilotLazadaPricePolicy);
  const rate = recordValue(source.rate);
  if (source.contract !== lazadaKrwMyrPricePolicyContract
      || source.sourceCurrency !== "KRW"
      || source.targetCurrency !== "MYR") return null;
  const sourcePriceKrw = finitePositive(source.sourcePriceKrw);
  const targetPriceMyr = finitePositive(source.targetPriceMyr);
  const krwPerMyr = finitePositive(rate.krwPerMyr);
  const fetchedAt = exactIsoDate(rate.fetchedAt);
  const asOf = exactIsoDate(rate.asOf);
  const frequency = rate.frequency === "minute-market" || rate.frequency === "daily-reference-fallback"
    ? rate.frequency
    : null;
  const rateSource = typeof rate.source === "string" ? rate.source.trim() : "";
  const sourceUrl = typeof rate.sourceUrl === "string" ? rate.sourceUrl.trim() : "";
  if (sourcePriceKrw === null || targetPriceMyr === null || krwPerMyr === null
      || !fetchedAt || !asOf || !frequency || !rateSource || !sourceUrl.startsWith("https://")) return null;
  return {
    contract: lazadaKrwMyrPricePolicyContract,
    sourceCurrency: "KRW" as const,
    sourcePriceKrw,
    targetCurrency: "MYR" as const,
    targetPriceMyr,
    rate: { krwPerMyr, fetchedAt, asOf, source: rateSource, sourceUrl, frequency },
  };
}

/**
 * Uses the same current, unauthenticated Coinbase Data API contract as the
 * SellerPilot exchange-rate screen. One MYR is the reciprocal of the MYR rate
 * returned for a KRW base currency.
 */
export async function loadAuthoritativeKrwPerMyr(input: {
  signal: AbortSignal;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<LazadaKrwMyrRateEvidence> {
  const fetcher = input.fetcher ?? fetch;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(8_000)]);
  const response = await fetcher(coinbaseExchangeRateEndpoint, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const payload = recordValue(await response.json().catch(() => null));
  const data = recordValue(payload.data);
  const rates = recordValue(data.rates);
  const myrPerKrw = finitePositive(rates.MYR);
  if (!response.ok || data.currency !== "KRW" || myrPerKrw === null) {
    throw new Error("LAZADA_KRW_MYR_RATE_UNAVAILABLE");
  }
  const now = input.now ?? new Date();
  const fetchedAt = now.toISOString();
  const providerAsOf = exactIsoDate(response.headers.get("last-modified")) ?? fetchedAt;
  return {
    krwPerMyr: Number((1 / myrPerKrw).toFixed(6)),
    fetchedAt,
    asOf: providerAsOf,
    source: "Coinbase Data API",
    sourceUrl: coinbaseExchangeRateDocumentationUrl,
    frequency: "minute-market",
  };
}

function requestedLazadaSkuPrice(argumentsValue: UnknownRecord) {
  const request = recordValue(argumentsValue.request);
  const requestRoot = recordValue(request.Request);
  const product = recordValue(requestRoot.Product);
  const skus = recordValue(product.Skus);
  const rows = Array.isArray(skus.Sku) ? skus.Sku.map(recordValue) : [];
  if (rows.length !== 1) return null;
  return finitePositive(rows[0].price ?? rows[0].Price);
}

export function assertLazadaKrwMyrPricePolicy(input: {
  argumentsValue: UnknownRecord;
  authoritativeRate: LazadaKrwMyrRateEvidence;
  now?: Date;
}) {
  const policy = lazadaKrwMyrPricePolicyFromArguments(input.argumentsValue);
  if (!policy) throw new Error("LAZADA_KRW_MYR_PRICE_POLICY_REQUIRED");
  const requestedPrice = requestedLazadaSkuPrice(input.argumentsValue);
  if (requestedPrice === null
      || Math.abs(requestedPrice - policy.targetPriceMyr) > 0.000_001) {
    throw new Error("LAZADA_KRW_MYR_TARGET_PRICE_MISMATCH");
  }
  const nowMs = (input.now ?? new Date()).getTime();
  const fetchedAtMs = new Date(policy.rate.fetchedAt).getTime();
  const maximumAgeMs = policy.rate.frequency === "minute-market"
    ? 10 * 60 * 1_000
    : 36 * 60 * 60 * 1_000;
  if (fetchedAtMs > nowMs + 60_000 || nowMs - fetchedAtMs > maximumAgeMs) {
    throw new Error("LAZADA_KRW_MYR_RATE_STALE");
  }
  const declaredTarget = lazadaMyrPriceFromKrw(policy.sourcePriceKrw, policy.rate.krwPerMyr);
  if (declaredTarget === null || Math.abs(declaredTarget - policy.targetPriceMyr) > 0.000_001) {
    throw new Error("LAZADA_KRW_MYR_DECLARED_RATE_MISMATCH");
  }
  const authoritativeKrwValue = policy.targetPriceMyr * input.authoritativeRate.krwPerMyr;
  const allowedKrwDrift = Math.max(1, policy.sourcePriceKrw * 0.01);
  if (Math.abs(authoritativeKrwValue - policy.sourcePriceKrw) > allowedKrwDrift) {
    throw new Error("LAZADA_KRW_MYR_AUTHORITATIVE_RATE_MISMATCH");
  }
  return policy;
}
