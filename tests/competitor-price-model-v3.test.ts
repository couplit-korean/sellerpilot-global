import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPETITOR_MATCHER_VERSION,
  assessCompetitorMatch,
  canonicalCompetitorUrl,
  competitorLowestPriceEligibility,
  deduplicateCompetitorObservations,
  enrichCompetitorCandidateV3,
  knownCompetitorPriceComponent,
  lowestEligibleCompetitorPrice,
  normalizeCompetitorPrice,
  suggestCompetitorAwarePrice,
  unknownCompetitorPriceComponent,
  type CompetitorCandidateV3Input,
  type CompetitorPriceComponentsInput,
  type CompetitorProductIdentity,
} from "../lib/competitor-price-model";
import {
  competitorProviderFailureStatus,
  searchCompetitorProviders,
  type CompetitorPriceCandidate,
  type CompetitorProviderRegistry,
} from "../lib/competitor-prices";

const allKnownKrw: CompetitorPriceComponentsInput = {
  itemPrice: knownCompetitorPriceComponent(10_000, "KRW"),
  requiredOptionSurcharge: knownCompetitorPriceComponent(0, "KRW"),
  shipping: knownCompetitorPriceComponent(3_000, "KRW"),
  taxAndDuty: knownCompetitorPriceComponent(1_000, "KRW"),
  discount: knownCompetitorPriceComponent(1_000, "KRW"),
};

function listing(overrides: Partial<CompetitorCandidateV3Input> = {}): CompetitorCandidateV3Input {
  return {
    provider: "naver_shopping",
    marketplace: "smartstore",
    externalId: "listing-1",
    title: "테스트 상품",
    url: "https://smartstore.naver.com/example/products/1",
    price: 10_000,
    currency: "KRW",
    ...overrides,
  };
}

test("v3 identity precedence accepts a structured exact GTIN without inventing missing attributes", () => {
  const result = assessCompetitorMatch(
    { productName: "확정 상품", gtins: ["8801234567890"], condition: "new" },
    { title: "확정 상품", identity: { gtins: ["8801234567890"] } },
  );

  assert.equal(COMPETITOR_MATCHER_VERSION, "strict-2026-08-31-v3");
  assert.equal(result.matchTier, "exact");
  assert.equal(result.matchScore, 100);
  assert.equal(result.matchEvidence.some((evidence) => evidence.code === "gtin_exact"), true);
  assert.deepEqual(result.mismatchEvidence, []);
});

test("an unlabeled title number is not inferred to be an exact GTIN", () => {
  const result = assessCompetitorMatch(
    { productName: "확정 상품", gtins: ["8801234567890"] },
    { title: "확정 상품 판매자번호 8801234567890" },
  );

  assert.notEqual(result.matchTier, "exact");
  assert.equal(result.matchEvidence.some((evidence) => evidence.code === "gtin_exact"), false);
});

test("brand plus exact model is exact, but a missing confirmed condition downgrades to probable", () => {
  const exact = assessCompetitorMatch(
    { productName: "WH-1000XM6 헤드폰", brand: "Sony", modelNumber: "WH-1000XM6" },
    { title: "Sony WH-1000XM6 Wireless Headphones" },
  );
  assert.equal(exact.matchTier, "exact");
  assert.equal(exact.matchEvidence.some((evidence) => evidence.code === "model_exact"), true);

  const missingCondition = assessCompetitorMatch(
    { productName: "WH-1000XM6 헤드폰", brand: "Sony", modelNumber: "WH-1000XM6", condition: "new" },
    { title: "Sony WH-1000XM6 Wireless Headphones" },
  );
  assert.equal(missingCondition.matchTier, "probable");
});

