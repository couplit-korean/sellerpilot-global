import assert from "node:assert/strict";
import test from "node:test";
import {
  braveMarketplaceSearchQuery,
  canonicalMarketplaceWebImageUrl,
  canonicalMarketplaceWebProductUrl,
  competitorCandidateRelevance,
  competitorProviderRegistry,
  groupCompetitorPrices,
  normalizedCompetitorQueries,
  searchBraveMarketplaceWebVariants,
  searchCompetitorProviders,
  searchEbayBrowseVariants,
  searchElevenstProductVariants,
  searchElevenstProducts,
  searchNaverShoppingVariants,
  structuredMarketplaceWebPrice,
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

test("competitor queries retain bounded channel-local language coverage after normalized deduplication", () => {
  const queries = normalizedCompetitorQueries("켈로그 첵스초코 570g", [
    "Kellogg Choco Chex 570 g",
    "Kellogg Choco-Chex 570 g",
    "ケロッグ チョコチェックス 570g",
    "家樂氏 巧克力 穀物 570g",
    "Bijirin coklat Kellogg perisa coklat 570g",
    "Produk sereal cokelat Kellogg rasa cokelat 570g",
    "Ngũ cốc sô cô la Kellogg 570g",
    "ซีเรียลช็อกโกแลต Kellogg 570g",
    "Produto cereal de chocolate Kellogg 570g",
    "Producto cereal de chocolate Kellogg 570g",
    `Kellogg chocolate cereal ${"long ".repeat(100)}570g`,
  ], 12);

  assert.equal(queries.length, 11);
  assert.equal(queries.every((query) => query.length <= 160), true);
  assert.equal(queries.filter((query) => query.includes("Choco")).length, 1);
  for (const marker of ["ケロッグ", "家樂氏", "perisa", "Produk", "Ngũ", "ซีเรียล", "Produto", "Producto"]) {
    assert.equal(queries.some((query) => query.includes(marker)), true, marker);
  }
});

test("Brave marketplace queries stay within the documented limits and only name official marketplace domains", () => {
  const query = braveMarketplaceSearchQuery(`사조참치 ${"긴상품명 ".repeat(100)}95g`, "shopee");
  assert.ok(query.length <= 400);
  assert.ok(query.split(/\s+/u).length <= 50);
  assert.match(query, /site:shopee\.sg/u);
  assert.match(query, /site:shopee\.com\.my/u);
  assert.doesNotMatch(query, /lazada|temu|example/u);
});

test("marketplace web URLs and structured prices fail closed on lookalike hosts, non-products, and snippet-only prices", () => {
  assert.equal(
    canonicalMarketplaceWebProductUrl("https://www.shopee.sg/Sajo-Tuna-i.12.34?utm_source=test#reviews", "shopee"),
    "https://www.shopee.sg/Sajo-Tuna-i.12.34",
  );
  assert.equal(canonicalMarketplaceWebProductUrl("https://shopee.sg.example.com/Sajo-Tuna-i.12.34", "shopee"), "");
  assert.equal(canonicalMarketplaceWebProductUrl("https://www.lazada.com.my/catalog/?q=tuna", "lazada"), "");
  assert.equal(canonicalMarketplaceWebProductUrl("https://www.temu.com/goods.html?goods_id=601099123456789&utm_source=test", "temu"), "https://www.temu.com/goods.html?goods_id=601099123456789");

  assert.equal(canonicalMarketplaceWebImageUrl("https://cf.shopee.sg/file/product.webp", "shopee"), "https://cf.shopee.sg/file/product.webp");
  assert.equal(canonicalMarketplaceWebImageUrl("http://cf.shopee.sg/file/product.webp", "shopee"), "");
  assert.equal(canonicalMarketplaceWebImageUrl("https://localhost/product.webp", "shopee"), "");
  assert.equal(canonicalMarketplaceWebImageUrl("https://127.0.0.1/product.webp", "shopee"), "");
  assert.equal(canonicalMarketplaceWebImageUrl("https://10.0.0.1/product.webp", "shopee"), "");
  assert.equal(canonicalMarketplaceWebImageUrl("https://shopee.sg.evil.example/product.webp", "shopee"), "");
  assert.equal(canonicalMarketplaceWebImageUrl("", "shopee"), "");

  assert.deepEqual(structuredMarketplaceWebPrice({
    product: { offers: { price: "RM 34.90", priceCurrency: "MYR" } },
  }), { price: 34.9, currency: "MYR" });
  assert.equal(structuredMarketplaceWebPrice({ description: "Sale price $9.99" }), null);
  assert.equal(structuredMarketplaceWebPrice({ product: { price: "$9.99" } }), null);
  assert.equal(structuredMarketplaceWebPrice({ product: { price: "from 9.99" } }), null);
});

test("Brave marketplace web search reuses multilingual aliases, rejects untrusted results, and caps every marketplace at three", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const apiKey = "B".repeat(32);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.origin + url.pathname, "https://api.search.brave.com/res/v1/web/search");
    assert.equal(new Headers(init?.headers).get("x-subscription-token"), apiKey);
    assert.equal(url.toString().includes(apiKey), false);
    const query = url.searchParams.get("q") ?? "";
    if (!query.includes("Sajo lean tuna")) return Response.json({ web: { results: [] } });

    const marketplace = query.includes("site:shopee.sg") ? "shopee"
      : query.includes("site:lazada.sg") ? "lazada"
      : "temu";
    const validResults = Array.from({ length: 5 }, (_, index) => {
      if (marketplace === "shopee") return {
        title: "Sajo lean tuna 95g 8 pack",
        url: `https://shopee.sg/Sajo-Tuna-i.111.${100 + index}?tracking=remove`,
        thumbnail: { original: `https://cf.shopee.sg/file/${index}` },
        product: { offers: { price: String(12.5 + index) } },
      };
      if (marketplace === "lazada") return {
        title: "Sajo lean tuna 95g 8 pack",
        url: `https://www.lazada.com.my/products/sajo-tuna-i${200 + index}-s1.html?spm=remove`,
        schemas: [{ "@type": "Product", offers: { lowPrice: String(34.9 + index), priceCurrency: "MYR" } }],
      };
      return {
        title: "Sajo lean tuna 95g 8 pack",
        url: `https://www.temu.com/sajo-tuna-g-${300 + index}.html?refer_page=remove`,
        product: { price: String(9.99 + index), currency: "USD" },
      };
    });
    return Response.json({ web: { results: [
      ...validResults,
      {
        title: "Sajo lean tuna 95g 8 pack",
        url: "https://temu.com.example.test/sajo-tuna-g-999.html",
        product: { price: "1.00", currency: "USD" },
      },
      {
        title: "Sajo lean tuna 95g 40 pack",
        url: marketplace === "shopee"
          ? "https://shopee.sg/Wrong-Pack-i.111.999"
          : marketplace === "lazada"
            ? "https://www.lazada.com.my/products/wrong-pack-i999-s1.html"
            : "https://www.temu.com/wrong-pack-g-999.html",
        product: { price: "1.00", priceCurrency: marketplace === "lazada" ? "MYR" : "USD" },
      },
      {
        title: "Sajo lean tuna 95g 8 pack",
        url: marketplace === "shopee"
          ? "https://shopee.sg/No-Price-i.111.998"
          : marketplace === "lazada"
            ? "https://www.lazada.com.my/products/no-price-i998-s1.html"
            : "https://www.temu.com/no-price-g-998.html",
        description: "Sale price $0.01",
      },
    ] } });
  };

  try {
    const items = await searchBraveMarketplaceWebVariants(
      "사조 살코기플러스 참치 95g x 8개",
      [
        "Sajo lean tuna 95g 8 pack",
        "サジョ ライトツナ 95g 8缶",
        "沙祖 瘦肉 鮪魚 95g 8罐",
        "ปลาทูน่าซาโจ 95g 8 กระป๋อง",
        "Cá ngừ Sajo 95g 8 hộp",
        "Produk tuna Sajo rasa asli 95g 8 kaleng",
        "Tuna Sajo perisa asli 95g 8 tin",
        "Produto atum Sajo 95g 8 latas",
        "Producto atún Sajo 95g 8 latas",
      ],
      { apiKey },
      20,
    );
    assert.equal(calls.length, 3);
    assert.equal(calls.every((url) => url.searchParams.get("country") === "ALL"), true);
    assert.deepEqual([...new Set(calls.map((url) => url.searchParams.get("search_lang")))].sort(), ["en"]);
    assert.deepEqual([...new Set(items.map((item) => item.marketplace))].sort(), ["lazada", "shopee", "temu"]);
    assert.deepEqual(Object.fromEntries(["shopee", "lazada", "temu"].map((marketplace) => [
      marketplace,
      items.filter((item) => item.marketplace === marketplace).length,
    ])), { shopee: 3, lazada: 3, temu: 3 });
    assert.equal(items.every((item) => item.provider === "brave_marketplace_web"), true);
    assert.equal(items.every((item) => item.externalId.length <= 500), true);
    assert.equal(items.some((item) => item.externalId === "999" || item.externalId === "998"), false);
    assert.equal(items.some((item) => item.externalId === "shopee.sg:111-100"), true);
    assert.equal(items.some((item) => item.externalId === "www.lazada.com.my:200"), true);
    assert.equal(items.some((item) => item.externalId === "www.temu.com:300"), true);
    assert.deepEqual(items.map((item) => item.currency).sort(), ["MYR", "MYR", "MYR", "SGD", "SGD", "SGD", "USD", "USD", "USD"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Brave marketplace web search exhausts distinct language families before returning an honest empty result", async () => {
  const originalFetch = globalThis.fetch;
  const languages: Array<{ marketplace: "shopee" | "lazada" | "temu"; language: string }> = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const query = url.searchParams.get("q") ?? "";
    const marketplace = query.includes("site:shopee.sg") ? "shopee"
      : query.includes("site:lazada.sg") ? "lazada"
        : "temu";
    languages.push({ marketplace, language: url.searchParams.get("search_lang") ?? "" });
    return Response.json({ web: { results: [] } });
  };
  try {
    const items = await searchBraveMarketplaceWebVariants(
      "사조 살코기플러스 참치 95g x 8개",
      [
        "Sajo lean tuna 95g 8 pack",
        "サジョ ライトツナ 95g 8缶",
        "沙祖 瘦肉 鮪魚 95g 8罐",
        "ปลาทูน่าซาโจ 95g 8 กระป๋อง",
        "Cá ngừ Sajo 95g 8 hộp",
        "Produk tuna Sajo rasa asli 95g 8 kaleng",
        "Tuna Sajo perisa asli 95g 8 tin",
        "Produto atum Sajo 95g 8 latas",
        "Producto atún Sajo 95g 8 latas",
      ],
      { apiKey: "B".repeat(32) },
    );
    assert.deepEqual(items, []);
    assert.equal(languages.length, 12);
    assert.deepEqual([...new Set(languages.map(({ language }) => language))].sort(), ["en", "es", "id", "ja", "ms", "pt-br", "th", "vi", "zh"]);
    assert.deepEqual(languages.filter(({ marketplace }) => marketplace === "shopee").map(({ language }) => language), ["en", "pt-br", "es", "id"]);
    assert.deepEqual(languages.filter(({ marketplace }) => marketplace === "lazada").map(({ language }) => language), ["en", "ms", "th", "vi"]);
    assert.deepEqual(languages.filter(({ marketplace }) => marketplace === "temu").map(({ language }) => language), ["en", "zh", "ja", "pt-br"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Brave marketplace results use all aliases when the search language and returned title differ", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const query = url.searchParams.get("q") ?? "";
    if (!query.includes("site:shopee.sg") || url.searchParams.get("search_lang") !== "es") return Response.json({ web: { results: [] } });
    return Response.json({ web: { results: [{
      title: "Kellogg Choco Chex 570g",
      url: "https://shopee.com.mx/Kellogg-Chex-i.11.22",
      product: { offers: { price: "149.00", priceCurrency: "MXN" } },
    }] } });
  };
  try {
    const items = await searchBraveMarketplaceWebVariants("켈로그 첵스초코 570g", [
      "Kellogg Choco Chex 570g",
      "ケロッグ チョコチェックス 570g",
      "家樂氏 巧克力 穀物 570g",
      "Produto cereal Kellogg 570g",
      "Producto cereal Kellogg 570g",
      "Produk sereal Kellogg rasa cokelat 570g",
    ], { apiKey: "B".repeat(32) });
    assert.deepEqual(items.map((item) => item.externalId), ["shopee.com.mx:11-22"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("marketplace web provider is opt-in and reports a missing Brave key as unavailable", async () => {
  const original = process.env.BRAVE_SEARCH_API_KEY;
  const serviceClient = { rpc: async () => ({ data: null, error: null }) };
  const options = { searchElevenstViaGateway: async () => [] };
  try {
    delete process.env.BRAVE_SEARCH_API_KEY;
    const disabled = await competitorProviderRegistry(serviceClient as never, options);
    assert.equal(disabled.configured.some((provider) => provider.id === "brave_marketplace_web"), false);
    assert.equal(disabled.unavailable.some((provider) => provider.provider === "brave_marketplace_web"), false);

    const unavailable = await competitorProviderRegistry(serviceClient as never, { ...options, enableMarketplaceWeb: true });
    assert.deepEqual(unavailable.unavailable.find((provider) => provider.provider === "brave_marketplace_web"), {
      provider: "brave_marketplace_web",
      status: "unavailable",
      count: 0,
      marketplaces: ["shopee", "lazada", "temu"],
    });

    process.env.BRAVE_SEARCH_API_KEY = "B".repeat(32);
    const configured = await competitorProviderRegistry(serviceClient as never, { ...options, enableMarketplaceWeb: true });
    assert.equal(configured.configured.some((provider) => provider.id === "brave_marketplace_web"), true);
  } finally {
    if (original === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = original;
  }
});

test("provider credential discovery isolates a Vault exception from an independent provider", async () => {
  const original = process.env.BRAVE_SEARCH_API_KEY;
  process.env.BRAVE_SEARCH_API_KEY = "B".repeat(32);
  const serviceClient = {
    rpc: async () => { throw new Error("synthetic Vault timeout"); },
  };
  try {
    const registry = await competitorProviderRegistry(serviceClient as never, {
      enableMarketplaceWeb: true,
      searchElevenstViaGateway: async () => [],
    });
    assert.deepEqual(registry.configured.map((provider) => provider.id), ["brave_marketplace_web"]);
    assert.deepEqual(registry.unavailable.map((provider) => [provider.provider, provider.status]), [
      ["naver_shopping", "failed"],
      ["elevenst_product_search", "failed"],
      ["ebay_browse", "failed"],
    ]);
  } finally {
    if (original === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = original;
  }
});

test("provider credential discovery reports an RPC error separately from a missing credential", async () => {
  const original = process.env.BRAVE_SEARCH_API_KEY;
  process.env.BRAVE_SEARCH_API_KEY = "B".repeat(32);
  const serviceClient = {
    rpc: async (_functionName: string, parameters: { p_channel: string }) => parameters.p_channel === "elevenst"
      ? { data: null, error: { code: "57014" } }
      : { data: null, error: null },
  };
  try {
    const registry = await competitorProviderRegistry(serviceClient as never, {
      enableMarketplaceWeb: true,
      searchElevenstViaGateway: async () => [],
    });
    assert.deepEqual(registry.unavailable.map((provider) => [provider.provider, provider.status]), [
      ["naver_shopping", "unavailable"],
      ["elevenst_product_search", "failed"],
      ["ebay_browse", "unavailable"],
    ]);
  } finally {
    if (original === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = original;
  }
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

test("marketplace identity keeps the same native item id separate across official country hosts", async () => {
  const shared = {
    provider: "brave_marketplace_web" as const,
    externalId: "same-native-id",
    title: "Kellogg Choco Chex 570g",
    imageUrl: "",
    mallName: "Shopee",
    marketplace: "shopee" as const,
    price: 12,
    currency: "SGD",
  };
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "brave_marketplace_web",
      marketplaces: ["shopee", "lazada", "temu"],
      search: async () => [
        { ...shared, externalId: "shopee.sg:111-222", url: "https://shopee.sg/Chex-i.111.222" },
        { ...shared, externalId: "shopee.com.my:111-222", url: "https://shopee.com.my/Chex-i.111.222", currency: "MYR" },
      ],
    }],
    unavailable: [],
  };

  const result = await searchCompetitorProviders(registry, "Kellogg Choco Chex 570g", []);
  assert.deepEqual(result.items.map((item) => item.externalId).sort(), [
    "shopee.com.my:111-222",
    "shopee.sg:111-222",
  ]);
});

test("competitor relevance requires the requested package size and enough identity tokens", () => {
  const queries = ["켈로그 첵스초코 570g", "Kellogg's Choco Chex 570g"];
  assert.ok(competitorCandidateRelevance(candidate(), queries) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "켈로그 첵스초코 570g 박스 10 x 20cm" }), queries) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "켈로그 첵스초코 1.2kg" }), queries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "켈로그 첵스초코 570g x 2" }), queries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "초코 시리얼 570g" }), queries), 0);
});

