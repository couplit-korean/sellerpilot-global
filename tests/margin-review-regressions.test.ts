import assert from "node:assert/strict";
import test from "node:test";
import { editedProductSellingPriceKrw, evaluateProductMarginLossWarning, type ProductMarginScenarioLike } from "../lib/product-margin-loss-warning";
import { searchCompetitorProviders, knownCompetitorPriceComponent as known, lowestEligibleCompetitorPrice, type CompetitorPriceCandidate } from "../lib/competitor-prices";

test("product edit conversion and warning expire together, while KRW remains usable", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const instant = new Date(now).toISOString();
  const scenario: ProductMarginScenarioLike = { id: "fixture", productId: "product", channelKey: "ebay", createdAt: instant,
    inputs: { sellingPrice: 20000, purchaseCost: 10000, internationalShipping: 1000, localShipping: 500, fulfillmentCost: 500, fixedCost: 0,
      platformFee: 10, paymentFee: 2, taxRate: 1, adRate: 1, reserveRate: 1, currency: "USD", rateToKrw: 2000,
      rateEvidence: { fetchedAt: instant, asOf: instant, frequency: "minute-market" } }, result: { profit: 5000, margin: 25 } };
  for (const elapsed of [299999, 300000]) {
    const converted = editedProductSellingPriceKrw({ scenario, sellingPrice: 10, currency: "USD", now: now + elapsed });
    const evaluation = evaluateProductMarginLossWarning({ productId: "product", scenarios: [scenario], edit: { channelKey: "ebay", sellingPrice: converted }, now: now + elapsed });
    assert.equal(converted, elapsed < 300000 ? 20000 : null);
    assert.equal(evaluation.status, elapsed < 300000 ? "ready" : "unavailable");
    if (elapsed === 300000) assert.equal(evaluation.reason, "exchange-rate-expired");
  }
  for (const rateEvidence of [undefined, {}, { fetchedAt: 1, asOf: instant, frequency: "minute-market" }]) {
    const missing = { ...scenario, inputs: { ...scenario.inputs, rateEvidence } };
    assert.equal(editedProductSellingPriceKrw({ scenario: missing, sellingPrice: 10, currency: "USD", now }), null);
    assert.equal(evaluateProductMarginLossWarning({ productId: "product", scenarios: [missing], edit: { channelKey: "ebay" }, now }).reason, "exchange-rate-expired");
  }
  const domestic = { ...scenario, channelKey: "smartstore", inputs: { ...scenario.inputs, currency: "KRW", rateEvidence: null } };
  assert.equal(evaluateProductMarginLossWarning({ productId: "product", scenarios: [domestic], edit: { channelKey: "smartstore", sellingPrice: 19000 }, now: now + 300000 }).status, "ready");
});

for (const count of [4, 40]) {
  for (const exclusion of ["out_of_stock", "unknown", "stale", "missing_shipping"] as const) {
  test(`eligible lowest candidate survives ${count} matches with ${exclusion}`, async () => {
    const reference = { productName: "Review Widget", brand: "Review", gtins: ["8800000000003"] };
    const candidates: CompetitorPriceCandidate[] = Array.from({ length: count }, (_, index) => {
      const price = 10000 + index * 1000;
      return { provider: "naver_shopping", externalId: String(index), title: "Review Widget",
        url: `https://smartstore.naver.com/review/products/${index + 1}`, imageUrl: "", mallName: "fixture", marketplace: "smartstore",
        price, currency: "KRW", identity: reference,
        inventoryStatus: index === count - 1 || exclusion === "stale" || exclusion === "missing_shipping" ? "in_stock" : exclusion,
        observedAt: index !== count - 1 && exclusion === "stale" ? "2020-01-01T00:00:00Z" : new Date().toISOString(),
        priceComponents: { itemPrice: known(price, "KRW"), requiredOptionSurcharge: known(0, "KRW"),
          shipping: index !== count - 1 && exclusion === "missing_shipping" ? { status: "unknown", currency: "KRW" } : known(0, "KRW"),
          taxAndDuty: known(0, "KRW"), discount: known(0, "KRW") } };
    });
    const result = await searchCompetitorProviders({ configured: [{ id: "naver_shopping", marketplaces: ["smartstore"], search: async () => candidates }], unavailable: [] }, "Review Widget", [], 30, 0, { identity: reference });
    assert.equal(result.items.length, 3);
    assert.ok(result.sourceItems!.length <= 30);
    assert.equal(lowestEligibleCompetitorPrice(result.sourceItems!)?.externalId, String(count - 1));
    assert.equal(result.items[0].externalId, String(count - 1));
    assert.equal(result.items[0].totalPurchasePrice?.krwAmount, 10000 + (count - 1) * 1000);
  });
  }
}