test("a compatible accessory cannot use the main product model path, while an accessory reference remains matchable", () => {
  for (const title of [
    "Sony WH-1000XM6 호환 케이스 1개 새상품 단품",
    "Sony WH-1000XM6 battery 1pc new single",
    "Sony WH-1000XM6 screen protector 1pc new single",
    "Sony WH-1000XM6 hard shell 1pc new single",
    "Sony WH-1000XM6 earcup 1pc new single",
  ]) {
    const mainProduct = assessCompetitorMatch(
      {
        productName: "WH-1000XM6 헤드폰",
        brand: "Sony",
        modelNumber: "WH-1000XM6",
        itemCount: 1,
        packageType: "single",
        condition: "new",
      },
      { title },
    );
    assert.equal(mainProduct.matchTier, "rejected", title);
    assert.equal(
      mainProduct.mismatchEvidence.some((evidence) => evidence.code === "accessory_product_mismatch"),
      true,
      title,
    );
  }

  const accessory = assessCompetitorMatch(
    {
      productName: "WH-1000XM6 호환 케이스",
      brand: "Acme",
      modelNumber: "CASE-XM6",
      condition: "new",
    },
    { title: "Acme WH-1000XM6 compatible case CASE-XM6 new item" },
  );
  assert.equal(accessory.matchTier, "exact");
});

test("verified MPN aliases explicitly present in a listing title can satisfy the model path", () => {
  const result = assessCompetitorMatch(
    {
      productName: "Acme 정수 필터",
      brand: "Acme",
      manufacturerPartNumber: "RF-200",
      verifiedAliases: [{ attribute: "manufacturerPartNumber", value: "RF200", source: "manufacturer_catalog" }],
    },
    { title: "Acme Water Filter RF200" },
  );
  assert.equal(result.matchTier, "exact");
  assert.equal(result.matchEvidence.some((evidence) => evidence.code === "mpn_exact" && evidence.source === "listing_title"), true);
});

test("same names cannot hide different capacity or pack configuration", () => {
  const reference: CompetitorProductIdentity = {
    productName: "Couplit 데일리 샴푸",
    brand: "Couplit",
    specification: { value: 500, unit: "ml" },
    itemCount: 1,
    packageType: "single",
    options: { option: "none" },
  };

  const wrongCapacity = assessCompetitorMatch(reference, {
    title: "Couplit 데일리 샴푸 1L 1개",
    identity: { options: { option: "none" } },
  });
  assert.equal(wrongCapacity.matchTier, "rejected");
  assert.equal(wrongCapacity.mismatchEvidence.some((evidence) => evidence.attribute === "specification"), true);

  const wrongPack = assessCompetitorMatch(reference, {
    title: "Couplit 데일리 샴푸 500ml 2팩 묶음",
    identity: { options: { option: "none" } },
  });
  assert.equal(wrongPack.matchTier, "rejected");
  assert.equal(wrongPack.mismatchEvidence.some((evidence) => evidence.code === "pack_count_mismatch"), true);
  assert.equal(wrongPack.mismatchEvidence.some((evidence) => evidence.attribute === "packageType"), true);
});

test("main versus refill, new versus used/refurbished, and explicit option conflicts are rejected", () => {
  const base: CompetitorProductIdentity = {
    productName: "Couplit 컬러 토너",
    brand: "Couplit",
    contentType: "main",
    condition: "new",
    options: { color: "black" },
  };

  for (const [title, expectedAttribute] of [
    ["Couplit 컬러 토너 리필 black", "contentType"],
    ["Couplit 컬러 토너 중고 black", "condition"],
    ["Couplit 컬러 토너 refurbished black", "condition"],
    ["Couplit 컬러 토너 새상품 white", "color"],
  ] as const) {
    const result = assessCompetitorMatch(base, { title });
    assert.equal(result.matchTier, "rejected", title);
    assert.equal(result.mismatchEvidence.some((evidence) => evidence.attribute === expectedAttribute), true, title);
  }
});

