import assert from "node:assert/strict";
import test from "node:test";
import {
  competitorCandidateRelevance,
  groupCompetitorPrices,
  normalizedCompetitorQueries,
  searchCompetitorProviders,
  searchEbayBrowseVariants,
  searchElevenstProducts,
  searchNaverShoppingVariants,
  type CompetitorPriceCandidate,
  type CompetitorProviderRegistry,
} from "../lib/competitor-prices";

function candidate(overrides: Partial<CompetitorPriceCandidate> = {}): CompetitorPriceCandidate {
  return {
    provider: "naver_shopping",
    externalId: "candidate-1",
    title: "켈로그 첵스초코 570g",
    url: "https://www.11st.co.kr/products/1",
    imageUrl: "",
    mallName: "11번가",
    marketplace: "elevenst",
    price: 7_900,
    currency: "KRW",
    ...overrides,
  };
}

test("competitor queries keep distinct multilingual product names and discard duplicates", () => {
  assert.deepEqual(normalizedCompetitorQueries("첵스초코 570g", [
    "  첵스초코   570g ",
    "Kellogg's Choco Chex 570g",
    "ケロッグ チョコチェックス 570g",
  ]), ["첵스초코 570g", "Kellogg's Choco Chex 570g", "ケロッグ チョコチェックス 570g"]);
});

test("provider calls receive the same bounded query contract as the gateway enqueue RPC", async () => {
  let receivedPrimary = "";
  let receivedContext: unknown;
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "elevenst_product_search",
      marketplaces: ["elevenst"],
      search: async (primary, _aliases, _display, context) => {
        receivedPrimary = primary;
        receivedContext = context;
        return [];
      },
    }],
    unavailable: [],
  };

  const context = { productId: "019d2a88-ec56-7ce7-933a-2f9cdfa0501f", claimToken: "019d2a88-ec56-7ce7-933a-2f9cdfa05020" };
  await searchCompetitorProviders(registry, `첵스초코 ${"긴상품명".repeat(100)}`, [], 30, 0, context);
  assert.equal(receivedPrimary.length, 160);
  assert.deepEqual(receivedContext, context);
});

test("competitor relevance requires the requested package size and enough identity tokens", () => {
  const queries = ["켈로그 첵스초코 570g", "Kellogg's Choco Chex 570g"];
  assert.ok(competitorCandidateRelevance(candidate(), queries) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "켈로그 첵스초코 1.2kg" }), queries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "초코 시리얼 570g" }), queries), 0);
});