test("competitor relevance normalizes spaced units and locale decimal or grouping separators", () => {
  assert.ok(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95g" }), ["Sajo lean tuna 95 g"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Mild shampoo 500ml" }), ["Mild shampoo 500 ml"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Rice 500g" }), ["Rice 0,500 kg"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Rice 1250g" }), ["Rice 1,250 kg"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Rice 1000g" }), ["Rice 1.000 g"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Apple iPhone 15 128GB" }), ["Apple iPhone 15 128 GB"]) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Apple iPhone 15 256GB" }), ["Apple iPhone 15 128 GB"]), 0);
});

test("competitor relevance requires every requested measurement while accepting equivalent pack counters", () => {
  const queries = [
    "사조 살코기플러스 참치 95g x 8개",
    "Sajo lean tuna 95g",
    "Sajo lean tuna 3.35oz (95g) 8 pack",
  ];
  const sameProduct = candidate({ title: "사조참치 살코기 플러스 95g x 8캔" });
  const sameProductWithBareMultiplier = candidate({ title: "사조참치 살코기 플러스 95g × 8" });
  const wrongPack = candidate({ title: "사조 살코기 플러스 참치 95g x 40개", mallName: "8개마켓" });

  assert.ok(competitorCandidateRelevance(sameProduct, queries) > 0);
  assert.ok(competitorCandidateRelevance(sameProductWithBareMultiplier, queries) > 0);
  assert.equal(competitorCandidateRelevance(wrongPack, queries), 0);
});

