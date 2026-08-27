import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateMargins } from "../app/margin-calculator";
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
