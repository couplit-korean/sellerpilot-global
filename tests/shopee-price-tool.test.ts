import assert from "node:assert/strict";
import test from "node:test";
import { applyShopeePriceToDraft, quoteShopeePrice, shopeePriceMarkets, type ShopeePriceInput, type ShopeePriceSuccess } from "../lib/pricing/shopee-price-tool";

function success(input: Partial<ShopeePriceInput> = {}): ShopeePriceSuccess {
  const result = quoteShopeePrice({ market: "MY", service: "28050", zone: "A", weightGrams: 600, basePrice: 40, ...input });
  assert.equal(result.ok, true, result.ok ? undefined : `${result.code}: ${result.message}`);
  return result as ShopeePriceSuccess;
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }
function reject(input: Partial<ShopeePriceInput>, code: string) {
  const result = quoteShopeePrice({ market: "MY", service: "28050", zone: "A", weightGrams: 600, basePrice: 40, ...input });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code);
}

test("all seven markets use the real 600g current shipping rows and document fee order", () => {
  const samples = [
    ["TW", "38015", "ALL", 156.6, 70, 86.6, 2, 12.35],
    ["MX", "108005", "ALL", 249.6, 0, 249.6, 2, 15.35],
    ["TH", "78016", "A", 151.7, 22, 129.7, 3.21, 21.77],
    ["BR", "98002", "A", 95, 13, 82, 2, 13.35],
    ["VN", "58009", "A1", 84950, 15000, 69950, 4.91, 17],
    ["MY", "28050", "A", 17.7, 4.9, 12.8, 3.78, 16.58],
    ["PH", "48005", "A", 246, 40, 206, 2.4, 10.01],
  ] as const;
  assert.equal(shopeePriceMarkets.length, 7);
  for (const [market, service, zone, total, buyer, seller, pg, commission] of samples) {
    const q = success({ market, service, zone, basePrice: 100 });
    close(q.totalShipping, total); close(q.buyerShipping, buyer); close(q.sellerShipping, seller);
    const transaction = (100 + buyer) * pg / 100;
    const fee = (100 + seller + transaction) * commission / 100;
    close(q.transactionFee, transaction); close(q.commissionFee, fee);
    close(q.calculatedPrice, 100 + seller + transaction + fee);
    assert.ok(q.recommendedPrice >= q.calculatedPrice);
    assert.ok(q.sourceUrl.startsWith("https://docs.google.com/spreadsheets/"));
    assert.ok(q.sourceCells.includes(`${q.sourceSheet}!A${market === "MY" ? 66 : 65}`));
  }
});

test("MY uses actual seller cost instead of inverted PriceTool I/J and preserves default markup zero", () => {
  const q = success();
  close(q.sellerShipping, 12.8); assert.notEqual(q.sellerShipping, q.buyerShipping);
  close(q.calculatedPrice, 63.532859076); assert.equal(q.recommendedPrice, 63.54);
  const marked = success({ markupPercent: 30 });
  close(marked.calculatedPrice, q.calculatedPrice); assert.equal(marked.recommendedPrice, 82.60);
  assert.match(marked.notes.join(" "), /순이익률 보장/);
});

test("MY 800/810/1050/1060g separates rising buyer ESF from base-only PG basis", () => {
  for (const [weightGrams, total, buyer, seller] of [[800, 21.7, 4.9, 16.8], [810, 24.1, 7.1, 17], [1050, 28.9, 7.1, 21.8], [1060, 31.3, 9.3, 22]]) {
    const q = success({ weightGrams });
    close(q.totalShipping, total); close(q.buyerShipping, buyer); close(q.sellerShipping, seller);
    close(q.transactionFee, (40 + 4.9) * .0378);
  }
  const b = success({ zone: "B", weightGrams: 810 });
  close(b.totalShipping, 27.2); close(b.buyerShipping, 10.2); close(b.sellerShipping, 17);
  close(b.transactionFee, (40 + 8) * .0378);
});