test("competitor relevance fails closed on GTIN, exact model, accessory, edition, and product-family conflicts", () => {
  const sonyQueries = [
    "Sony WH-1000XM5 wireless headphones 880-1234-567890",
    "소니 WH-1000XM5 무선 헤드폰 8801234567890",
  ];
  assert.ok(competitorCandidateRelevance(candidate({ title: "Sony WH-1000XM5 Wireless Headphones 8801234567890" }), sonyQueries) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sony WH-1000XM4 Wireless Headphones 8801234567890" }), sonyQueries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sony WH-1000XM5 Wireless Headphones" }), sonyQueries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sony WH-1000XM5 Wireless Headphones 8801234567890" }), [
    sonyQueries[0],
    "Sony WH-1000XM5 wireless headphones 4901234567894",
  ]), 0);

  assert.equal(competitorCandidateRelevance(candidate({ title: "Apple iPhone 15 Pro 128GB" }), ["Apple iPhone 15 128GB"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Apple AirPods Pro 2 compatible charging case" }), ["Apple AirPods Pro 2"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Apple iPhone 15 Pro 128GB" }), ["Apple iPhone 15 128GB", "Apple iPhone 15 Pro 128GB"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Apple AirPods Pro 2 compatible charging case" }), ["Apple AirPods Pro 2", "Apple AirPods Pro 2 compatible case"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX 142/S-P Kellogg's Chex Choco Korean Promo Card Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX 142/S-P Kellogg's Chex Choco Korean Promo Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX 142/S-P Kellogg's Chex Choco Korean TCG Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX 142/S-P Kellogg's Chex Choco Korean Collectible Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokémon Kellogg's Chex Choco Korean Promo Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokémon 142/S-P Kellogg's Chex Choco Korean Collectible Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Yu-Gi-Oh Kellogg's Chex Choco Korean Promo Sealed",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "宝可梦 Kellogg Chex Choco 促销 未开封",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "皮卡丘 Kellogg Chex Choco 收藏 未开封",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokémon Kellogg Chex Choco Promocional Sellado",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokémon Kellogg Chex Choco Coleccionable Sellado",
  }), ["첵스초코", "Chex Choco", "Kellogg Choco Chex"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX 142/S-P Kellogg's Chex Choco Korean Promo Card Sealed",
  }), ["Kellogg Chex Choco Promo Pack"]), 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Kellogg Chex Choco Promo Pack",
  }), ["Kellogg Chex Choco Promo Pack"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX Korean Promo Card Sealed",
  }), ["Pokemon Pikachu VMAX Korean Promo Card"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX TCG Sealed",
  }), ["Pokemon Pikachu VMAX card"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu VMAX 142/S-P Korean Promo Card Sealed",
  }), ["Pokemon Pikachu VMAX 142/S-P", "Pokemon Pikachu VMAX 142/S-P Promo Card"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "SanDisk Ultra 128GB microSDXC Memory Card",
  }), ["SanDisk Ultra microSDXC 128GB"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Mattel UNO Classic Card Game",
  }), ["Mattel UNO Classic Game"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu Collectible Figure",
  }), ["Pokemon Pikachu Collectible Figure"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Pokemon Pikachu Promotional Plush",
  }), ["Pokemon Pikachu Promotional Plush"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({
    title: "Kellogg Chex Choco Pokemon Promo Pack",
  }), ["Kellogg Chex Choco Pokemon Promo Pack"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Coca Cola Zero 355ml 24 cans" }), ["Coca Cola Zero 355ml 24 cans"]) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Coca Cola Zero Cherry 355ml 24 cans" }), ["Coca Cola Zero 355ml 24 cans"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Coca Cola Limited Edition 355ml" }), ["Coca Cola Cherry Limited Edition 355ml"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Brand Wireless Premium Headphones X100" }), ["Brand Black Wireless Premium Headphones X100"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sajo hot pepper tuna 95g 8 cans" }), [
    "사조 살코기 참치 95g x 8개",
    "Sajo lean tuna 95g 8 cans",
  ]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "초코 시리얼 570g" }), ["초코딸기 시리얼 570g"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "巧克力 麦片 570g" }), ["巧克力草莓 麦片 570g"]), 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Coca Cola case of 12 cans" }), ["Coca Cola 12 cans"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Sajo light tuna 95g 8 cans" }), [
    "사조 살코기플러스 참치 95g x 8개",
    "Sajo lean tuna 95g 8 cans",
    "サジョ ライトツナ 95g 8缶",
  ]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "蘋果 iPhone 15 128GB" }), [
    "애플 아이폰 15 128GB",
    "Apple iPhone 15 128GB",
    "蘋果 iPhone 15 128GB",
  ]) > 0);
});

