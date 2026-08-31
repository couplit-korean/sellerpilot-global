import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveChannelKey } from "../lib/channels/catalog";
import {
  buildChannelArguments,
  missingNativeValues,
} from "../app/product-publish-workbench";
import {
  manualProductRequestFingerprint,
  normalizePendingManualProductRequest,
} from "../app/ai-product-studio";
import { prepareMarketplaceImages } from "../lib/channels/marketplace-images";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";
import { qoo10DetailImageUrls } from "../lib/channels/qoo10-listing-create-preflight";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
} from "../lib/channels/listing-publication-content";
import {
  qoo10ExactForeignPriceCopyPresent,
  bindQoo10ExactLocalizationUpdateArguments,
  qoo10ExactLegacyRomanizedCopyPresent,
  qoo10ExactLocalizationRecoveryIdentity,
} from "../lib/channels/qoo10-exact-localization-recovery";

type PublishContext = Parameters<typeof buildChannelArguments>[1];

function manualContext(): PublishContext {
  return {
    contentMode: "manual_mvp",
    product: {
      id: "11111111-1111-4111-8111-111111111111",
      externalCode: "MANUAL-0001",
      sku: "MANUAL-0001",
      name: "판매자 확인 원본 상품",
      description: "판매자가 실물과 대조해 확인한 원본 상품 설명입니다.",
      sourceUrl: null,
      status: "draft",
    },
    manualFields: {
      productName: "판매자 확인 원본 상품",
      description: "판매자가 실물과 대조해 확인한 원본 상품 설명입니다.",
      sellerSku: "MANUAL-0001",
      categoryHint: "생활용품",
      brandName: "No Brand",
      manufacturer: "확인한 공급처",
      countryOfOrigin: "대한민국",
      material: "실물 표기 재질",
      packageContents: "상품 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 10_000,
      currency: "KRW",
      stock: 3,
      weightKg: 0.2,
      packageLengthCm: 10,
      packageWidthCm: 8,
      packageHeightCm: 4,
    },
    imageSpecs: [],
    assignments: [{
      channel: "qoo10",
      market: "JP",
      categoryId: "320002604",
      categoryPath: ["Home", "Daily goods"],
      providedAttributes: {},
      status: "confirmed",
      confirmedAt: "2026-08-29T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [
      { path: "owner/job/input/normalized/0.jpg", url: "https://cdn.example.com/manual-front.jpg" },
      { path: "owner/job/input/normalized/1.jpg", url: "https://cdn.example.com/manual-back.jpg" },
    ],
    generatedImages: [],
    localizedListings: [],
  };
}

test("manual MVP draft keeps source photos explicit without inventing AI assets", () => {
  const draft = buildChannelArguments(
    "qoo10",
    manualContext(),
    10_000,
    3,
    undefined,
    { weight: 0.2, length: 10, width: 8, height: 4 },
    10,
  ) as unknown as { sellerpilotAssets: Record<string, unknown>; params: Record<string, unknown> };

  assert.equal(draft.sellerpilotAssets.contentMode, "manual_mvp");
  assert.equal(draft.sellerpilotAssets.detailAssetMode, "manual_source");
  assert.deepEqual(draft.sellerpilotAssets.galleryImageUrls, [
    "https://cdn.example.com/manual-front.jpg",
    "https://cdn.example.com/manual-back.jpg",
  ]);
  assert.deepEqual(draft.sellerpilotAssets.detailImageUrls, draft.sellerpilotAssets.galleryImageUrls);
  assert.equal(draft.params.StandardImage, "https://cdn.example.com/manual-front.jpg");
  assert.equal(JSON.stringify(draft).includes("detail-overview"), false);
  assert.equal(missingNativeValues("qoo10", draft).some((item) => item.includes("dedicated marketplace")), false);
  assert.equal(missingNativeValues("qoo10", draft).includes("manual source detail image"), false);
});

const legacyQoo10RomanizedName = "buchakhyeong keibeul jeongri keulrip 6gae seteu";
const legacyQoo10ReviewedTitle = `${legacyQoo10RomanizedName} - 購入前確認`;
const repairedQoo10MarketplaceTitle = "貼り付け式ケーブル整理クリップ6個セット";
type ProductionDetailSection = NonNullable<PublishContext["localizedListings"][number]["detailSections"]>[number];
const productionDetailSectionPairs: Array<readonly [ProductionDetailSection["type"], ProductionDetailSection["imageAsset"]]> = [
  ["overview", "detail-overview"],
  ["feature", "detail-feature"],
  ["howto", "detail-use"],
  ["spec", "detail-dimensions"],
  ["routine", "detail-routine"],
  ["contents", "detail-contents"],
  ["care", "detail-care"],
  ["proof", "detail-package"],
];

function productionLikeQoo10LegacyContext(operation: "create" | "update") {
  const context = manualContext();
  context.contentMode = "ai_generated";
  context.manualFields.productName = "부착형 케이블 정리 클립 6개 세트";
  context.manualFields.description = `판매자가 확인한 ${legacyQoo10RomanizedName} 상품 설명입니다.`;
  const classification = {
    displayName: `${legacyQoo10RomanizedName} ケーブル整理用品`,
    verificationStatus: "verified" as const,
    evidence: `販売者が確認した ${legacyQoo10RomanizedName} 包装表示です。`,
    isHealthFunctionalFood: false,
  };
  context.classification = classification;
  context.product.classification = classification;
  context.localizedListings = [{
    channel: "qoo10",
    market: "JP",
    locale: "ja-JP",
    title: legacyQoo10ReviewedTitle,
    shortDescription: `販売者が確認した ${legacyQoo10RomanizedName} の案内です。판매자 원문 보존.`,
    description: `日本のお客様向けに ${legacyQoo10RomanizedName} の仕様をご案内します。販売者が確認した仕様です。판매자 원문 보존.`,
    keywords: [legacyQoo10RomanizedName, "ケーブル", "整理", "クリップ"],
    thumbnailAltText: `${legacyQoo10RomanizedName} 正面画像`,
    classification,
    detailSections: productionDetailSectionPairs.map(([type, imageAsset], index) => ({
      type,
      buyerQuestion: `${legacyQoo10RomanizedName} の購入前確認 ${index + 1}`,
      evidence: `販売者確認資料 ${legacyQoo10RomanizedName} ${index + 1}`,
      heading: `${legacyQoo10RomanizedName} ${type}`,
      body: `日本語の説明 ${index + 1}。${legacyQoo10RomanizedName} の実物仕様です。판매자 원문 보존.`,
      imageAsset,
      imageAltText: `${legacyQoo10RomanizedName} ${type} 詳細画像`,
    })),
  }];
  context.generatedImages = [
    "square",
    "hero",
    "portrait",
    "wide",
    ...productionDetailSectionPairs.map(([, imageAsset]) => imageAsset),
  ].map((id, index) => ({
    id,
    path: `owner/job/generated/${id}.jpg`,
    url: `https://cdn.example.com/generated-${index}-${id}.jpg`,
  }));
  if (operation === "update") {
    context.listings = [{
      id: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
      channel: "qoo10",
      market: "JP",
      targetId: "",
      remoteId: "1217336970",
      status: "paused",
      lastError: null,
      failureClass: "retryable",
      publishedAt: null,
      requestedPublicationIntent: "live",
      remoteVisibility: "non_public",
      providerStatus: "S1",
    }];
  }
  return context;
}

type Qoo10LegacyRepairDraft = {
  sellerpilotAssets: {
    detailImageAltTexts: string[];
    localizedDetailSections: ProductionDetailSection[];
    thumbnailAltText: string;
  };
  params: {
    ItemDescription: string;
    ItemTitle: string;
  };
};

test("Qoo10 create and exact existing-product update replace legacy romanized references across the reviewed 8-image payload", () => {
  for (const operation of ["create", "update"] as const) {
    const draft = buildChannelArguments(
      "qoo10",
      productionLikeQoo10LegacyContext(operation),
      10_000,
      3,
      undefined,
      { weight: 0.2, length: 10, width: 8, height: 4 },
      10,
    ) as Qoo10LegacyRepairDraft;

    assert.equal(draft.params.ItemTitle, repairedQoo10MarketplaceTitle, `${operation} ItemTitle`);
    assert.match(
      draft.params.ItemDescription,
      /<h1[^>]*>貼り付け式ケーブル整理クリップ6個セット<\/h1>/,
      `${operation} H1`,
    );
    assert.doesNotMatch(draft.params.ItemDescription, new RegExp(legacyQoo10RomanizedName), `${operation} ItemDescription`);
    assert.match(draft.params.ItemDescription, /販売者が確認した仕様です/, `${operation} Japanese seller text`);
    assert.match(draft.params.ItemDescription, /판매자 원문 보존/, `${operation} Korean seller text`);
    assert.equal(draft.sellerpilotAssets.thumbnailAltText.includes(repairedQoo10MarketplaceTitle), true, `${operation} thumbnail alt`);
    assert.equal(draft.sellerpilotAssets.thumbnailAltText.includes(legacyQoo10RomanizedName), false, `${operation} thumbnail legacy`);
    assert.equal(draft.sellerpilotAssets.detailImageAltTexts.length, 8, `${operation} detail alt count`);
    assert.equal(draft.sellerpilotAssets.localizedDetailSections.length, 8, `${operation} detail section count`);
    for (const altText of draft.sellerpilotAssets.detailImageAltTexts) {
      assert.equal(altText.includes(repairedQoo10MarketplaceTitle), true, `${operation} detail alt title`);
      assert.equal(altText.includes(legacyQoo10RomanizedName), false, `${operation} detail alt legacy`);
    }
    assert.equal(JSON.stringify(draft).includes(legacyQoo10RomanizedName), false, `${operation} full provider payload`);
    assert.equal(JSON.stringify(draft).includes(legacyQoo10ReviewedTitle), false, `${operation} full legacy title`);
    assert.equal(listingPublicationLanguageVerified("ja-JP", draft.params.ItemTitle, "title"), true);
  }
});

test("exact Qoo10 workbench draft discards source KRW and romanized copy before provider preparation", () => {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  const context = productionLikeQoo10LegacyContext("update");
  context.product.id = identity.productId;
  context.product.sku = identity.sellerSku;
  context.manualFields.sellerSku = identity.sellerSku;
  context.manualFields.sellingPrice = 5_000;
  context.manualFields.stock = 1;
  context.manualFields.description = `${identity.legacyRomanizedName} 가격은 5,000원입니다.`;
  context.assignments[0].categoryId = identity.categoryCode;

  const draft = buildChannelArguments(
    "qoo10",
    context,
    5_000,
    1,
    undefined,
    { weight: 0.2, length: 10, width: 8, height: 4 },
    10,
  ) as {
    params: Record<string, string>;
    sellerpilotAssets: { detailImageUrls: string[] };
  };

  assert.equal(draft.params.ItemTitle, identity.title);
  assert.equal(draft.params.PromotionName, identity.promotionName);
  assert.equal(draft.params.SellerCode, identity.sellerSku);
  assert.equal(draft.params.Keyword, identity.sourceKeyword);
  assert.equal(draft.params.RetailPrice, String(identity.priceJpy));
  assert.equal(draft.params.ItemPrice, String(identity.priceJpy));
  assert.equal(draft.params.ItemQty, String(identity.quantity));
  assert.equal(draft.params.ShippingNo, identity.shippingNo);
  assert.match(draft.params.ItemDescription, /販売価格は1,871円です/u);
  assert.equal(qoo10ExactLegacyRomanizedCopyPresent(draft.params.ItemDescription), false);
  assert.equal(qoo10ExactForeignPriceCopyPresent(draft.params.ItemDescription), false);
  assert.doesNotMatch(draft.params.ItemDescription, /[가-힣]/u);
  assert.equal(
    listingPublicationLanguageVerified(
      "ja-JP",
      normalizedListingPublicationText(draft.params.ItemDescription),
      "description",
    ),
    true,
  );
  assert.equal(draft.sellerpilotAssets.detailImageUrls.length, 8);
  assert.deepEqual(
    qoo10DetailImageUrls(draft.params.ItemDescription),
    draft.sellerpilotAssets.detailImageUrls,
  );
  const prepared = prepareListingUpdateArguments(
    "qoo10",
    bindQoo10ExactLocalizationUpdateArguments(
      draft as unknown as Record<string, unknown>,
      "c".repeat(40),
    ),
    { status: "published", remoteId: identity.remoteId },
  ) as { params: Record<string, string> };
  assert.equal(prepared.params.SellerCode, identity.sellerSku);
  assert.equal(prepared.params.ItemPrice, String(identity.priceJpy));
  assert.equal(prepared.params.ItemQty, String(identity.quantity));
  assert.equal(prepared.params.ShippingNo, identity.shippingNo);
});

test("Qoo10 preserves seller-authored Japanese and Hangul titles and description text", () => {
  for (const sellerTitle of ["販売者作成のケーブル整理クリップ", "부착형 케이블 클립 - 購入前確認"]) {
    const context = manualContext();
    context.localizedListings = [{
      channel: "qoo10",
      market: "JP",
      locale: "ja-JP",
      title: sellerTitle,
      shortDescription: "販売者が書いた案内です。판매자 작성 문구입니다.",
      description: "販売者が書いた詳細です。판매자 작성 상세입니다.",
      keywords: ["販売者", "판매자"],
      thumbnailAltText: `${sellerTitle} 販売者画像`,
    }];
    const draft = buildChannelArguments(
      "qoo10",
      context,
      10_000,
      3,
      undefined,
      { weight: 0.2, length: 10, width: 8, height: 4 },
      10,
    ) as Qoo10LegacyRepairDraft;

    assert.equal(draft.params.ItemTitle, sellerTitle);
    assert.equal(draft.sellerpilotAssets.thumbnailAltText, `${sellerTitle} 販売者画像`);
    assert.equal(draft.params.ItemDescription.includes("販売者が書いた詳細です"), true);
    assert.equal(draft.params.ItemDescription.includes("판매자 작성 상세입니다"), true);
  }
});

test("legacy Qoo10 repair leaves non-Qoo create and update payloads unchanged", () => {
  for (const operation of ["create", "update"] as const) {
    const context = manualContext();
    context.assignments = [{
      ...context.assignments[0],
      channel: "elevenst",
      market: "KR",
      categoryId: "1341821",
    }];
    context.localizedListings = [{
      channel: "elevenst",
      market: "KR",
      locale: "ko-KR",
      title: legacyQoo10ReviewedTitle,
      shortDescription: `${legacyQoo10RomanizedName} 판매자 작성 요약`,
      description: `${legacyQoo10RomanizedName} 판매자 작성 상세`,
      keywords: [legacyQoo10RomanizedName],
      thumbnailAltText: `${legacyQoo10RomanizedName} 판매자 이미지`,
    }];
    if (operation === "update") {
      context.listings = [{
        id: "33333333-3333-4333-8333-333333333333",
        channel: "elevenst",
        market: "KR",
        targetId: "",
        remoteId: "77889900",
        status: "published",
        lastError: null,
        publishedAt: "2026-08-30T00:00:00.000Z",
        requestedPublicationIntent: "live",
        remoteVisibility: "live",
      }];
    }
    const draft = buildChannelArguments(
      "elevenst",
      context,
      10_000,
      3,
      undefined,
      { weight: 0.2, length: 10, width: 8, height: 4 },
      10,
    ) as {
      product: { htmlDetail: string; prdNm: string };
      sellerpilotAssets: { thumbnailAltText: string };
    };

    assert.equal(draft.product.prdNm, legacyQoo10ReviewedTitle, `${operation} product title`);
    assert.equal(draft.product.htmlDetail.includes(legacyQoo10RomanizedName), true, `${operation} detail text`);
    assert.equal(draft.sellerpilotAssets.thumbnailAltText, `${legacyQoo10RomanizedName} 판매자 이미지`);
  }
});

test("every marketplace draft preserves the explicit manual source-image contract", () => {
  const channels: ActiveChannelKey[] = [
    "qoo10",
    "shopee",
    "lazada",
    "coupang",
    "elevenst",
    "smartstore",
    "temu",
    "ebay",
  ];
  const markets: Record<ActiveChannelKey, string> = {
    qoo10: "JP",
    shopee: "SG",
    lazada: "MY",
    coupang: "KR",
    elevenst: "KR",
    smartstore: "KR",
    temu: "KR",
    ebay: "US",
  };

  for (const channel of channels) {
    const context = manualContext();
    context.assignments = [{
      ...context.assignments[0],
      channel,
      market: markets[channel],
      categoryId: channel === "elevenst" ? "1341821" : "12345",
    }];
    const target = channel === "shopee"
      ? { targetId: "1719148844", marketCode: "SG", locale: "en-SG", currency: "SGD", label: "Singapore" }
      : channel === "lazada"
        ? { targetId: "MY", marketCode: "MY", locale: "en-MY", currency: "MYR", label: "Malaysia" }
        : channel === "ebay"
          ? { targetId: "EBAY_US", marketCode: "US", locale: "en-US", currency: "USD", label: "United States" }
          : undefined;
    const draft = buildChannelArguments(
      channel,
      context,
      10_000,
      3,
      target,
      { weight: 0.2, length: 10, width: 8, height: 4 },
      10,
    ) as Record<string, unknown>;
    const assets = draft.sellerpilotAssets as Record<string, unknown>;
    assert.equal(assets.contentMode, "manual_mvp", `${channel} content mode`);
    assert.equal(assets.detailAssetMode, "manual_source", `${channel} detail mode`);
    assert.deepEqual(assets.detailImageUrls, assets.galleryImageUrls, `${channel} source images`);
    assert.equal(
      missingNativeValues(channel, draft).some((item) => item.includes("dedicated marketplace detail images")),
      false,
      `${channel} must not require generated AI detail images`,
    );
  }
});

test("Temu draft sends the confirmed leaf ID and blocks until a shipping template is supplied", () => {
  const context = manualContext();
  context.assignments = [{
    ...context.assignments[0],
    channel: "temu",
    market: "KR",
    categoryId: "601099",
    categoryPath: ["Electronics", "Cable organizers"],
  }];
  const draft = buildChannelArguments(
    "temu",
    context,
    5_000,
    1,
    undefined,
    { weight: 0.1, length: 10, width: 8, height: 2 },
    5,
  ) as Record<string, unknown>;
  const body = draft.body as { goodsBasic: Record<string, unknown> };
  assert.equal(body.goodsBasic.extCatName, "601099");
  assert.equal(body.goodsBasic.costTemplate, "");
  assert.equal(missingNativeValues("temu", draft).includes("Temu shipping template"), true);
});

test("Lazada MY existing-product draft replaces the global USD default with the verified 5,000 KRW equivalent", () => {
  const context = manualContext();
  context.manualFields.sellingPrice = 5_000;
  context.manualFields.stock = 1;
  context.manualFields.sellerSku = "QA-20260823-CC-001";
  context.assignments = [{
    ...context.assignments[0],
    channel: "lazada",
    market: "MY",
    categoryId: "10100205",
  }];
  context.localizedListings = [{
    channel: "lazada",
    market: "MY",
    locale: "ms-MY",
    title: "Klip pengurusan kabel pelekat 6 keping",
    shortDescription: "Set klip untuk menyusun kabel dengan kemas di ruang kerja.",
    description: "Set enam klip pelekat untuk membantu menyusun kabel dengan kemas di meja atau ruang kerja.",
    keywords: ["klip kabel", "pengurusan kabel", "ruang kerja"],
    thumbnailAltText: "Set klip pengurusan kabel pelekat 6 keping",
  }];
  context.listings = [{
    id: "22222222-2222-4222-8222-222222222222",
    channel: "lazada",
    market: "MY",
    targetId: "MY",
    remoteId: "14976038919",
    status: "published",
    lastError: null,
    publishedAt: "2026-08-30T00:00:00.000Z",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  }];
  const target = { targetId: "MY", marketCode: "MY", locale: "ms-MY", currency: "MYR", label: "Malaysia" };
  const rate = {
    krwPerMyr: 350,
    fetchedAt: "2026-08-30T05:58:00.000Z",
    asOf: "2026-08-30T05:58:00.000Z",
    source: "Coinbase Data API",
    sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
    frequency: "minute-market" as const,
  };
  const draft = buildChannelArguments(
    "lazada",
    context,
    5_000,
    1,
    target,
    { weight: 0.2, length: 10, width: 8, height: 4 },
    12.9,
    rate,
  ) as Record<string, unknown>;
  const request = draft.request as { Request: { Product: { Skus: { Sku: Array<Record<string, unknown>> } } } };
  assert.equal(request.Request.Product.Skus.Sku[0].price, "14.29");
  assert.deepEqual(draft.sellerpilotLazadaPricePolicy, {
    contract: "lazada_krw_myr_reference_price_v1",
    sourceCurrency: "KRW",
    sourcePriceKrw: 5_000,
    targetCurrency: "MYR",
    targetPriceMyr: 14.29,
    rate,
  });
  assert.equal(missingNativeValues("lazada", draft).includes("verified KRW to MYR price policy"), false);

  const missingRate = buildChannelArguments(
    "lazada",
    context,
    5_000,
    1,
    target,
    { weight: 0.2, length: 10, width: 8, height: 4 },
    12.9,
  ) as Record<string, unknown>;
  assert.equal(missingNativeValues("lazada", missingRate).includes("verified KRW to MYR price policy"), true);
});

test("manual MVP image contract reaches URL validation instead of the AI detail fence", async () => {
  await assert.rejects(
    prepareMarketplaceImages({} as SupabaseClient, "qoo10", {
      sellerpilotAssets: {
        contentMode: "manual_mvp",
        detailAssetMode: "manual_source",
        galleryImageUrls: ["not-a-url"],
        detailImageUrls: ["not-a-url"],
      },
      params: { StandardImage: "not-a-url", ItemDescription: "판매자 확인 설명" },
    }),
    /MARKETPLACE_IMAGE_URL_INVALID/,
  );
});

test("Qoo10 manual MVP accepts and reads back one explicit source detail image", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    calls.push(method);
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: "1234567890" } });
    }
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: { ItemDetail: '<img src="manual.jpg">' } });
    }
    assert.ok(init?.body, `${method} write body`);
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
      arguments: {
        sellerpilotContentMode: "manual_mvp",
        params: {
          SecondSubCat: "320002604",
          ItemTitle: "Manual product",
          StandardImage: "https://example.test/manual.jpg",
          ItemDescription: '<p>Seller verified</p><img src="manual.jpg">',
          RetailPrice: "0",
          ItemPrice: "2500",
          ItemQty: "1",
          ExpireDate: "2027-12-31",
          ShippingNo: "0",
          AvailableDateType: "0",
          AvailableDateValue: "3",
          AudultYN: "N",
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps.at(-1)?.name, "detail-image-readback");
    assert.equal(calls.includes("ItemsBasic.EditGoodsStatus"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual intake route validates preserved photos and the client retries the exact UUID", async () => {
  const [route, studio, page, marketplaceImages] = await Promise.all([
    readFile(new URL("../app/api/admin/products/manual-intake/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/marketplace-images.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /manualProductIntakeJobRequestSchema\.safeParse/);
  assert.match(route, /validatePreservedStudioUploadPaths/);
  assert.match(route, /verifyPreservedStudioImages/);
  assert.match(route, /sellerpilot_create_manual_product_v1/);
  assert.match(route, /cleanupOnlyWhenManualJobIsAbsent/);
  assert.match(studio, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(studio, /persistPendingManualProductRequest\(pending\)[\s\S]{0,1000}enqueueStarted = true/);
  assert.match(studio, /const requestBody = pending\.requestBody/);
  assert.match(studio, /onManualResultReady\?\.\(payload\.productId, jobId, submittedManualFields\)/);
  assert.match(studio, /if \(terminallyRejected\) \{[\s\S]{0,220}clearPendingManualProductRequest\(pending\)/);
  assert.match(page, /setStudioSubmissionMode\("ai"\)/);
  assert.match(page, /sourceResearchJobId=\{sourceResearchJobId\}/);
  assert.match(page, /onManualResultReady=\{\(productId, _jobId, submittedIntake\)/);
  assert.match(page, /onManualResultReady=\{\(productId, _jobId, submittedIntake\)[\s\S]{0,360}onManualProductCreated\(\)/);
  assert.match(page, /onManualProductCreated=\{\(\) => void operations\.reloadAfterMutation\(\)\}/);
  assert.match(marketplaceImages, /uniqueStrings\(manualSourceMode \? gallery : \[\.\.\.gallery, \.\.\.details\]\)/);
  assert.match(marketplaceImages, /if \(!productPatch && index > 0\) product\[field\] = ""/);
  assert.doesNotMatch(route, /sellerpilot_create_ai_job/);
});

test("an ambiguous manual request preserves one canonical body and UUID for the same seller SKU", async () => {
  const fingerprint = await manualProductRequestFingerprint(" manual-0001 ");
  assert.equal(fingerprint, await manualProductRequestFingerprint("MANUAL-0001"));
  assert.notEqual(fingerprint, await manualProductRequestFingerprint("MANUAL-0002"));

  const jobId = "22222222-2222-4222-8222-222222222222";
  const manualFields = {
    ...manualContext().manualFields,
    researchInput: "판매자 확인 원본 상품 설명",
    shippingFeeKrw: 0,
    shippingRule: "무료배송",
    packagingRule: "완충 포장",
    productUrl: "",
    imageRightsConfirmed: true,
    productFactsConfirmed: true,
  };
  const requestBody = JSON.stringify({
    jobId,
    manualFields,
    competitorContext: { query: "", providerStatuses: [], candidates: [] },
    imagePaths: ["owner/job/input/normalized/0.jpg"],
    imageSpecs: [{}],
  });
  const pending = {
    version: 1 as const,
    ownerId: "11111111-1111-4111-8111-111111111111",
    jobId,
    requestFingerprint: fingerprint,
    requestBody,
    createdAt: 1,
  };
  const normalized = normalizePendingManualProductRequest(
    JSON.parse(JSON.stringify(pending)),
    pending.ownerId,
    fingerprint,
  );
  assert.equal(normalized?.jobId, jobId);
  assert.equal(normalized?.requestBody, requestBody);
  assert.equal(
    normalizePendingManualProductRequest(pending, pending.ownerId, await manualProductRequestFingerprint("MANUAL-0002")),
    null,
  );
});

test("channel operations binds request image mode to the server product lineage before claiming an attempt", async () => {
  const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const bindingIndex = route.indexOf("marketplaceContentModeMatchesProduct(contentArguments, contentMode)");
  const claimIndex = route.indexOf("sellerpilot_claim_channel_operation");
  assert.ok(bindingIndex >= 0, "request content mode binding must exist");
  assert.ok(claimIndex > bindingIndex, "content mode mismatch must fail before an idempotency attempt is claimed");
  assert.match(
    route,
    /contentBoundListingOperation = operation === "listing\.create"[\s\S]{0,120}operation === "listing\.update" && isRecord\(parsed\.data\.arguments\.sellerpilotAssets\)/,
  );
  assert.match(route, /prepared\.sellerpilotContentMode = "manual_mvp"/);
  assert.match(route, /delete prepared\.sellerpilotContentMode/);
  assert.match(route, /mode: "product_content_mode_mismatch"/);
});
