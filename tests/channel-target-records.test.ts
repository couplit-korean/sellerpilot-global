import assert from "node:assert/strict";
import test from "node:test";
import { isCompleteChannelTarget, shopeeShopTargetIds, supportedShopeeTargets } from "../lib/channels/target-records";
import { shopeeMarkets } from "../lib/channels/markets";

test("Shopee cached targets must include a real shop and supported market metadata", () => {
  assert.equal(isCompleteChannelTarget("shopee", {
    targetId: "1719148844",
    displayName: "SellerPilot SG",
    marketCode: "SG",
    locale: "en-SG",
    language: "English",
    currency: "SGD",
  }), true);

  assert.equal(isCompleteChannelTarget("shopee", {
    targetId: "1719148844",
    displayName: "",
    marketCode: "",
    locale: "",
    language: "",
    currency: "",
  }), false);

  assert.equal(isCompleteChannelTarget("shopee", {
    targetId: "",
    displayName: "SellerPilot SG",
    marketCode: "SG",
    locale: "en-SG",
    language: "English",
    currency: "SGD",
  }), false);
});

test("Lazada cached targets accept the account fallback but reject unknown markets", () => {
  assert.equal(isCompleteChannelTarget("lazada", {
    targetId: "",
    displayName: "",
    marketCode: "MY",
    locale: "ms-MY",
    language: "Bahasa Melayu",
    currency: "MYR",
  }), true);

  assert.equal(isCompleteChannelTarget("lazada", {
    targetId: "seller",
    displayName: "Unknown",
    marketCode: "ZZ",
    locale: "en-ZZ",
    language: "English",
    currency: "USD",
  }), false);
});

test("Shopee target discovery keeps every authorized shop instead of only the primary shop", () => {
  assert.deepEqual(shopeeShopTargetIds({
    shop_id: "1001",
    shop_ids: [1001, 1002, "1003"],
    shopee_targets: [
      { type: "shop", id: 1002 },
      { type: "shop", id: "1004" },
      { type: "merchant", id: "9001" },
    ],
  }), ["1001", "1002", "1004", "1003"]);
});

test("Shopee target cache selects one supported target per market and ignores stale duplicates", () => {
  const targets = shopeeMarkets.map((market, index) => ({
    targetId: String(1000 + index),
    displayName: market.label,
    marketCode: market.code,
    locale: market.locale,
    language: market.language,
    currency: market.currency,
    verifiedAt: "2026-08-17T23:30:00.000Z",
  }));
  const normalized = supportedShopeeTargets([
    ...targets,
    { ...targets[0], targetId: "old-sg", verifiedAt: "2026-08-16T00:00:00.000Z" },
    { ...targets[0], targetId: "new-sg", verifiedAt: "2026-08-18T00:00:00.000Z" },
    { ...targets[0], targetId: "unsupported", marketCode: "ZZ", locale: "en-ZZ" },
  ]);
  assert.equal(normalized.length, 8);
  assert.equal(normalized.find((target) => target.marketCode === "SG")?.targetId, "new-sg");
  assert.equal(supportedShopeeTargets(targets.slice(0, -1)).length, 7);
});