test("competitor model matching tolerates CJK and Latin script boundaries without relaxing the core model", () => {
  assert.ok(competitorCandidateRelevance(candidate({ title: "索尼 WH-1000XM5 无线耳机" }), ["索尼WH-1000XM5无线耳机"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "ソニー WH-1000XM5 ワイヤレスヘッドホン" }), ["ソニーWH-1000XM5ワイヤレスヘッドホン"]) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Samsung 갤럭시 S24 스마트폰" }), ["Samsung갤럭시S24스마트폰"]) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "索尼 WH-1000XM4 无线耳机" }), ["索尼WH-1000XM5无线耳机"]), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sony headphones" }), [
    "소니 무선 헤드폰",
    "Sony WH-1000XM5 headphones",
    "ソニー WH-1000XM5 ヘッドホン",
  ]), 0);
});

test("competitor relevance normalizes imperial units, 1+1, pack count, and declared total weight", () => {
  const eightPackQueries = ["사조 살코기 참치 95g x 8개", "Sajo lean tuna 95g 8 cans"];
  assert.ok(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 3.35 oz 8 cans" }), eightPackQueries) > 0);
  assert.ok(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95g x 8 total 760g" }), eightPackQueries) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 100g 8 cans" }), eightPackQueries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95g 40 cans" }), eightPackQueries), 0);

  const twinPackQueries = ["Sajo lean tuna 95g 1+1", "사조 살코기 참치 95g 2개"];
  assert.ok(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95 g 2 pack" }), twinPackQueries) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95 g single can" }), twinPackQueries), 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95 g 2 pack" }), ["Sajo lean tuna 95g"]), 0);

  assert.ok(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95g" }), ["Sajo lean tuna 95g 1 bottle"]) > 0);
  assert.equal(competitorCandidateRelevance(candidate({ title: "Sajo lean tuna 95g 2 pack" }), ["Sajo lean tuna 95g 1 bottle"]), 0);
});

