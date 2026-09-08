import assert from "node:assert/strict";
import test from "node:test";
import { marginRateIsFresh } from "../lib/pricing/margin-rate-freshness";
import { requestMarginMutation, MarginMutationUncertain } from "../lib/pricing/margin-mutation";
import { calculateChannelMargins, createPlatformFeeOverrides, createPaymentFeeOverrides, createChannelCostOverrides, marginChannelProfiles } from "../lib/pricing/channel-margin";
import { verifyMarginScenarioForSave } from "../lib/pricing/margin-save";
import { fetchMarginReferenceRates } from "../app/margin-calculator";
const now = Date.parse("2026-09-08T12:00:00Z");
const evidence = { fetchedAt: new Date(now).toISOString(), asOf: new Date(now).toISOString(), frequency: "minute-market" as const };

test("rates expire at five minutes and reject future, malformed and missing evidence", () => {
  assert.equal(marginRateIsFresh(evidence, now + 299_999), true);
  assert.equal(marginRateIsFresh(evidence, now + 300_000), false);
  assert.equal(marginRateIsFresh(evidence, now - 60_001), false);
  assert.equal(marginRateIsFresh(null, now), false);
  assert.equal(marginRateIsFresh({ ...evidence, asOf: "bad" }, now), false);
  const daily = { ...evidence, frequency: "daily-reference-fallback" as const, asOf: "2026-09-05" };
  assert.equal(marginRateIsFresh(daily, now), true);
  assert.equal(marginRateIsFresh({ ...daily, asOf: "2026-09-04" }, now), false);
});

test("stale API payload never unlocks foreign calculations", async () => {
  await assert.rejects(fetchMarginReferenceRates({ signal: new AbortController().signal, now,
    fetcher: async () => Response.json({ ...evidence, asOf: "2000-01-01", rates: [
      { code: "USD", unit: 1, value: 1400 }, { code: "JPY", unit: 100, value: 880 },
      { code: "SGD", unit: 1, value: 1100 }, { code: "MYR", unit: 1, value: 350 },
    ] }),
  }), /유효기간/);
});

const form = { sellingPrice: 50000, marketReferencePrice: 50000, purchaseCost: 20000, taxRate: 0, adRate: 0, reserveRate: 0, targetMargin: 25 };
test("missing FX clears profitability and market comparisons, while domestic remains usable", () => {
  const results = calculateChannelMargins(form, createPlatformFeeOverrides(), createPaymentFeeOverrides(), createChannelCostOverrides(), marginChannelProfiles);
  for (const result of results.filter(r => r.currency !== "KRW")) {
    assert.equal(result.profitabilityStatus, "unavailable");
    assert.equal(result.marketStatus, "unavailable");
    assert.equal(result.margin, null);
    assert.equal(result.marketGapRate, null);
  }
  assert.equal(results.find(r => r.key === "smartstore")?.calculationReady, true);
});

test("server rejects expired or omitted FX evidence even when arithmetic matches", () => {
  const result = calculateChannelMargins(form, createPlatformFeeOverrides(), createPaymentFeeOverrides(), createChannelCostOverrides(), marginChannelProfiles.map(p => ({ ...p, rateToKrw: p.currency === "KRW" ? 1 : 9 })))[0];
  const input = { channelKey: result.key, engineInput: result.engineInput, plannedSellingPriceKrw: form.sellingPrice, localSellingPrice: result.localSellingPrice, localPriceIncrement: result.localPriceIncrement, currency: result.currency, rateToKrw: result.rateToKrw, suppliedResult: result, rateEvidence: evidence, now };
  assert.equal(verifyMarginScenarioForSave(input).ok, true);
  assert.deepEqual(verifyMarginScenarioForSave({ ...input, now: now + 300000 }), { ok: false, reason: "exchange_rate_expired" });
  assert.equal(verifyMarginScenarioForSave({ ...input, rateEvidence: null }).ok, false);
});

test("hanging auth times out before any mutation can be sent, including late auth completion", async () => {
  let complete!: (token: string) => void;
  let calls = 0;
  await assert.rejects(requestMarginMutation({ body: { action: "margin_save" }, timeoutMs: 5,
    getAccessToken: () => new Promise(resolve => { complete = resolve; }),
    fetcher: async () => { calls++; return Response.json({ id: "test" }); },
  }), /로그인 확인 시간/);
  complete("synthetic-token");
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(calls, 0);
});

for (const action of ["margin_save", "margin_delete"]) {
  test(`${action} times out once with unknown outcome and never retries`, async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    await assert.rejects(requestMarginMutation({ body: { action }, timeoutMs: 5, getAccessToken: async () => "synthetic-token",
      fetcher: async (_url, init) => { calls++; signal = init?.signal; return new Promise<Response>(() => {}); },
    }), MarginMutationUncertain);
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
  });
}

test("stalled response body and missing save receipt remain uncertain; successful receipt is preserved", async () => {
  for (const response of [new Response(new ReadableStream({ start() {} })), Response.json({})]) {
    await assert.rejects(requestMarginMutation({ body: { action: "margin_save" }, timeoutMs: 5, getAccessToken: async () => "synthetic-token", fetcher: async () => response }), MarginMutationUncertain);
  }
  assert.deepEqual(await requestMarginMutation({ body: { action: "margin_save" }, getAccessToken: async () => "synthetic-token", fetcher: async () => Response.json({ id: "receipt" }) }), { id: "receipt" });
});