test("real Sony WH-1000XM6 listings do not confuse Bluetooth with blue and reject non-new conditions", () => {
  const reference: CompetitorProductIdentity = {
    productName: "Sony WH-1000XM6 Wireless Noise Cancelling Headphones",
    brand: "Sony",
    manufacturer: "Sony",
    modelNumber: "WH-1000XM6",
    condition: "new",
    options: { color: "black" },
  };

  const officialElevenst = assessCompetitorMatch(reference, {
    title: "[소니공식스토어] SONY WH-1000XM6 노이즈캔슬링 블루투스 헤드폰",
  });
  assert.equal(officialElevenst.matchTier, "probable");
  assert.equal(officialElevenst.mismatchEvidence.some((evidence) => evidence.attribute === "color"), false);

  const blackElevenst = assessCompetitorMatch(reference, {
    title: "[정품] 소니 WH-1000XM6 블랙 (소니 코리아 정식 발매 제품) 867784",
    identity: { condition: "new" },
  });
  // The Korean title is useful evidence, but "소니" is not invented as a
  // Sony alias. Without a provider-structured brand or verified alias it must
  // remain a human-review candidate rather than an automatic exact match.
  assert.equal(blackElevenst.matchTier, "probable");
  assert.deepEqual(blackElevenst.mismatchEvidence, []);

  const pinkElevenst = assessCompetitorMatch(reference, {
    title: "[소니공식스토어] SONY WH-1000XM6 노이즈캔슬링 블루투스 무선 헤드폰 샌드핑크",
    identity: { condition: "new" },
  });
  assert.equal(pinkElevenst.matchTier, "rejected");
  assert.equal(pinkElevenst.mismatchEvidence.some((evidence) => evidence.attribute === "color"), true);

  const misleadingElevenstCatalogAccessory = assessCompetitorMatch(reference, {
    title: "SOULWIT 이어패드는 소니 WH-1000XM6 헤드폰용 교체 이어패드 쿠션 블랙",
  });
  assert.equal(misleadingElevenstCatalogAccessory.matchTier, "rejected");
  assert.equal(
    misleadingElevenstCatalogAccessory.mismatchEvidence.some((evidence) => evidence.code === "accessory_product_mismatch"),
    true,
  );

  const sealedEbay = assessCompetitorMatch(reference, {
    title: "Sony WH-1000XM6 (Black) Noise Cancelling Headphones – Brand New (Sealed)",
  });
  assert.equal(sealedEbay.matchTier, "exact");

  const priorGenerationEbay = assessCompetitorMatch(reference, {
    title: "NEW IN BOX SONY WH-1000XM5 MIDNIGHT BLACK NOISE CANCELLING HEADPHONES",
  });
  assert.equal(priorGenerationEbay.matchTier, "rejected");
  assert.equal(priorGenerationEbay.mismatchEvidence.some((evidence) => evidence.code === "model_title_mismatch"), true);

  for (const title of [
    "Sony WH-1000XM6 Headphones Black - Open Box Condition",
    "Sony WH-1000XM6 Black Amazon Renewed",
    "소니 WH-1000XM6 블랙 전시상품",
    "소니 WH-1000XM6 블랙 반품상품",
  ]) {
    const result = assessCompetitorMatch(reference, { title });
    assert.equal(result.matchTier, "rejected", title);
    assert.equal(result.mismatchEvidence.some((evidence) => evidence.attribute === "condition"), true, title);
  }
});

test("structured candidate facts cannot conceal explicit title conflicts", () => {
  const result = assessCompetitorMatch(
    {
      productName: "Couplit 컬러 토너",
      brand: "Couplit",
      specification: { value: 500, unit: "ml" },
      itemCount: 1,
      packageType: "single",
      contentType: "main",
      condition: "new",
      options: { color: "black" },
    },
    {
      title: "Couplit 컬러 토너 1L 2팩 리필 중고 white",
      identity: {
        specification: { value: 500, unit: "ml" },
        itemCount: 1,
        packageType: "single",
        contentType: "main",
        condition: "new",
        options: { color: "black" },
      },
    },
  );

  assert.equal(result.matchTier, "rejected");
  for (const attribute of ["specification", "itemCount", "packageType", "contentType", "condition", "color"]) {
    assert.equal(result.mismatchEvidence.some((evidence) => evidence.attribute === attribute && evidence.source === "listing_title"), true, attribute);
  }
});

test("a title cannot conceal a conflicting provider-structured model number", () => {
  const result = assessCompetitorMatch(
    {
      productName: "Sony WH-1000XM6 Wireless Headphones",
      brand: "Sony",
      modelNumber: "WH-1000XM6",
      condition: "new",
    },
    {
      title: "Sony WH-1000XM6 Wireless Headphones Brand New",
      identity: {
        brand: "Sony",
        modelNumber: "Sony WH-1000XM5 Headphones",
        condition: "new",
      },
    },
  );

  assert.equal(result.matchTier, "rejected");
  assert.equal(result.mismatchEvidence.some((evidence) => evidence.code === "model_mismatch"), true);
});

