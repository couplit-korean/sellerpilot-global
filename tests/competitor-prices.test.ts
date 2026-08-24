import assert from "node:assert/strict";
import test from "node:test";
import {
  groupCompetitorPrices,
  normalizedCompetitorQueries,
  searchNaverShoppingVariants,
} from "../lib/competitor-prices";

test("competitor queries keep distinct multilingual product names and discard duplicates", () => {
  assert.deepEqual(normalizedCompetitorQueries("첵스초코 570g", [
    "  첵스초코   570g ",
    "Kellogg's Choco Chex 570g",
    "ケロッグ チョコチェックス 570g",
  ]), ["첵스초코 570g", "Kellogg's Choco Chex 570g", "ケロッグ チョコチェックス 570g"]);
});

test("multilingual Naver searches merge duplicate products and keep up to three per marketplace", async () => {
  const originalFetch = globalThis.fetch;
  const queries: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    queries.push(url.searchParams.get("query") ?? "");
    const query = url.searchParams.get("query") ?? "";
    const items = query.includes("첵스") ? [
      { productId: "same-1", title: "켈로그 첵스초코 570g", link: "https://smartstore.naver.com/store/products/1", image: "https://example.test/1.jpg", mallName: "네이버 스마트스토어", lprice: "7900" },
      { productId: "11st-1", title: "켈로그 첵스초코 570g", link: "https://www.11st.co.kr/products/2", image: "", mallName: "11번가", lprice: "8100" },
    ] : query.includes("Choco") ? [
      { productId: "same-1", title: "Kellogg's Choco Chex 570g", link: "https://smartstore.naver.com/store/products/1", image: "https://example.test/1-en.jpg", mallName: "네이버 스마트스토어", lprice: "8000" },
      { productId: "ebay-1", title: "Kellogg's Choco Chex 570g", link: "https://www.ebay.com/itm/3", image: "", mallName: "eBay", lprice: "12900" },
    ] : [];
    return Response.json({ items });
  };

  try {
    const merged = await searchNaverShoppingVariants(
      "첵스초코 570g",
      ["Kellogg's Choco Chex 570g", "ケロッグ チョコチェックス 570g"],
      { clientId: "search-id", clientSecret: "search-secret" },
      30,
    );
    const grouped = groupCompetitorPrices(merged, 3);
    assert.deepEqual(queries, ["첵스초코 570g", "Kellogg's Choco Chex 570g", "ケロッグ チョコチェックス 570g"]);
    assert.equal(grouped.filter((item) => item.externalId === "same-1").length, 1);
    assert.equal(grouped.some((item) => item.marketplace === "elevenst"), true);
    assert.equal(grouped.some((item) => item.marketplace === "ebay"), true);
    assert.equal(grouped.find((item) => item.externalId === "same-1")?.price, 7_900);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
