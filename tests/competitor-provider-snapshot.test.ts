import assert from "node:assert/strict";
import test from "node:test";
import {
  competitorMarketplaceProviderState,
  parseCompetitorProviderSnapshot,
  savedCompetitorPriceState,
  validCompetitorProviderFetchedAt,
} from "../lib/competitor-provider-snapshot.ts";

const searched = {
  provider: "elevenst_product_search",
  status: "searched",
  count: 0,
  marketplaces: ["elevenst"],
} as const;
const failed = {
  provider: "ebay_browse",
  status: "failed",
  count: 0,
  marketplaces: ["ebay"],
} as const;

test("saved provider state distinguishes searched-with-no-match from provider failure", () => {
  const fetchedAt = "2026-08-28T12:00:00.000Z";
  assert.equal(savedCompetitorPriceState(parseCompetitorProviderSnapshot([searched]), fetchedAt), "ready");
  assert.equal(savedCompetitorPriceState(parseCompetitorProviderSnapshot([failed]), fetchedAt), "unavailable");
  assert.equal(savedCompetitorPriceState([], null), "unavailable");
});

test("pending and malformed provider snapshots never masquerade as a completed search", () => {
  assert.equal(savedCompetitorPriceState(parseCompetitorProviderSnapshot([{
    provider: "brave_marketplace_web",
    status: "pending",
    count: 0,
    marketplaces: ["shopee", "lazada", "temu"],
  }]), "2026-08-28T12:00:00.000Z"), "loading");
  assert.deepEqual(parseCompetitorProviderSnapshot([{ ...failed, count: 1 }]), []);
  assert.deepEqual(parseCompetitorProviderSnapshot([searched, searched]), []);
  assert.deepEqual(parseCompetitorProviderSnapshot([{ ...searched, marketplaces: ["unknown"] }]), []);
});

test("provider snapshot timestamps are validated before driving saved UI state", () => {
  assert.equal(validCompetitorProviderFetchedAt("2026-08-28T12:00:00.000Z"), "2026-08-28T12:00:00.000Z");
  assert.equal(validCompetitorProviderFetchedAt("not-a-date"), null);
  assert.equal(validCompetitorProviderFetchedAt(null), null);
});

test("marketplace state follows only its relevant providers and keeps partial failures visible", () => {
  const providers = parseCompetitorProviderSnapshot([
    {
      provider: "naver_shopping",
      status: "searched",
      count: 1,
      marketplaces: ["smartstore", "coupang", "elevenst", "qoo10", "other"],
    },
    failed,
    {
      provider: "elevenst_product_search",
      status: "failed",
      count: 0,
      marketplaces: ["elevenst"],
    },
  ]);

  assert.equal(competitorMarketplaceProviderState("smartstore", providers), "ready");
  assert.equal(competitorMarketplaceProviderState("elevenst", providers), "partial");
  assert.equal(competitorMarketplaceProviderState("ebay", providers), "unavailable");
  assert.equal(competitorMarketplaceProviderState("temu", providers), null);
});

test("a pending relevant provider keeps its marketplaces loading", () => {
  const providers = parseCompetitorProviderSnapshot([{
    provider: "brave_marketplace_web",
    status: "pending",
    count: 0,
    marketplaces: ["shopee", "lazada", "temu"],
  }]);
  assert.equal(competitorMarketplaceProviderState("shopee", providers), "loading");
  assert.equal(competitorMarketplaceProviderState("lazada", providers), "loading");
});
