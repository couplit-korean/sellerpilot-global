import assert from "node:assert/strict";
import test from "node:test";
import { calculateMargin, marginResultMatches, MARGIN_ENGINE_VERSION, type MarginEngineInput } from "../lib/pricing/margin-engine";
import { verifyMarginScenarioForSave } from "../lib/pricing/margin-save";
import {
  calculateChannelMargins,
  createChannelCostOverrides,
  createPaymentFeeOverrides,
  createPlatformFeeOverrides,
  marginChannelProfiles,
  roundLocalPriceUp,
} from "../lib/pricing/channel-margin";

const base: MarginEngineInput = {
  sellingPrice: 20_000,
  marketReferencePrice: null,
  purchaseCost: 10_000,
  internationalShipping: 0,
  localShipping: 0,
  fulfillmentCost: 0,
  fixedCost: 0,
  platformFee: 10,
  paymentFee: 0,
  taxRate: 0,
  adRate: 0,
  reserveRate: 0,
  targetMargin: 25,
};

test("calculates the current KRW baseline without inventing a market comparison", () => {
  const result = calculateMargin(base);
  assert.equal(result.engineVersion, MARGIN_ENGINE_VERSION);
  assert.equal(result.calculationStatus, "ready");
  assert.equal(result.profit, 8_000);
  assert.equal(result.margin, 40);
  assert.equal(result.breakEvenPrice, 11_200);
  assert.equal(result.recommendedPrice, 15_400);
  assert.equal(result.marketGapRate, null);
  assert.equal(result.marketStatus, "reference_missing");
});

test("returns an explicit unreachable result instead of a zero won recommendation", () => {
  const result = calculateMargin({ ...base, targetMargin: 95 });
  assert.equal(result.calculationStatus, "target_unreachable");
  assert.equal(result.recommendedPrice, null);
  assert.equal(result.marketGapRate, null);
});

test("keeps an unconfirmed fee distinct from a confirmed zero-percent fee", () => {
  assert.equal(calculateMargin({ ...base, platformFee: null }).calculationStatus, "fee_unconfirmed");
  const confirmedZero = calculateMargin({ ...base, platformFee: 0 });
  assert.equal(confirmedZero.calculationStatus, "ready");
  assert.equal(confirmedZero.profit, 10_000);
});

test("validates amounts and rates before calculating", () => {
  assert.equal(calculateMargin({ ...base, purchaseCost: -1 }).calculationStatus, "invalid_input");
  assert.equal(calculateMargin({ ...base, adRate: 90, reserveRate: 10 }).calculationStatus, "break_even_unreachable");
  assert.equal(calculateMargin({ ...base, sellingPrice: Number.NaN }).calculationStatus, "invalid_input");
});

test("channel calculation returns invalid state instead of throwing for a non-finite selling price", () => {
  const results = calculateChannelMargins(
    { ...base, sellingPrice: Number.NaN, marketReferencePrice: 0 },
    createPlatformFeeOverrides(),
    createPaymentFeeOverrides(),
    createChannelCostOverrides(),
    marginChannelProfiles,
  );
  assert.equal(results.length, 8);
  assert.equal(results.every((result) => result.calculationStatus === "invalid_input"), true);
  assert.equal(results.every((result) => result.calculationReady === false), true);
});

test("local price rounding keeps exact ticks and rounds fractional ticks upward", () => {
  assert.equal(roundLocalPriceUp(10, 0.01), 10);
  assert.equal(roundLocalPriceUp(10.001, 0.01), 10.01);
  assert.equal(roundLocalPriceUp(2_175, 10), 2_180);
});

test("uses absolute eight-percent tolerance only when a market reference exists", () => {
  assert.equal(calculateMargin({ ...base, marketReferencePrice: 15_000 }).marketStatus, "within_range");
  assert.equal(calculateMargin({ ...base, marketReferencePrice: 10_000 }).marketStatus, "recommended_above_market");
  assert.equal(calculateMargin({ ...base, marketReferencePrice: 20_000 }).marketStatus, "recommended_below_market");
});

test("server comparison rejects a client-modified result", () => {
  const result = calculateMargin(base);
  assert.equal(marginResultMatches(result, result as unknown as Record<string, unknown>), true);
  assert.equal(marginResultMatches(result, { ...result, profit: 99_999 }), false);
});

test("saved scenarios require a positive selling price and the server result", () => {
  const result = calculateMargin(base);
  assert.deepEqual(verifyMarginScenarioForSave({
    channelKey: "smartstore",
    engineInput: base,
    plannedSellingPriceKrw: 20_000,
    localSellingPrice: 20_000,
    localPriceIncrement: 10,
    currency: "KRW",
    rateToKrw: 1,
    suppliedResult: result,
  }), { ok: true, result });

  const zeroPriceInput = { ...base, sellingPrice: 0 };
  assert.deepEqual(verifyMarginScenarioForSave({
    channelKey: "smartstore",
    engineInput: zeroPriceInput,
    plannedSellingPriceKrw: 0,
    localSellingPrice: 0,
    localPriceIncrement: 10,
    currency: "KRW",
    rateToKrw: 1,
    suppliedResult: calculateMargin(zeroPriceInput),
  }), { ok: false, reason: "selling_price_required" });

  assert.deepEqual(verifyMarginScenarioForSave({
    channelKey: "smartstore",
    engineInput: base,
    plannedSellingPriceKrw: 20_000,
    localSellingPrice: 20_000,
    localPriceIncrement: 10,
    currency: "KRW",
    rateToKrw: 1,
    suppliedResult: { ...result, profit: (result.profit ?? 0) + 1 },
  }), { ok: false, reason: "result_mismatch" });
  assert.deepEqual(verifyMarginScenarioForSave({
    channelKey: "smartstore",
    engineInput: base,
    plannedSellingPriceKrw: 20_000,
    localSellingPrice: 20_000,
    localPriceIncrement: 10,
    currency: "KRW",
    rateToKrw: null,
    suppliedResult: result,
  }), { ok: false, reason: "channel_profile_mismatch" });
});

test("server save verification rejects a manipulated foreign-currency quote", () => {
  const overseasInput = { ...base, sellingPrice: 20_056 };
  const result = calculateMargin(overseasInput);
  const valid = {
    channelKey: "qoo10" as const,
    engineInput: overseasInput,
    plannedSellingPriceKrw: 20_000,
    localSellingPrice: 2_180,
    localPriceIncrement: 10,
    currency: "JPY" as const,
    rateToKrw: 9.2,
    suppliedResult: result,
  };
  assert.deepEqual(verifyMarginScenarioForSave(valid), { ok: true, result });
  assert.deepEqual(verifyMarginScenarioForSave({ ...valid, localSellingPrice: 2_170 }), {
    ok: false,
    reason: "exchange_conversion_mismatch",
  });
  assert.deepEqual(verifyMarginScenarioForSave({ ...valid, currency: "USD" }), {
    ok: false,
    reason: "channel_profile_mismatch",
  });
});
