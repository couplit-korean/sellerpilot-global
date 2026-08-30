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
import { executeChannelOperation } from "../lib/channels/operations";
import { listingPublicationLanguageVerified } from "../lib/channels/listing-publication-content";

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

test("Qoo10 repairs only the exact legacy reviewed Japanese fallback title", () => {
  const context = manualContext();
  context.manualFields.productName = "부착형 케이블 정리 클립 6개 세트";
  context.localizedListings = [{
    channel: "qoo10",
    market: "JP",
    locale: "ja-JP",
    title: "buchakhyeong keibeul jeongri keulrip 6gae seteu - 購入前確認",
    shortDescription: "販売者が確認した商品案内です。",
    description: "日本のお客様向けに、販売者が確認した商品名、販売構成、価格、在庫、配送条件をご案内します。購入前に実物の商品と包装表示を再確認してください。",
    keywords: ["ケーブル", "整理", "クリップ"],
  }];
  const draft = buildChannelArguments(
    "qoo10",
    context,
    10_000,
    3,
    undefined,
    { weight: 0.2, length: 10, width: 8, height: 4 },
    10,
  ) as { params: { ItemTitle: string } };

  assert.equal(
    draft.params.ItemTitle,
    "貼り付け式ケーブル整理クリップ6個セット",
  );
  assert.equal(listingPublicationLanguageVerified("ja-JP", draft.params.ItemTitle, "title"), true);
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
  const bindingIndex = route.indexOf("marketplaceContentModeMatchesProduct(parsed.data.arguments, contentMode)");
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