test("BSC has distinct zone costs, free buyer shipping and exact 10kg cap", () => {
  for (const [zone, seller] of [["A", 15.3], ["B", 17.8], ["C", 17.8]] as const) {
    const q = success({ service: "28037", zone });
    close(q.totalShipping, seller); close(q.sellerShipping, seller); assert.equal(q.buyerShipping, 0);
    close(q.transactionFee, 40 * .0378);
  }
  close(success({ service: "28037", weightGrams: 10000 }).sellerShipping, 284.7);
  close(success({ service: "28037", zone: "C", weightGrams: 10000 }).sellerShipping, 287.2);
  reject({ service: "28037", weightGrams: 10010 }, "WEIGHT_OUT_OF_RANGE");
});

test("PH selects each correct gross column and retains common net, including D inference notice", () => {
  for (const [zone, total, buyer] of [["A", 246, 40], ["B", 266, 60], ["C", 286, 80], ["D", 286, 80]] as const) {
    const q = success({ market: "PH", service: "48005", zone });
    close(q.totalShipping, total); close(q.buyerShipping, buyer); close(q.sellerShipping, 206);
    assert.ok(q.sourceCells.includes(`${q.sourceSheet}!I65`));
    if (zone === "D") assert.match(q.notes.join(" "), /차이로 도출/);
  }
});

test("TW service buyer offsets reconcile against O and F&B cannot produce an applicable quote", () => {
  const rules = [["38015", 70, "I"], ["38016", 60, "J"], ["38026", 50, "K"], ["38065", 45, "L"], ["38070", 60, "M"]] as const;
  for (const [service, buyer, column] of rules) {
    const q = success({ market: "TW", service, zone: "ALL" });
    close(q.buyerShipping, buyer); close(q.sellerShipping, 86.6); close(q.totalShipping, buyer + 86.6);
    assert.ok(q.sourceCells.includes(`${q.sourceSheet}!${column}65`));
    assert.ok(q.sourceCells.includes(`${q.sourceSheet}!O65`));
  }
  assert.ok(shopeePriceMarkets.find((entry) => entry.market === "TW")?.services.some((entry) => entry.key === "38014"));
  reject({ market: "TW", service: "38014", zone: "ALL" }, "BUYER_SHIPPING_UNVERIFIED");
});

test("every advertised supported service/zone resolves a nonnegative balanced 600g quote", () => {
  for (const market of shopeePriceMarkets) for (const service of market.services) for (const zone of service.zones) {
    if (service.key === "38014") continue; // Intentionally exposed as unsupported above.
    const q = success({ market: market.market, service: service.key, zone });
    close(q.totalShipping, q.buyerShipping + q.sellerShipping);
    assert.ok(q.sellerShipping >= 0);
  }
});

test("source table maxima are accepted, extrapolation and absent SG data fail closed", () => {
  for (const [market, service, zone, limit] of [["TW", "38015", "ALL", 20000], ["MX", "108005", "ALL", 15000], ["TH", "78016", "A", 30000], ["BR", "98002", "A", 30000], ["VN", "58009", "A1", 30000], ["MY", "28050", "A", 30000], ["PH", "48005", "A", 30000]] as const) {
    success({ market, service, zone, weightGrams: limit });
    reject({ market, service, zone, weightGrams: limit + 10 }, "WEIGHT_OUT_OF_RANGE");
  }
  reject({ market: "SG" }, "UNSUPPORTED_MARKET");
  reject({ market: "" }, "UNSUPPORTED_MARKET");
  reject({ service: "" }, "UNSUPPORTED_SERVICE");
  reject({ zone: "" }, "UNSUPPORTED_ZONE");
});

test("missing, nonnumeric, NaN and nongrid values cannot become zero-fee quotes", () => {
  for (const weightGrams of [0, -10, 1, 599, 605, 600.1, NaN, Infinity, "", "600", null, undefined]) reject({ weightGrams: weightGrams as number }, "INVALID_WEIGHT");
  for (const basePrice of [0, -1, NaN, Infinity, "", "40", null, undefined]) reject({ basePrice: basePrice as number }, "INVALID_BASE_PRICE");
  for (const transactionPercent of [NaN, Infinity, -1, 101, "", null]) reject({ transactionPercent: transactionPercent as number }, "INVALID_PERCENT");
  for (const commissionPercent of [NaN, -1, 101, "", null]) reject({ commissionPercent: commissionPercent as number }, "INVALID_PERCENT");
  for (const markupPercent of [NaN, -1, Infinity, "", null]) reject({ markupPercent: markupPercent as number }, "INVALID_PERCENT");
  reject({ basePrice: Number.MAX_VALUE }, "INVALID_RESULT");
});