test("provider results rank channel candidates by exact-product confidence before price and keep three", async () => {
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "naver_shopping",
      marketplaces: ["smartstore", "coupang", "elevenst", "qoo10", "other"],
      search: async () => [
        candidate({ externalId: "word-order", title: "Chex Choco by Kellogg 570g", url: "https://www.11st.co.kr/products/101", price: 1_000 }),
        candidate({ externalId: "exact-high", title: "Kellogg Choco Chex 570g", url: "https://www.11st.co.kr/products/102", price: 9_000 }),
        candidate({ externalId: "exact-low", title: "Kellogg Choco Chex 570g official", url: "https://www.11st.co.kr/products/103", price: 8_000 }),
        candidate({ externalId: "wrong-pack", title: "Kellogg Choco Chex 1.2kg", url: "https://www.11st.co.kr/products/104", price: 500 }),
        candidate({ externalId: "accessory", title: "Kellogg Choco Chex 570g compatible case", url: "https://www.11st.co.kr/products/105", price: 100 }),
      ],
    }],
    unavailable: [],
  };

  const result = await searchCompetitorProviders(registry, "Kellogg Choco Chex 570g", []);
  assert.deepEqual(result.items.map((item) => item.externalId), ["exact-low", "exact-high", "word-order"]);
  assert.equal(result.providers[0]?.count, 3);
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
        <DetailPageUrl>http://www.11st.co.kr/products/123456789</DetailPageUrl>
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

