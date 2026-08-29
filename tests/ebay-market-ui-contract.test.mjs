import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedEbayMarkets = [
  ["EBAY_US", "US", "en-US", "USD"],
  ["EBAY_GB", "GB", "en-GB", "GBP"],
  ["EBAY_DE", "DE", "de-DE", "EUR"],
  ["EBAY_AU", "AU", "en-AU", "AUD"],
  ["EBAY_CA", "CA", "en-CA", "CAD"],
  ["EBAY_FR", "FR", "fr-FR", "EUR"],
  ["EBAY_IT", "IT", "it-IT", "EUR"],
  ["EBAY_ES", "ES", "es-ES", "EUR"],
  ["EBAY_AT", "AT", "de-AT", "EUR"],
  ["EBAY_BE", "BE", "nl-BE", "EUR"],
  ["EBAY_CH", "CH", "de-CH", "CHF"],
  ["EBAY_HK", "HK", "zh-HK", "HKD"],
  ["EBAY_IE", "IE", "en-IE", "EUR"],
  ["EBAY_NL", "NL", "nl-NL", "EUR"],
  ["EBAY_PL", "PL", "pl-PL", "PLN"],
];

function readTargetRows(source) {
  const start = source.indexOf("const ebayMarketplaceTargets");
  const end = source.indexOf("];", start);
  assert.ok(start >= 0 && end > start);
  return [...source.slice(start, end).matchAll(
    /targetId: "([A-Z_]+)"[^\n]+marketCode: "([A-Z]+)"[^\n]+locale: "([^"]+)"[^\n]+currency: "([A-Z]+)"/g,
  )].map((match) => match.slice(1));
}

test("publish and category workbenches expose the same 15 eBay markets", async () => {
  const [publish, category] = await Promise.all([
    readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/category-classification-workbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(readTargetRows(publish), expectedEbayMarkets);
  assert.deepEqual(readTargetRows(category), expectedEbayMarkets);
  assert.match(publish, /setCurrency\(nextTarget\.currency\)/);
  assert.match(category, /marketplaceId: target\?\.targetId \?\? "EBAY_US"/);
  assert.match(category, /bindEbayCategoryTree\(payload, target\?\.targetId \?\? ""\)/);
  assert.match(category, /ebayCategoryInspectionArguments\(selected\.id, currentState\.ebayCategoryTreeBinding, target\?\.targetId \?\? ""\)/);
  assert.doesNotMatch(category, /categoryTreeId: "0"/);
});