test("only final prices are rounded upward, with user fee overrides and no forced thirty percent", () => {
  const vn = success({ market: "VN", service: "58009", zone: "A1", basePrice: 250000 });
  close(vn.calculatedPrice, 389564.955); assert.equal(vn.recommendedPrice, 389565);
  const mx = success({ market: "MX", service: "108005", zone: "ALL", basePrice: 100 });
  close(mx.calculatedPrice, 405.5706); assert.equal(mx.recommendedPrice, 405.58);
  assert.match(mx.notes.join(" "), /Cosmetics channel 전용/);
  const zero = success({ basePrice: 10, transactionPercent: 0, commissionPercent: 0 });
  assert.equal(zero.transactionFee, 0); assert.equal(zero.commissionFee, 0); close(zero.calculatedPrice, 22.8); assert.equal(zero.recommendedPrice, 22.8);
});

test("draft application clones and changes only publish.item.original_price", () => {
  const draft = { market: "MY", currency: "USD", body: { original_price: 2.24, currency: "USD" }, global_item: { original_price: 2.24 }, publish: { shop_id: 123, item: { original_price: 10, stock: 10, item_name: "Narangd", logistic_info: [{ logistic_id: 28050, shipping_fee: 4.9, enabled: true }], images: ["immutable-image"] } }, sellerpilotAssets: { shipping: { shippingFeeKrw: 3000 } } };
  const before = structuredClone(draft);
  const q = success();
  const applied = applyShopeePriceToDraft(draft, q, { market: "MY", currency: "MYR" });
  const expected = structuredClone(before); expected.publish.item.original_price = q.recommendedPrice;
  assert.deepEqual(draft, before); assert.deepEqual(applied, expected); assert.notEqual(applied, draft); assert.notEqual(applied.publish, draft.publish);
  assert.notEqual((applied.publish as typeof draft.publish).item.logistic_info, draft.publish.item.logistic_info);
});

test("draft application rejects mismatched target, unsupported currency, malformed draft and invalid quote", () => {
  const draft = { publish: { item: { original_price: 10 } } };
  const q = success();
  for (const target of [{ market: "SG", currency: "SGD" }, { market: "TW", currency: "TWD" }, { market: "MY", currency: "USD" }]) assert.throws(() => applyShopeePriceToDraft(draft, q, target), /마켓·통화/);
  for (const recommendedPrice of [0, -1, NaN, Infinity, Number.MAX_VALUE, 1, 63.541]) assert.throws(() => applyShopeePriceToDraft(draft, { ...q, recommendedPrice }, { market: "MY", currency: "MYR" }), /현지 추천 판매가/);
  assert.throws(() => applyShopeePriceToDraft({}, q, { market: "MY", currency: "MYR" }), /publish.item/);
  assert.throws(() => applyShopeePriceToDraft({ publish: { item: [] } }, q, { market: "MY", currency: "MYR" }), /publish.item/);
  assert.throws(() => applyShopeePriceToDraft(draft, { ...q, ok: false } as unknown as ShopeePriceSuccess, { market: "MY", currency: "MYR" }), /마켓·통화/);
});

test("binary arithmetic at an exact cent boundary does not reject the calculator's own quote", () => {
  const q = success({ basePrice: .05, transactionPercent: 0, commissionPercent: 0 });
  assert.equal(q.recommendedPrice, 12.85);
  const applied = applyShopeePriceToDraft({ publish: { item: { original_price: 1 } } }, q, { market: "MY", currency: "MYR" });
  assert.equal((applied.publish as { item: { original_price: number } }).item.original_price, 12.85);
});
