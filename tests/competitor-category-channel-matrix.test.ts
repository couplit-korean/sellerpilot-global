import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCompetitorMatch,
  canonicalCompetitorUrl,
  type CompetitorCandidateIdentity,
  type CompetitorProductIdentity,
} from "../lib/competitor-price-model";
import {
  searchCompetitorProviders,
  type CompetitorMarketplace,
  type CompetitorPriceCandidate,
  type CompetitorProviderRegistry,
} from "../lib/competitor-prices";

type PublicListingFixture = {
  category: string;
  marketplace: Exclude<CompetitorMarketplace, "other">;
  reference: CompetitorProductIdentity;
  title: string;
  url: string;
  identity?: CompetitorCandidateIdentity;
  expectedTier: "exact" | "probable" | "rejected";
};

// Public listing titles and URLs observed on 2026-08-31. These are replayed
// locally; the test never calls, signs in to, or writes to a marketplace.
const publicListingFixtures: PublicListingFixture[] = [
  {
    category: "electronics",
    marketplace: "smartstore",
    reference: {
      productName: "Sony WH-1000XM6 Wireless Headphones",
      brand: "Sony",
      modelNumber: "WH-1000XM6",
      condition: "new",
      options: { color: "black" },
    },
    title: "소니 SONY WH-1000XM6 노이즈캔슬링 블루투스 무선 헤드폰 샌드 핑크",
    url: "https://smartstore.naver.com/shanling/products/13430115682",
    identity: { brand: "Sony", modelNumber: "WH-1000XM6", condition: "new" },
    expectedTier: "rejected",
  },
  {
    category: "beauty",
    marketplace: "coupang",
    reference: {
      productName: "COSRX Low pH Good Morning Gel Cleanser",
      brand: "COSRX",
      specification: { value: 150, unit: "ml" },
      itemCount: 1,
      packageType: "single",
      contentType: "main",
      options: { option: "150ml" },
      verifiedAliases: [
        { attribute: "brand", value: "코스알엑스", source: "manufacturer_catalog" },
        { attribute: "productName", value: "약산성 굿모닝 젤 클렌저", source: "manufacturer_catalog" },
      ],
    },
    title: "[1+1] 코스알엑스 약산성 굿모닝 젤 클렌저 150ml 더블 기획",
    url: "https://www.coupang.com/vp/products/2472153?itemId=19237846292&vendorItemId=86354181380",
    expectedTier: "rejected",
  },
  {
    category: "electronics",
    marketplace: "elevenst",
    reference: {
      productName: "Sony WH-1000XM6 Wireless Headphones",
      brand: "Sony",
      modelNumber: "WH-1000XM6",
      condition: "new",
      options: { color: "black" },
    },
    title: "[소니공식스토어] SONY WH-1000XM6 노이즈캔슬링 블루투스 헤드폰",
    url: "https://www.11st.co.kr/products/8798916939",
    expectedTier: "probable",
  },
  {
    category: "beauty",
    marketplace: "qoo10",
    reference: {
      productName: "ANUA Heartleaf 77 Soothing Toner",
      brand: "ANUA",
      specification: { value: 250, unit: "ml" },
      itemCount: 1,
      packageType: "single",
      contentType: "main",
      options: { option: "toner" },
    },
    title: "〖３本セット〗ANUA ハートリーフ 77 スージングトナー 250ml / ローション 200ml / アンプル 30ml",
    url: "https://www.qoo10.jp/gmkt.inc/Goods/Goods.aspx?goodscode=1011300627",
    identity: { brand: "ANUA", productName: "ANUA Heartleaf 77 Soothing Toner", contentType: "main" },
    expectedTier: "rejected",
  },
  {
    category: "beauty",
    marketplace: "shopee",
    reference: {
      productName: "COSRX Low pH Good Morning Gel Cleanser",
      brand: "COSRX",
      specification: { value: 150, unit: "ml" },
      itemCount: 1,
      packageType: "single",
      contentType: "main",
      options: { option: "150ml" },
    },
    title: "COSRX OFFICIAL Low pH Good Morning Gel Cleanser 150ml 20ml 50ml 150ml mini duo kit",
    url: "https://shopee.sg/-COSRX-OFFICIAL-Low-pH-Good-Morning-Gel-Cleanser-150ml-BHA-0.5-Tea-Tree-Leaf-Oil-0.5-Daily-Mild-Cleanser-for-Sensitive-Skin-20ml-50ml-150ml-mini-duo-kit-i.116704504.1933124589",
    expectedTier: "rejected",
  },
  {
    category: "beauty",
    marketplace: "lazada",
    reference: {
      productName: "ANUA Heartleaf 77 Soothing Toner",
      brand: "ANUA",
      specification: { value: 250, unit: "ml" },
      itemCount: 1,
      packageType: "single",
      contentType: "main",
      options: { option: "toner" },
    },
    title: "ANUA Heartleaf 77% Soothing Toner for Calming and Hydrating Skin 250ml",
    url: "https://www.lazada.sg/products/anua-heartleaf-77-soothing-toner-for-calming-and-hydrating-skin-250ml-i3421783144-s22787475282.html",
    expectedTier: "probable",
  },
  {
    category: "beauty",
    marketplace: "ebay",
    reference: {
      productName: "COSRX Low pH Good Morning Gel Cleanser",
      brand: "COSRX",
      specification: { value: 150, unit: "ml" },
      itemCount: 1,
      packageType: "single",
      contentType: "main",
      condition: "new",
      options: { option: "150ml" },
    },
    title: "COSRX Low pH Good Morning Gel Cleanser - 150ml",
    url: "https://www.ebay.com/itm/166754700827",
    identity: { brand: "COSRX", condition: "new" },
    expectedTier: "probable",
  },
  {
    category: "home",
    marketplace: "temu",
    reference: { productName: "40oz Stainless Steel Tumbler with Handle Lid" },
    title: "40oz Stainless Steel Tumbler with 304 Insulation, Handle and Lid",
    url: "https://www.temu.com/40oz-stainless-steel-tumbler-with---304-insulated-for-12-hours--drinks-cold-for-24-hours--handle-lid-durable-portable-for-home-office-or--drinkware-elegant-tumbler-design-durable--g-601100018291834.html",
    expectedTier: "probable",
  },
];