test("only verified multilingual aliases can complete the descriptive exact path", () => {
  const reference: CompetitorProductIdentity = {
    productName: "첵스초코",
    brand: "켈로그",
    specification: { value: 570, unit: "g" },
    itemCount: 1,
    options: { flavor: "chocolate" },
    verifiedAliases: [
      { attribute: "brand", value: "ケロッグ", source: "manufacturer_catalog" },
      { attribute: "brand", value: "Kellogg", source: "manufacturer_catalog" },
      { attribute: "productName", value: "チョコチェックス", source: "manufacturer_catalog" },
    ],
  };
  const verified = assessCompetitorMatch(reference, { title: "ケロッグ チョコチェックス 570g 1個 チョコ" });
  assert.equal(verified.matchTier, "exact");

  const unverified = assessCompetitorMatch(reference, { title: "Kellogg Choco Rings 570g 1 pack chocolate" });
  assert.equal(unverified.matchTier, "probable");
  assert.equal(unverified.matchEvidence.some((evidence) => evidence.code === "product_name_exact"), false);
});

test("descriptive matching remains probable when confirmed option semantics are missing", () => {
  const result = assessCompetitorMatch(
    {
      productName: "Couplit 드링크",
      brand: "Couplit",
      specification: { value: 250, unit: "ml" },
      itemCount: 1,
    },
    { title: "Couplit 드링크 250ml 1개" },
  );
  assert.equal(result.matchTier, "probable");
});

test("unknown shipping is preserved and prevents total-purchase-price calculation", () => {
  const normalized = normalizeCompetitorPrice({
    priceComponents: {
      itemPrice: knownCompetitorPriceComponent(10_000, "KRW"),
      requiredOptionSurcharge: knownCompetitorPriceComponent(0, "KRW"),
      shipping: unknownCompetitorPriceComponent("KRW"),
      taxAndDuty: knownCompetitorPriceComponent(0, "KRW"),
      discount: knownCompetitorPriceComponent(0, "KRW"),
    },
  });
  assert.deepEqual(normalized.priceComponents.shipping, {
    status: "unknown",
    amount: null,
    currency: "KRW",
    krwAmount: null,
  });
  assert.equal(normalized.totalPurchasePrice, null);
  assert.equal(normalized.unitPrice, null);
});

test("a provider item price leaves every unreported component and inventory state unknown", () => {
  const observedAt = "2026-08-31T01:00:00.000Z";
  const enriched = enrichCompetitorCandidateV3(
    { productName: "테스트 상품" },
    listing({ observedAt }),
  );

  assert.deepEqual(enriched.priceComponents.itemPrice, {
    status: "known",
    amount: 10_000,
    currency: "KRW",
    krwAmount: 10_000,
  });
  for (const component of [
    enriched.priceComponents.requiredOptionSurcharge,
    enriched.priceComponents.shipping,
    enriched.priceComponents.taxAndDuty,
    enriched.priceComponents.discount,
  ]) {
    assert.deepEqual(component, {
      status: "unknown",
      amount: null,
      currency: "KRW",
      krwAmount: null,
    });
  }
  assert.equal(enriched.inventoryStatus, "unknown");
  assert.equal(enriched.totalPurchasePrice, null);
  assert.deepEqual(
    competitorLowestPriceEligibility(enriched, { now: "2026-08-31T02:00:00.000Z" }).reasons,
    ["match_not_exact", "not_in_stock", "total_purchase_price_unavailable"],
  );
});

