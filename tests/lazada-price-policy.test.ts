import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLazadaKrwMyrPricePolicy,
  buildLazadaKrwMyrPricePolicy,
  lazadaMyrPriceFromKrw,
  loadAuthoritativeKrwPerMyr,
  type LazadaKrwMyrRateEvidence,
} from "../lib/channels/lazada-price-policy";

const NOW = new Date("2026-08-30T06:00:00.000Z");
const RATE: LazadaKrwMyrRateEvidence = {
  krwPerMyr: 350,
  fetchedAt: "2026-08-30T05:58:00.000Z",
  asOf: "2026-08-30T05:58:00.000Z",
  source: "Coinbase Data API",
  sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
  frequency: "minute-market",
};

function argumentsValue(targetPriceMyr = 14.29) {
  return {
    sellerpilotLazadaPricePolicy: {
      ...buildLazadaKrwMyrPricePolicy({ sourcePriceKrw: 5_000, rate: RATE }),
      targetPriceMyr,
    },
    request: {
      Request: {
        Product: {
          Skus: { Sku: [{ SellerSku: "QA-20260823-CC-001-MY", price: String(targetPriceMyr), quantity: "1" }] },
        },
      },
    },
  };
}

test("Lazada MY price policy rounds 5,000 KRW upward to an exact two-decimal MYR payload", () => {
  assert.equal(lazadaMyrPriceFromKrw(5_000, 350), 14.29);
  const verified = assertLazadaKrwMyrPricePolicy({
    argumentsValue: argumentsValue(),
    authoritativeRate: RATE,
    now: NOW,
  });
  assert.equal(verified.sourcePriceKrw, 5_000);
  assert.equal(verified.targetPriceMyr, 14.29);
  assert.equal(verified.targetCurrency, "MYR");
});

test("Lazada MY price policy rejects the legacy 12.9 USD / 58.05 MYR amount", () => {
  assert.throws(
    () => assertLazadaKrwMyrPricePolicy({
      argumentsValue: argumentsValue(58.05),
      authoritativeRate: RATE,
      now: NOW,
    }),
    /LAZADA_KRW_MYR_(?:DECLARED|AUTHORITATIVE)_RATE_MISMATCH/u,
  );
});

test("Lazada MY price policy rejects stale rate evidence", () => {
  const stale = argumentsValue();
  (stale.sellerpilotLazadaPricePolicy.rate as LazadaKrwMyrRateEvidence).fetchedAt = "2026-08-30T05:00:00.000Z";
  assert.throws(
    () => assertLazadaKrwMyrPricePolicy({ argumentsValue: stale, authoritativeRate: RATE, now: NOW }),
    /LAZADA_KRW_MYR_RATE_STALE/u,
  );
});

test("authoritative MYR rate uses the official unauthenticated KRW-base Coinbase contract", async () => {
  const calls: string[] = [];
  const loaded = await loadAuthoritativeKrwPerMyr({
    signal: new AbortController().signal,
    now: NOW,
    fetcher: async (input) => {
      calls.push(String(input));
      return Response.json({ data: { currency: "KRW", rates: { MYR: String(1 / 350) } } }, {
        headers: { "last-modified": "Sun, 30 Aug 2026 05:59:00 GMT" },
      });
    },
  });
  assert.deepEqual(calls, ["https://api.coinbase.com/v2/exchange-rates?currency=KRW"]);
  assert.equal(loaded.krwPerMyr, 350);
  assert.equal(loaded.asOf, "2026-08-30T05:59:00.000Z");
  assert.equal(loaded.source, "Coinbase Data API");
});