test("public listings replay conservative v3 decisions across every competitor marketplace", () => {
  const decisions = publicListingFixtures.map((fixture) => ({
    fixture,
    result: assessCompetitorMatch(fixture.reference, { title: fixture.title, identity: fixture.identity }),
  }));

  assert.deepEqual(
    new Set(decisions.map(({ fixture }) => fixture.marketplace)),
    new Set<Exclude<CompetitorMarketplace, "other">>([
      "smartstore", "coupang", "elevenst", "qoo10", "shopee", "lazada", "ebay", "temu",
    ]),
  );
  for (const { fixture, result } of decisions) {
    assert.notEqual(canonicalCompetitorUrl(fixture.url), "", `${fixture.marketplace}: invalid fixture URL`);
    assert.equal(result.matchTier, fixture.expectedTier, `${fixture.marketplace}: ${fixture.title}`);
  }
  assert.equal(
    decisions.find(({ fixture }) => fixture.marketplace === "qoo10")?.result.mismatchEvidence
      .some((evidence) => evidence.attribute === "itemCount" || evidence.attribute === "specification"),
    true,
  );
  assert.equal(
    decisions.find(({ fixture }) => fixture.marketplace === "shopee")?.result.mismatchEvidence
      .some((evidence) => evidence.code === "title_quantity_conflict"),
    true,
  );
});