test("11st variant search adds a pack-neutral retrieval query without relaxing same-product filtering", async () => {
  const originalFetch = globalThis.fetch;
  const searches: string[] = [];
  globalThis.fetch = async (input) => {
    const query = new URL(String(input)).searchParams.get("keyword") ?? "";
    searches.push(query);
    const products = query === "사조 살코기플러스 참치 95g"
      ? `<Product><ProductCode>same-8</ProductCode><ProductName><![CDATA[사조참치 살코기 플러스 95g x 8캔]]></ProductName><SalePrice>15990</SalePrice><DetailPageUrl>https://www.11st.co.kr/products/800</DetailPageUrl></Product>
         <Product><ProductCode>wrong-40</ProductCode><ProductName><![CDATA[사조 살코기 플러스 참치 95g x 40개]]></ProductName><SalePrice>83000</SalePrice><DetailPageUrl>https://www.11st.co.kr/products/4000</DetailPageUrl></Product>`
      : "";
    return new Response(`<ProductSearchResponse><Products>${products}</Products></ProductSearchResponse>`, {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  };

  try {
    const candidates = await searchElevenstProductVariants(
      "사조 살코기플러스 참치 95g x 8개",
      ["Sajo lean tuna 95g 8 pack"],
      { apiKey: "A".repeat(32) },
      30,
    );
    assert.deepEqual(searches, [
      "사조 살코기플러스 참치 95g x 8개",
      "Sajo lean tuna 95g 8 pack",
      "사조 살코기플러스 참치 95g",
      "Sajo lean tuna 95g",
    ]);

    const registry: CompetitorProviderRegistry = {
      configured: [{ id: "elevenst_product_search", marketplaces: ["elevenst"], search: async () => candidates }],
      unavailable: [],
    };
    const result = await searchCompetitorProviders(registry, "사조 살코기플러스 참치 95g x 8개", ["Sajo lean tuna 95g"]);
    assert.deepEqual(result.items.map((item) => item.externalId), ["same-8"]);
    assert.equal(result.providers[0]?.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st variant search reserves room for pack-neutral queries when AI supplies the maximum aliases", async () => {
  const originalFetch = globalThis.fetch;
  const searches: string[] = [];
  globalThis.fetch = async (input) => {
    searches.push(new URL(String(input)).searchParams.get("keyword") ?? "");
    return new Response("<ProductSearchResponse><Products /></ProductSearchResponse>", {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  };

  try {
    await searchElevenstProductVariants(
      "사조 살코기플러스 참치 95g x 8개",
      Array.from({ length: 11 }, (_, index) => `Sajo tuna 95g ${index + 9} pack`),
      { apiKey: "A".repeat(32) },
      30,
    );
    assert.ok(searches.length > 8 && searches.length <= 12);
    assert.deepEqual(searches.slice(0, 8), [
      "사조 살코기플러스 참치 95g x 8개",
      ...Array.from({ length: 7 }, (_, index) => `Sajo tuna 95g ${index + 9} pack`),
    ]);
    assert.ok(searches.includes("사조 살코기플러스 참치 95g"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st pack-neutral retrieval handles leading multipliers and hyphenated pack labels", async () => {
  const originalFetch = globalThis.fetch;
  const searches: string[] = [];
  globalThis.fetch = async (input) => {
    searches.push(new URL(String(input)).searchParams.get("keyword") ?? "");
    return new Response("<ProductSearchResponse><Products /></ProductSearchResponse>", {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  };
  try {
    await searchElevenstProductVariants(
      "8 x 95g Sajo lean tuna",
      ["Sajo lean tuna 95g 8-pack"],
      { apiKey: "A".repeat(32) },
      30,
    );
    assert.deepEqual(searches, [
      "8 x 95g Sajo lean tuna",
      "Sajo lean tuna 95g 8-pack",
      "95g Sajo lean tuna",
      "Sajo lean tuna 95g",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st pack-neutral retrieval also searches a base query for non-measured multipacks", async () => {
  const originalFetch = globalThis.fetch;
  const searches: string[] = [];
  globalThis.fetch = async (input) => {
    searches.push(new URL(String(input)).searchParams.get("keyword") ?? "");
    return new Response("<ProductSearchResponse><Products /></ProductSearchResponse>", {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  };
  try {
    await searchElevenstProductVariants("Apple AirTag 4 pack", [], { apiKey: "A".repeat(32) }, 30);
    assert.deepEqual(searches, ["Apple AirTag 4 pack", "Apple AirTag"]);
    assert.equal(competitorCandidateRelevance(candidate({ title: "Apple AirTag single" }), ["Apple AirTag 4 pack"]), 0);
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