test("currency conversion preserves FX provenance and reports a one-base-unit price", () => {
  const normalized = normalizeCompetitorPrice({
    priceComponents: {
      itemPrice: knownCompetitorPriceComponent(10, "USD"),
      requiredOptionSurcharge: knownCompetitorPriceComponent(2, "USD"),
      shipping: knownCompetitorPriceComponent(3, "USD"),
      taxAndDuty: knownCompetitorPriceComponent(1, "USD"),
      discount: knownCompetitorPriceComponent(1, "USD"),
    },
    exchangeRate: {
      provider: "Korea Eximbank",
      quotedAt: "2026-08-31T00:00:00.000Z",
      rate: 1_300,
      fromCurrency: "USD",
      toCurrency: "KRW",
    },
    unitQuantity: { value: 500, unit: "g" },
  });

  assert.deepEqual(normalized.totalPurchasePrice, { amount: 15, currency: "USD", krwAmount: 19_500 });
  assert.deepEqual(normalized.exchangeRate, {
    provider: "Korea Eximbank",
    quotedAt: "2026-08-31T00:00:00.000Z",
    rate: 1_300,
    fromCurrency: "USD",
    toCurrency: "KRW",
  });
  assert.deepEqual(normalized.unitPrice, {
    amount: 0.03,
    currency: "USD",
    krwAmount: 39,
    quantity: { value: 1, unit: "g" },
  });
});

test("a foreign-currency total remains unconverted without verified FX provenance", () => {
  const normalized = normalizeCompetitorPrice({
    priceComponents: {
      itemPrice: knownCompetitorPriceComponent(10, "USD"),
      requiredOptionSurcharge: knownCompetitorPriceComponent(0, "USD"),
      shipping: knownCompetitorPriceComponent(2, "USD"),
      taxAndDuty: knownCompetitorPriceComponent(1, "USD"),
      discount: knownCompetitorPriceComponent(1, "USD"),
    },
  });

  assert.deepEqual(normalized.totalPurchasePrice, { amount: 12, currency: "USD", krwAmount: null });
  assert.equal(normalized.exchangeRate, null);
  assert.equal(normalized.unitPrice, null);
  assert.equal(competitorLowestPriceEligibility({
    matchTier: "exact",
    inventoryStatus: "in_stock",
    observedAt: "2026-08-31T01:00:00.000Z",
    totalPurchasePrice: normalized.totalPurchasePrice,
  }, { now: "2026-08-31T02:00:00.000Z" }).reasons.includes("krw_conversion_unavailable"), true);
});

test("canonical URL deduplication preserves every approved source provenance", () => {
  const reference = { productName: "확정 상품", gtins: ["8801234567890"] } satisfies CompetitorProductIdentity;
  const first = enrichCompetitorCandidateV3(reference, listing({
    provider: "naver_shopping",
    marketplace: "elevenst",
    externalId: "naver-1",
    title: "확정 상품 8801234567890",
    url: "https://www.11st.co.kr/products/123?utm_source=naver",
  }), "2026-08-31T01:00:00.000Z");
  const second = enrichCompetitorCandidateV3(reference, listing({
    provider: "elevenst_product_search",
    marketplace: "elevenst",
    externalId: "elevenst-123",
    title: "확정 상품 8801234567890",
    url: "https://www.11st.co.kr/products/123?utm_campaign=official",
  }), "2026-08-31T01:01:00.000Z");

  assert.equal(canonicalCompetitorUrl(first.url), "https://www.11st.co.kr/products/123");
  const deduplicated = deduplicateCompetitorObservations([first, second]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0]?.provenance.length, 2);
  assert.deepEqual(new Set(deduplicated[0]?.provenance.map((source) => source.provider)), new Set(["naver_shopping", "elevenst_product_search"]));
});

test("only exact, in-stock, fresh, calculable KRW totals are lowest-price eligible", () => {
  const reference = { productName: "확정 상품", gtins: ["8801234567890"] } satisfies CompetitorProductIdentity;
  const exact = enrichCompetitorCandidateV3(reference, listing({
    title: "확정 상품 8801234567890",
    identity: { gtins: ["8801234567890"] },
    inventoryStatus: "in_stock",
    observedAt: "2026-08-31T01:00:00.000Z",
    priceComponents: allKnownKrw,
  }));
  const probable = { ...exact, externalId: "probable", matchTier: "probable" as const, matchScore: 70 };
  const stale = { ...exact, externalId: "stale", observedAt: "2026-08-29T00:00:00.000Z", totalPurchasePrice: { amount: 5_000, currency: "KRW", krwAmount: 5_000 } };

  assert.deepEqual(competitorLowestPriceEligibility(exact, { now: "2026-08-31T02:00:00.000Z" }), { eligible: true, reasons: [] });
  assert.equal(competitorLowestPriceEligibility(probable, { now: "2026-08-31T02:00:00.000Z" }).reasons.includes("match_not_exact"), true);
  assert.equal(competitorLowestPriceEligibility(stale, { now: "2026-08-31T02:00:00.000Z" }).reasons.includes("snapshot_stale"), true);
  assert.equal(lowestEligibleCompetitorPrice([probable, stale, exact], { now: "2026-08-31T02:00:00.000Z" })?.externalId, exact.externalId);
});

