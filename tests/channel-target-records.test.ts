import assert from "node:assert/strict";
import test from "node:test";
import { isCompleteChannelTarget } from "../lib/channels/target-records";

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