test("11st official ProductSearch parses only catalog fields and uses English search mode for an English alias", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
      <ProductSearchResponse><Products><Product>
        <ProductCode>123456789</ProductCode><ProductName><![CDATA[Kellogg's Choco Chex 570g]]></ProductName>
        <ProductPrice>9900</ProductPrice><SalePrice>7900</SalePrice>
        <ProductImage>https://image.11st.co.kr/example.jpg</ProductImage><Seller>official-store</Seller>
        <DetailPageUrl>https://www.11st.co.kr/products/123456789</DetailPageUrl>
      </Product></Products></ProductSearchResponse>`, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  };
  try {
    const items = await searchElevenstProducts("Kellogg Choco Chex 570g", { apiKey: "A".repeat(32) }, 3);
    const url = new URL(calledUrl);
    assert.equal(url.hostname, "openapi.11st.co.kr");
    assert.equal(url.searchParams.get("apiCode"), "ProductSearch");
    assert.equal(url.searchParams.get("targetSearchPrd"), "ENG");
    assert.deepEqual(items, [candidate({
      provider: "elevenst_product_search",
      externalId: "123456789",
      title: "Kellogg's Choco Chex 570g",
      url: "https://www.11st.co.kr/products/123456789",
      imageUrl: "https://image.11st.co.kr/example.jpg",
      mallName: "official-store",
    })]);
    assert.equal(JSON.stringify(items).includes("A".repeat(32)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay Browse exchanges an application token once and searches every multilingual alias", async () => {
  const originalFetch = globalThis.fetch;
  const searches: string[] = [];
  let tokenCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/identity/v1/oauth2/token")) {
      tokenCalls += 1;
      assert.equal(init?.method, "POST");
      return Response.json({ access_token: "application-token", expires_in: 7200 });
    }
    searches.push(url.searchParams.get("q") ?? "");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer application-token");
    return Response.json({ itemSummaries: [{
      itemId: `v1|${searches.length}|0`, title: "Kellogg's Choco Chex 570g", itemWebUrl: `https://www.ebay.com/itm/${searches.length}`,
      image: { imageUrl: "https://i.ebayimg.com/example.jpg" }, seller: { username: "seller" }, price: { value: "12.50", currency: "USD" },
    }] });
  };
  try {
    const items = await searchEbayBrowseVariants("첵스초코 570g", ["Kellogg's Choco Chex 570g"], {
      clientId: "unique-client-id",
      clientSecret: "client-secret",
      marketplaceId: "EBAY_US",
      environment: "production",
    }, 3);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(searches, ["첵스초코 570g", "Kellogg's Choco Chex 570g"]);
    assert.equal(items.length, 2);
    assert.equal(items.every((item) => item.provider === "ebay_browse" && item.currency === "USD"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider registry keeps missing providers explicit and deduplicates the same marketplace listing", async () => {
  const registry: CompetitorProviderRegistry = {
    configured: [
      {
        id: "naver_shopping",
        marketplaces: ["elevenst"],
        search: async () => [
          candidate(),
          candidate({ externalId: "unrelated", title: "아몬드 시리얼 570g", url: "https://www.11st.co.kr/products/2" }),
        ],
      },
      {
        id: "elevenst_product_search",
        marketplaces: ["elevenst"],
        search: async () => [candidate({ provider: "elevenst_product_search", externalId: "1", url: "https://www.11st.co.kr/products/1", imageUrl: "https://example.test/product.jpg" })],
      },
    ],
    unavailable: [{ provider: "ebay_browse", status: "unavailable", count: 0, marketplaces: ["ebay"] }],
  };
  const result = await searchCompetitorProviders(registry, "켈로그 첵스초코 570g", ["Kellogg's Choco Chex 570g"]);
  assert.equal(result.available, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.imageUrl, "https://example.test/product.jpg");
  assert.deepEqual(result.providers.map(({ provider, status, count }) => ({ provider, status, count })), [
    { provider: "naver_shopping", status: "searched", count: 1 },
    { provider: "elevenst_product_search", status: "searched", count: 1 },
    { provider: "ebay_browse", status: "unavailable", count: 0 },
  ]);
});

test("an unfinished local gateway search remains pending instead of being treated as a completed empty search", async () => {
  const pendingError = new Error("CHANNEL_GATEWAY_TIMEOUT");
  pendingError.name = "ChannelGatewayInProgressError";
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "elevenst_product_search",
      marketplaces: ["elevenst"],
      search: async () => { throw pendingError; },
    }],
    unavailable: [],
  };

  const result = await searchCompetitorProviders(registry, "첵스초코 570g", [], 30, 50);
  assert.equal(result.available, false);
  assert.equal(result.pending, true);
  assert.deepEqual(result.providers, [{
    provider: "elevenst_product_search",
    status: "pending",
    count: 0,
    marketplaces: ["elevenst"],
  }]);
});

test("the scheduler budget expiring around an 11st gateway poll also remains resumable", async () => {
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "elevenst_product_search",
      marketplaces: ["elevenst"],
      search: async () => await new Promise<never>(() => undefined),
    }],
    unavailable: [],
  };

  const result = await searchCompetitorProviders(registry, "첵스초코 570g", [], 30, 5);
  assert.equal(result.available, false);
  assert.equal(result.pending, true);
  assert.equal(result.providers[0]?.status, "pending");
});

test("a direct provider crossing the shared budget cannot be silently dropped from a completed refresh", async () => {
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "ebay_browse",
      marketplaces: ["ebay"],
      search: async () => await new Promise<never>(() => undefined),
    }],
    unavailable: [],
  };

  const result = await searchCompetitorProviders(registry, "Kellogg Choco Chex 570g", [], 30, 5);
  assert.equal(result.available, false);
  assert.equal(result.pending, true);
  assert.equal(result.providers[0]?.status, "pending");
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
