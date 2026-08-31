import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicatedV3CompetitorDisplayItems,
  type CompetitorDisplayItem,
} from "../app/_publishing/competitor-price-v3-ui";
import { COMPETITOR_MATCHER_VERSION, lowestEligibleCompetitorPrice } from "../lib/competitor-price-model";

const observedAt = "2026-08-31T03:00:00.000Z";

function observation({
  id,
  provider,
  marketplace,
  externalId,
  canonicalUrl,
  matchTier,
  krwAmount,
}: {
  id: string;
  provider: "naver_shopping" | "elevenst_product_search" | "ebay_browse" | "brave_marketplace_web";
  marketplace: "smartstore" | "elevenst" | "ebay";
  externalId: string;
  canonicalUrl: string;
  matchTier: "exact" | "probable" | "rejected";
  krwAmount: number;
}): CompetitorDisplayItem {
  const url = `${canonicalUrl}?provider=${provider}`;
  return {
    id,
    provider,
    marketplace,
    externalId,
    title: `${matchTier} candidate ${id}`,
    url,
    imageUrl: null,
    mallName: provider,
    price: krwAmount,
    currency: "KRW",
    matcherVersion: COMPETITOR_MATCHER_VERSION,
    matchTier,
    matchScore: matchTier === "exact" ? 100 : matchTier === "probable" ? 75 : 20,
    matchEvidence: matchTier === "rejected" ? [] : [{ code: "brand_exact", attribute: "brand", expected: "A", actual: "A" }],
    mismatchEvidence: matchTier === "rejected" ? [{ code: "pack_count_mismatch", attribute: "itemCount", expected: "1", actual: "6" }] : [],
    priceComponents: {
      itemPrice: { status: "known", amount: krwAmount, currency: "KRW", krwAmount },
      requiredOptionSurcharge: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
      shipping: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
      taxAndDuty: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
      discount: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
    },
    totalPurchasePrice: { amount: krwAmount, currency: "KRW", krwAmount },
    exchangeRate: null,
    unitPrice: null,
    canonicalUrl,
    provenance: [{ provider, marketplace, externalId, url, collectedAt: observedAt }],
    observedAt,
    inventoryStatus: "in_stock",
  };
}

test("saved raw provider rows deduplicate before display and eligibility while preserving review tiers", () => {
  const exactCanonical = "https://shop.example/products/exact";
  const raw = [
    observation({ id: "exact-naver", provider: "naver_shopping", marketplace: "smartstore", externalId: "naver-1", canonicalUrl: exactCanonical, matchTier: "exact", krwAmount: 15_000 }),
    observation({ id: "exact-ebay", provider: "ebay_browse", marketplace: "ebay", externalId: "ebay-9", canonicalUrl: exactCanonical, matchTier: "exact", krwAmount: 14_500 }),
    observation({ id: "probable-eleven", provider: "elevenst_product_search", marketplace: "elevenst", externalId: "shared-probable", canonicalUrl: "https://11st.example/a", matchTier: "probable", krwAmount: 9_000 }),
    observation({ id: "probable-web", provider: "brave_marketplace_web", marketplace: "elevenst", externalId: "shared-probable", canonicalUrl: "https://11st.example/b", matchTier: "probable", krwAmount: 8_500 }),
    observation({ id: "rejected", provider: "naver_shopping", marketplace: "smartstore", externalId: "rejected-1", canonicalUrl: "https://shop.example/products/rejected", matchTier: "rejected", krwAmount: 1_000 }),
  ];

  const deduplicated = deduplicatedV3CompetitorDisplayItems(raw);
  assert.equal(deduplicated.length, 3);
  assert.deepEqual(deduplicated.map((item) => item.matchTier).sort(), ["exact", "probable", "rejected"]);
  assert.equal(deduplicated.find((item) => item.matchTier === "exact")?.provenance.length, 2);
  assert.equal(deduplicated.find((item) => item.matchTier === "probable")?.provenance.length, 2);
  assert.equal(lowestEligibleCompetitorPrice(deduplicated)?.matchTier, "exact");
  assert.equal(lowestEligibleCompetitorPrice(deduplicated)?.totalPurchasePrice?.krwAmount, 14_500);
});