test("price following never breaks target margin or the hard margin floor", () => {
  const base = {
    productCost: 10_000,
    fulfillmentShipping: 2_000,
    taxAndDuty: 0,
    channelFeeRate: 0.1,
    targetMarginRate: 0.2,
    minimumMarginRate: 0.05,
  };
  const belowFloor = suggestCompetitorAwarePrice({ ...base, competitorTotalPurchasePrice: 13_000 });
  assert.equal(belowFloor.followsCompetitor, false);
  assert.equal(belowFloor.exclusionReason, "margin_floor_breached");
  assert.equal(belowFloor.suggestedPrice, belowFloor.targetMarginPrice);

  const belowTarget = suggestCompetitorAwarePrice({ ...base, competitorTotalPurchasePrice: 16_000 });
  assert.equal(belowTarget.followsCompetitor, false);
  assert.equal(belowTarget.exclusionReason, "target_margin_not_met");

  const safe = suggestCompetitorAwarePrice({ ...base, competitorTotalPurchasePrice: 19_000, undercutAmount: 100 });
  assert.equal(safe.followsCompetitor, true);
  assert.equal(safe.suggestedPrice, 18_900);
});

function providerCandidate(overrides: Partial<CompetitorPriceCandidate> = {}): CompetitorPriceCandidate {
  return {
    provider: "naver_shopping",
    marketplace: "smartstore",
    externalId: "provider-1",
    title: "Kellogg Chex 570g 8801234567890",
    url: "https://smartstore.naver.com/example/products/1",
    imageUrl: "",
    mallName: "Smartstore",
    price: 9_000,
    currency: "KRW",
    identity: { gtins: ["8801234567890"] },
    ...overrides,
  };
}

test("identity-aware provider search returns exact plus bounded rejected evidence while legacy results stay unlabelled", async () => {
  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "naver_shopping",
      marketplaces: ["smartstore"],
      search: async () => [
        providerCandidate(),
        providerCandidate({
          externalId: "provider-wrong-gtin",
          title: "Kellogg Chex 570g 8809999999999",
          url: "https://smartstore.naver.com/example/products/2",
          identity: { gtins: ["8809999999999"] },
        }),
      ],
    }],
    unavailable: [],
  };
  const identity = {
    productName: "Kellogg Chex 570g",
    brand: "Kellogg",
    gtins: ["8801234567890"],
  } satisfies CompetitorProductIdentity;

  const v3 = await searchCompetitorProviders(registry, identity.productName, [], 30, 100, { identity });
  assert.deepEqual(v3.items.map((item) => item.matchTier), ["exact", "rejected"]);
  assert.equal(v3.items.every((item) => item.matcherVersion === COMPETITOR_MATCHER_VERSION), true);
  assert.equal(v3.items.every((item) => (item.provenance?.length ?? 0) > 0), true);

  const legacy = await searchCompetitorProviders(registry, identity.productName, []);
  assert.equal(legacy.items.every((item) => item.matchTier === undefined), true);
});