test("food, books, fashion, refill and purchase-mode category fences stay fail-closed", () => {
  const food = assessCompetitorMatch({
    productName: "첵스초코",
    brand: "켈로그",
    specification: { value: 570, unit: "g" },
    itemCount: 1,
    options: { flavor: "chocolate" },
    verifiedAliases: [
      { attribute: "brand", value: "Kellogg", source: "manufacturer_catalog" },
      { attribute: "productName", value: "Choco Chex", source: "manufacturer_catalog" },
    ],
  }, { title: "Kellogg Choco Chex 570g 1 pack chocolate" });
  assert.equal(food.matchTier, "exact");

  const book = assessCompetitorMatch(
    { productName: "The Pragmatic Programmer", gtins: ["9780135957059"] },
    { title: "The Pragmatic Programmer", identity: { gtins: ["9780135957059"] } },
  );
  assert.equal(book.matchTier, "exact");

  const fashion = assessCompetitorMatch(
    { productName: "Nike Air Force 1", brand: "Nike", modelNumber: "CW2288-111", options: { size: "270" } },
    { title: "Nike Air Force 1 CW2288-111 size 280", identity: { brand: "Nike", condition: "new" } },
  );
  assert.equal(fashion.matchTier, "rejected");

  const exactFashionSize = assessCompetitorMatch(
    { productName: "Nike Air Force 1", brand: "Nike", modelNumber: "CW2288-111", options: { size: "270" } },
    { title: "Nike Air Force 1 CW2288-111 size 270", identity: { brand: "Nike", condition: "new" } },
  );
  assert.equal(exactFashionSize.matchTier, "exact");

  const ambiguousFashionRange = assessCompetitorMatch(
    { productName: "Nike Air Force 1", brand: "Nike", modelNumber: "CW2288-111", options: { size: "270" } },
    { title: "Nike Air Force 1 CW2288-111 sizes 260-280", identity: { brand: "Nike", condition: "new" } },
  );
  assert.equal(ambiguousFashionRange.matchTier, "rejected");

  const ambiguousColorListing = assessCompetitorMatch(
    { productName: "Sony WH-1000XM6", brand: "Sony", modelNumber: "WH-1000XM6", options: { color: "black" } },
    { title: "Sony WH-1000XM6 Black / White", identity: { brand: "Sony", condition: "new" } },
  );
  assert.equal(ambiguousColorListing.matchTier, "rejected");

  const refill = assessCompetitorMatch(
    { productName: "Couplit Hand Wash", brand: "Couplit", contentType: "main" },
    { title: "Couplit Hand Wash refill 500ml" },
  );
  assert.equal(refill.matchTier, "rejected");

  const subscription = assessCompetitorMatch(
    { productName: "Couplit Water Filter", brand: "Couplit", modelNumber: "WF-100", purchaseType: "one_time" },
    { title: "Couplit Water Filter WF-100 monthly subscription" },
  );
  assert.equal(subscription.matchTier, "rejected");
});

function coverageCandidate(
  provider: CompetitorPriceCandidate["provider"],
  marketplace: Exclude<CompetitorMarketplace, "other">,
): CompetitorPriceCandidate {
  const urls: Record<Exclude<CompetitorMarketplace, "other">, string> = {
    smartstore: "https://smartstore.naver.com/coverage/products/1001",
    coupang: "https://www.coupang.com/vp/products/1002",
    elevenst: "https://www.11st.co.kr/products/1003",
    qoo10: "https://www.qoo10.jp/gmkt.inc/Goods/Goods.aspx?goodscode=1004",
    shopee: "https://shopee.sg/Coverage-Product-i.10.1005",
    lazada: "https://www.lazada.sg/products/coverage-product-i1006.html",
    ebay: "https://www.ebay.com/itm/1007",
    temu: "https://www.temu.com/coverage-product-g-1008.html",
  };
  return {
    provider,
    marketplace,
    externalId: `coverage-${marketplace}`,
    title: "SellerPilot Coverage Model C8 500ml",
    url: urls[marketplace],
    imageUrl: "",
    mallName: marketplace,
    price: 10_000,
    currency: "KRW",
  };
}

test("provider orchestration returns independent searched status and results for all eight marketplaces", async () => {
  const registry: CompetitorProviderRegistry = {
    configured: [
      {
        id: "naver_shopping",
        marketplaces: ["smartstore", "coupang", "elevenst", "qoo10", "other"],
        search: async () => (["smartstore", "coupang", "elevenst", "qoo10"] as const)
          .map((marketplace) => coverageCandidate("naver_shopping", marketplace)),
      },
      {
        id: "elevenst_product_search",
        marketplaces: ["elevenst"],
        search: async () => [coverageCandidate("elevenst_product_search", "elevenst")],
      },
      {
        id: "ebay_browse",
        marketplaces: ["ebay"],
        search: async () => [coverageCandidate("ebay_browse", "ebay")],
      },
      {
        id: "brave_marketplace_web",
        marketplaces: ["shopee", "lazada", "temu"],
        search: async () => (["shopee", "lazada", "temu"] as const)
          .map((marketplace) => coverageCandidate("brave_marketplace_web", marketplace)),
      },
    ],
    unavailable: [],
  };

  const result = await searchCompetitorProviders(registry, "SellerPilot Coverage Model C8 500ml", []);
  assert.deepEqual(
    new Set(result.items.map((item) => item.marketplace)),
    new Set<Exclude<CompetitorMarketplace, "other">>([
      "smartstore", "coupang", "elevenst", "qoo10", "shopee", "lazada", "ebay", "temu",
    ]),
  );
  assert.equal(result.providers.length, 4);
  assert.equal(result.providers.every((provider) => provider.status === "searched"), true);
  assert.equal(result.available, true);
  assert.equal(result.pending, false);
});
