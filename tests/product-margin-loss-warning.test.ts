import assert from "node:assert/strict";
import test from "node:test";
import {
  editedProductSellingPriceKrw,
  evaluateProductMarginLossWarning,
  evaluateProductMarginLossWarnings,
  productMarginListingChannelKeys,
  type ProductMarginScenarioLike,
} from "../lib/product-margin-loss-warning.ts";

function scenario({
  id = "scenario-1",
  productId = "product-a",
  channelKey = "qoo10",
  createdAt = "2026-08-28T00:00:00.000Z",
  inputOverrides = {},
  resultOverrides = {},
}: {
  id?: string;
  productId?: string | null;
  channelKey?: string;
  createdAt?: string;
  inputOverrides?: Record<string, unknown>;
  resultOverrides?: Record<string, unknown>;
} = {}): ProductMarginScenarioLike {
  return {
    id,
    productId,
    channelKey,
    createdAt,
    inputs: {
      sellingPrice: 20_000,
      purchaseCost: 10_000,
      internationalShipping: 1_000,
      localShipping: 500,
      fulfillmentCost: 500,
      fixedCost: 0,
      platformFee: 10,
      paymentFee: 2,
      taxRate: 1,
      adRate: 1,
      reserveRate: 1,
      ...inputOverrides,
    },
    result: { profit: 5_000, margin: 25, ...resultOverrides },
  };
}

test("warns about a channel-specific loss against the latest matching product baseline", () => {
  const evaluation = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [
      scenario({ id: "other-product", productId: "product-b", createdAt: "2026-08-29T00:00:00.000Z" }),
      scenario({ id: "legacy", productId: null, createdAt: "2026-08-30T00:00:00.000Z" }),
      scenario({ id: "older", createdAt: "2026-08-27T00:00:00.000Z" }),
      scenario({ id: "latest", createdAt: "2026-08-28T00:00:00.000Z" }),
    ],
    edit: { channelKey: "qoo10", sellingPrice: 19_000 },
  });

  assert.equal(evaluation.status, "ready");
  if (evaluation.status !== "ready") return;
  assert.equal(evaluation.scenarioId, "latest");
  assert.equal(evaluation.warning?.kind, "loss");
  assert.equal(evaluation.warning?.channelKey, "qoo10");
  assert.equal(evaluation.edited.profit, 4_150);
  assert.equal(evaluation.warning?.profitLossKrw, 850);
  assert.ok((evaluation.warning?.marginLossPercentPoints ?? 0) > 3);
});

test("negative margin takes precedence when edited shipping or fees exceed the sale", () => {
  const evaluation = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario()],
    edit: { channelKey: "qoo10", localShipping: 10_000, platformFee: 20 },
  });

  assert.equal(evaluation.status, "ready");
  if (evaluation.status !== "ready") return;
  assert.equal(evaluation.warning?.kind, "negative-margin");
  assert.equal(evaluation.edited.profit, -6_500);
  assert.equal(evaluation.edited.margin, -32.5);
});

test("keeps evaluations isolated by product and channel", () => {
  const evaluations = evaluateProductMarginLossWarnings({
    productId: "product-a",
    scenarios: [
      scenario({ id: "qoo10-baseline" }),
      scenario({
        id: "shopee-baseline",
        channelKey: "shopee",
        inputOverrides: { platformFee: 12 },
        resultOverrides: { profit: 4_600, margin: 23 },
      }),
    ],
    edits: [
      { channelKey: "qoo10", sellingPrice: 19_000 },
      { channelKey: "shopee", sellingPrice: 19_000 },
      { channelKey: "lazada", sellingPrice: 19_000 },
    ],
  });

  assert.deepEqual(evaluations.map((item) => item.channelKey), ["qoo10", "shopee", "lazada"]);
  assert.equal(evaluations[0]?.scenarioId, "qoo10-baseline");
  assert.equal(evaluations[1]?.scenarioId, "shopee-baseline");
  assert.equal(evaluations[2]?.status, "unavailable");
  assert.equal(evaluations[2]?.reason, "missing-baseline");
});

test("evaluates every listed product channel when complete latest coverage returns zero scenarios", () => {
  const channelKeys = productMarginListingChannelKeys({
    supportedChannels: [
      { key: "qoo10", code: "Q" },
      { key: "shopee", code: "S" },
      { key: "lazada", code: "L" },
      { key: "coupang", code: "C" },
    ],
    listingChannelKeys: ["lazada", "qoo10", "lazada", "unsupported"],
    listingChannelCodes: ["S", "unknown"],
  });
  const evaluations = evaluateProductMarginLossWarnings({
    productId: "product-a",
    scenarios: [],
    edits: channelKeys.map((channelKey) => ({
      channelKey,
      sellingPrice: 19_000,
      localShipping: 700,
    })),
  });

  assert.deepEqual(channelKeys, ["qoo10", "shopee", "lazada"]);
  assert.deepEqual(evaluations.map((evaluation) => evaluation.channelKey), channelKeys);
  assert.deepEqual(evaluations.map((evaluation) => evaluation.status), ["unavailable", "unavailable", "unavailable"]);
  assert.deepEqual(evaluations.map((evaluation) => evaluation.reason), ["missing-baseline", "missing-baseline", "missing-baseline"]);
  assert.ok(evaluations.every((evaluation) => evaluation.warning === null));
});

test("does not invent a known channel fee when the saved scenario omits one", () => {
  const evaluation = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario({ inputOverrides: { platformFee: undefined } })],
    edit: { channelKey: "qoo10", sellingPrice: 19_000 },
  });

  assert.equal(evaluation.status, "unavailable");
  assert.equal(evaluation.reason, "missing-or-invalid-fees");
  assert.equal(evaluation.warning, null);
});

test("fails closed for inconsistent saved results instead of comparing against a false baseline", () => {
  const evaluation = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario({ resultOverrides: { profit: 9_999 } })],
    edit: { channelKey: "qoo10", localShipping: 600 },
  });

  assert.equal(evaluation.status, "unavailable");
  assert.equal(evaluation.reason, "inconsistent-baseline");
});

test("returns no warning when edits preserve or improve the saved margin", () => {
  const unchanged = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario()],
    edit: { channelKey: "qoo10" },
  });
  const improved = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario()],
    edit: { channelKey: "qoo10", sellingPrice: 22_000 },
  });

  assert.equal(unchanged.warning, null);
  assert.equal(improved.warning, null);
});

test("rejects null and non-finite edited values", () => {
  const nullFee = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario()],
    edit: { channelKey: "qoo10", paymentFee: null },
  });
  const infinitePrice = evaluateProductMarginLossWarning({
    productId: "product-a",
    scenarios: [scenario()],
    edit: { channelKey: "qoo10", sellingPrice: Number.POSITIVE_INFINITY },
  });

  assert.equal(nullFee.reason, "invalid-edit");
  assert.equal(infinitePrice.reason, "invalid-edit");
});

test("converts a foreign edit only with the matching saved exchange-rate lineage", () => {
  const usdScenario = scenario({ inputOverrides: { currency: "USD", rateToKrw: 1_300 } });

  assert.equal(editedProductSellingPriceKrw({ scenario: usdScenario, sellingPrice: 10, currency: "USD" }), 13_000);
  assert.equal(editedProductSellingPriceKrw({ scenario: usdScenario, sellingPrice: 10, currency: "JPY" }), null);
  assert.equal(editedProductSellingPriceKrw({ scenario: null, sellingPrice: 10, currency: "USD" }), null);
  assert.equal(editedProductSellingPriceKrw({ scenario: null, sellingPrice: 19_000, currency: "KRW" }), 19_000);
});