test("identity search keeps per-provider source observations before cross-provider display dedupe", async () => {
  const canonicalUrl = "https://market.example/products/shared-1";
  const registry: CompetitorProviderRegistry = {
    configured: [
      {
        id: "naver_shopping",
        marketplaces: ["other"],
        search: async () => [
          providerCandidate({
            provider: "naver_shopping",
            marketplace: "other",
            externalId: "naver-shared-1",
            mallName: "Naver catalog seller",
            price: 9_000,
            url: `${canonicalUrl}?utm_source=naver`,
          }),
          providerCandidate({
            provider: "naver_shopping",
            marketplace: "other",
            externalId: "naver-shared-1",
            mallName: "Naver retry copy",
            price: 9_100,
            url: `${canonicalUrl}?utm_campaign=retry`,
          }),
        ],
      },
      {
        id: "brave_marketplace_web",
        marketplaces: ["shopee"],
        search: async () => [providerCandidate({
          provider: "brave_marketplace_web",
          marketplace: "shopee",
          externalId: "brave-shared-1",
          mallName: "Shopee source seller",
          price: 9_200,
          url: `${canonicalUrl}?utm_source=brave`,
        })],
      },
    ],
    unavailable: [],
  };
  const identity = {
    productName: "Kellogg Chex 570g",
    brand: "Kellogg",
    gtins: ["8801234567890"],
  } satisfies CompetitorProductIdentity;

  const result = await searchCompetitorProviders(registry, identity.productName, [], 30, 100, { identity });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.provenance?.length, 2);
  assert.equal(result.sourceItems?.length, 2);
  assert.deepEqual(new Set(result.sourceItems?.map((item) => item.provider)), new Set(["naver_shopping", "brave_marketplace_web"]));
  const naver = result.sourceItems?.find((item) => item.provider === "naver_shopping");
  const brave = result.sourceItems?.find((item) => item.provider === "brave_marketplace_web");
  assert.equal(naver?.mallName, "Naver catalog seller");
  assert.equal(naver?.price, 9_000);
  assert.equal(brave?.mallName, "Shopee source seller");
  assert.equal(brave?.price, 9_200);
  assert.equal(naver?.provenance?.every((source) => source.provider === "naver_shopping"), true);
  assert.equal(brave?.provenance?.every((source) => source.provider === "brave_marketplace_web"), true);
});

test("per-provider persistence observations are fairly capped at thirty", async () => {
  const candidates = (provider: "naver_shopping" | "brave_marketplace_web", offset: number) => (
    Array.from({ length: 24 }, (_, index) => providerCandidate({
      provider,
      marketplace: provider === "naver_shopping" ? "other" : "shopee",
      externalId: `${provider}-${index}`,
      url: `https://market.example/products/${offset + index}`,
    }))
  );
  const registry: CompetitorProviderRegistry = {
    configured: [
      { id: "naver_shopping", marketplaces: ["other"], search: async () => candidates("naver_shopping", 0) },
      { id: "brave_marketplace_web", marketplaces: ["shopee"], search: async () => candidates("brave_marketplace_web", 100) },
    ],
    unavailable: [],
  };
  const identity = { productName: "Kellogg Chex 570g", gtins: ["8801234567890"] } satisfies CompetitorProductIdentity;

  const result = await searchCompetitorProviders(registry, identity.productName, [], 30, 100, { identity });
  assert.equal(result.sourceItems?.length, 30);
  assert.equal(result.sourceItems?.filter((item) => item.provider === "naver_shopping").length, 15);
  assert.equal(result.sourceItems?.filter((item) => item.provider === "brave_marketplace_web").length, 15);
});

test("provider deadlines and completed 11st in-progress errors terminate as failed", async () => {
  const gatewayError = new Error("CHANNEL_GATEWAY_TIMEOUT");
  gatewayError.name = "ChannelGatewayInProgressError";
  assert.equal(competitorProviderFailureStatus("elevenst_product_search", gatewayError), "failed");
  assert.equal(competitorProviderFailureStatus("ebay_browse", new Error("COMPETITOR_PROVIDER_TIMEOUT")), "failed");

  const registry: CompetitorProviderRegistry = {
    configured: [{
      id: "elevenst_product_search",
      marketplaces: ["elevenst"],
      search: async () => { throw gatewayError; },
    }],
    unavailable: [],
  };
  const result = await searchCompetitorProviders(registry, "Kellogg Chex 570g", [], 30, 50);
  assert.equal(result.pending, false);
  assert.equal(result.providers[0]?.status, "failed");
});
