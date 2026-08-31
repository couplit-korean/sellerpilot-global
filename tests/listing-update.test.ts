import assert from "node:assert/strict";
import test from "node:test";
import {
  bindQoo10RollbackUpdateRecoveryArguments,
  channelProductEditFieldSupport,
  listingCoreContentForOperation,
  listingUpdateMutablePaths,
  listingUpdateServerCandidate,
  listingUpdateRemoteIdentity,
  listingWriteOperation,
  mergeCoupangListingUpdateBody,
  prepareListingUpdateArguments,
  qoo10RollbackListingUpdateCandidate,
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
  unapprovedLocalizationReviewMarker,
  verifyListingUpdateReadback,
} from "../lib/channels/listing-update";
import { assertListingPublicationSourceLocalized } from "../lib/channels/listing-publication-content";

const listing = {
  status: "published",
  remoteId: "123456789",
  publishedAt: "2026-08-24T10:00:00.000Z",
  requestedPublicationIntent: "live",
  remoteVisibility: "live",
};

test("verified safe drafts and live listings keep using their exact remote identity", () => {
  const failedUpdate = {
    status: "failed",
    remoteId: "123456789",
    publishedAt: "2026-08-24T10:00:00.000Z",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  };
  assert.equal(listingWriteOperation(failedUpdate), "listing.update");
  assert.equal(listingWriteOperation({
    status: "failed",
    remoteId: "unverified-remote-create-123",
    publishedAt: "2026-08-25T10:00:00.000Z",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  }), "listing.update");
  assert.equal(listingWriteOperation({
    status: "paused",
    remoteId: "safe-draft-123",
    publishedAt: null,
    requestedPublicationIntent: "safe_test",
    remoteVisibility: "non_public",
  }), "listing.update");
  assert.equal(listingWriteOperation({
    status: "paused",
    remoteId: "safe-withdrawn-123",
    publishedAt: null,
    requestedPublicationIntent: "safe_test",
    remoteVisibility: "withdrawn",
  }), "listing.update");
});

test("every existing remote identity stays update-only while blocked states are handled by the workbench", () => {
  assert.equal(listingWriteOperation({ status: "failed", remoteId: "123456789", publishedAt: null }), "listing.update");
  assert.equal(listingWriteOperation({ status: "published", remoteId: "123456789", publishedAt: null }), "listing.update");
  for (const remoteVisibility of ["unknown", "pending_review", "rejected"] as const) {
    assert.equal(listingWriteOperation({
      status: remoteVisibility === "rejected" ? "failed" : "paused",
      remoteId: `remote-${remoteVisibility}`,
      publishedAt: null,
      requestedPublicationIntent: remoteVisibility === "pending_review" ? "live" : "safe_test",
      remoteVisibility,
    }), "listing.update", remoteVisibility);
  }
  assert.equal(listingWriteOperation({
    status: "paused",
    remoteId: "unsafe-live-123",
    publishedAt: null,
    requestedPublicationIntent: "safe_test",
    remoteVisibility: "live",
  }), "listing.update");
  assert.equal(listingWriteOperation({
    status: "failed",
    remoteId: null,
    publishedAt: "2026-08-24T10:00:00.000Z",
  }), "listing.create");
});

test("failed verified updates preserve the immutable remote product identity", () => {
  const failedUpdate = {
    status: "failed",
    remoteId: "123456789",
    publishedAt: "2026-08-24T10:00:00.000Z",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  };
  assert.deepEqual(
    prepareListingUpdateArguments("qoo10", { params: { ItemTitle: "재시도" } }, failedUpdate),
    { params: { ItemTitle: "재시도", ItemCode: "123456789" } },
  );
});

test("only the exact rollback-confirmed Qoo10 S1 row becomes an update candidate", () => {
  const rollback = {
    status: "paused",
    remoteId: "1217336970",
    providerStatus: "S1",
    failureClass: "retryable" as const,
    publishedAt: null,
    requestedPublicationIntent: "live",
    remoteVisibility: "non_public",
  };
  assert.equal(qoo10RollbackListingUpdateCandidate("qoo10", rollback), true);
  assert.equal(listingUpdateServerCandidate("qoo10", rollback), true);
  assert.equal(qoo10RollbackListingUpdateCandidate("ebay", rollback), false);
  assert.equal(qoo10RollbackListingUpdateCandidate("qoo10", { ...rollback, providerStatus: "S2" }), false);
  assert.equal(qoo10RollbackListingUpdateCandidate("qoo10", { ...rollback, failureClass: "external_action" }), false);
  assert.equal(qoo10RollbackListingUpdateCandidate("qoo10", { ...rollback, publishedAt: "2026-08-30T00:00:00Z" }), false);
  assert.equal(qoo10RollbackListingUpdateCandidate("qoo10", { ...rollback, remoteVisibility: "unknown" }), false);
  assert.equal(listingUpdateServerCandidate("qoo10", {
    ...rollback,
    failureClass: "external_action",
    providerStatus: null,
    remoteVisibility: "unknown",
  }), false, "an uncertain external_action row is not a generic update candidate");
});

test("Qoo10 rollback updates preserve required carrier fields but keep the existing remote CDN image", () => {
  const params = {
    SecondSubCat: "320002604",
    ItemTitle: "ロールバック確認済み商品",
    ProductionPlaceType: "2",
    ProductionPlace: "KR",
    RetailPrice: "1871",
    ShippingNo: "0",
    AvailableDateType: "0",
    AvailableDateValue: "3",
    StandardImage: "https://source.example.test/representative.jpg",
    ItemDescription: "<p>更新済みの商品説明</p>",
  };
  const rollback = {
    status: "paused",
    remoteId: "1217336970",
    providerStatus: "S1",
    failureClass: "retryable" as const,
    publishedAt: null,
    requestedPublicationIntent: "live",
    remoteVisibility: "non_public",
  };
  const rollbackArguments = prepareListingUpdateArguments("qoo10", { params }, rollback);
  assert.deepEqual(rollbackArguments, {
    params: {
      SecondSubCat: "320002604",
      ItemTitle: "ロールバック確認済み商品",
      ProductionPlaceType: "2",
      ProductionPlace: "KR",
      RetailPrice: "1871",
      ShippingNo: "0",
      AvailableDateType: "0",
      AvailableDateValue: "3",
      ItemDescription: "<p>更新済みの商品説明</p>",
      ItemCode: "1217336970",
    },
  });
  assert.equal(Object.hasOwn(rollbackArguments.params, "StandardImage"), false);
  assert.deepEqual(listingUpdateMutablePaths("qoo10", rollbackArguments), [
    "ItemTitle",
    "ProductionPlaceType",
    "ProductionPlace",
    "ItemDescription",
  ]);

  const publishedArguments = prepareListingUpdateArguments("qoo10", { params }, listing);
  assert.equal((publishedArguments.params as Record<string, unknown>).StandardImage, params.StandardImage);
  assert.equal((publishedArguments.params as Record<string, unknown>).SecondSubCat, params.SecondSubCat);
  assert.equal((publishedArguments.params as Record<string, unknown>).ProductionPlaceType, params.ProductionPlaceType);
  assert.equal((publishedArguments.params as Record<string, unknown>).ProductionPlace, params.ProductionPlace);
  assert.equal((publishedArguments.params as Record<string, unknown>).RetailPrice, params.RetailPrice);
  assert.equal((publishedArguments.params as Record<string, unknown>).ShippingNo, params.ShippingNo);
  assert.equal((publishedArguments.params as Record<string, unknown>).AvailableDateType, params.AvailableDateType);
  assert.equal((publishedArguments.params as Record<string, unknown>).AvailableDateValue, params.AvailableDateValue);
});

test("Qoo10 rollback recovery replaces client shipping with the authoritative remote ShippingNo", () => {
  const authoritativeBinding = {
    status: "allowed" as const,
    contract: qoo10RollbackUpdateRecoveryContract,
    listingId: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    remoteId: "1217336970",
    providerStatus: "S1" as const,
    sourceJobId: "0bc5ff1f-c884-4615-8a79-4688da46af6a",
    expectedState: {
      categoryCode: "320000542",
      retailPriceJpy: 1871,
      sellPriceJpy: 1871,
      quantity: 1,
      shippingNo: "806971",
      biContentsNo: 123456,
    },
  };
  const untrustedClientArguments = {
    [qoo10RollbackUpdateRecoveryArgument]: {
      ...authoritativeBinding,
      expectedState: { ...authoritativeBinding.expectedState, shippingNo: "0" },
    },
    params: {
      ItemCode: "1217336970",
      ItemTitle: "更新商品",
      ShippingNo: "0",
    },
  };

  const bound = bindQoo10RollbackUpdateRecoveryArguments(
    untrustedClientArguments,
    authoritativeBinding,
  );
  assert.equal((bound.params as Record<string, unknown>).ShippingNo, "806971");
  assert.deepEqual(bound[qoo10RollbackUpdateRecoveryArgument], authoritativeBinding);
  assert.equal(untrustedClientArguments.params.ShippingNo, "0", "server binding must not mutate the parsed request");
  assert.equal(
    untrustedClientArguments[qoo10RollbackUpdateRecoveryArgument].expectedState.shippingNo,
    "0",
    "the request-provided marker must remain untrusted and unused",
  );
  assert.throws(
    () => bindQoo10RollbackUpdateRecoveryArguments({}, authoritativeBinding),
    /QOO10_ROLLBACK_RECOVERY_PARAMS_REQUIRED/,
  );
  assert.throws(
    () => bindQoo10RollbackUpdateRecoveryArguments(
      { params: { ShippingNo: "0" } },
      {
        ...authoritativeBinding,
        expectedState: { ...authoritativeBinding.expectedState, shippingNo: "not-a-number" },
      },
    ),
    /QOO10_ROLLBACK_RECOVERY_BINDING_INVALID/,
  );
});

test("published updates preserve the reviewed channel-language title and description", () => {
  assert.deepEqual(listingCoreContentForOperation({
    operation: "listing.update",
    central: { title: "중앙 수정 상품명", description: "중앙에서 사용자가 직접 수정한 상품 설명" },
    localized: { title: "Reviewed localized title", shortDescription: "Reviewed summary", description: "Reviewed description" },
  }), {
    title: "Reviewed localized title",
    shortDescription: "Reviewed summary",
    description: "Reviewed description",
  });
  assert.deepEqual(listingCoreContentForOperation({
    operation: "listing.create",
    central: { title: "중앙 상품명", description: "중앙 설명" },
    localized: { title: "Localized title", shortDescription: "Localized summary", description: "Localized description" },
  }), {
    title: "Localized title",
    shortDescription: "Localized summary",
    description: "Localized description",
  });
  assert.throws(() => listingCoreContentForOperation({
    operation: "listing.update",
    central: { title: "한국 채널 제목", description: "한국 채널 설명" },
  }), /LISTING_UPDATE_LOCALIZED_CONTENT_NOT_APPROVED/);
});

test("updates preserve remote copy when localization is a current marked or legacy romanized fallback", () => {
  const central = {
    title: "부착형 케이블 정리 클립 6개 세트",
    description: "책상과 벽면의 케이블을 정리하는 부착형 클립입니다.",
  };
  assert.throws(() => listingCoreContentForOperation({
    operation: "listing.update",
    central,
    localized: {
      title: `${unapprovedLocalizationReviewMarker} Seller reviewed product`,
      shortDescription: "Seller reviewed product draft",
      description: "This draft requires localization review.",
    },
  }), /LISTING_LOCALIZATION_REVIEW_REQUIRED/);
  assert.throws(() => listingCoreContentForOperation({
    operation: "listing.update",
    central,
    localized: {
      title: "buchakhyeong keibeul jeongri keulrip 6gae seteu - Pre-purchase review",
      shortDescription: "Product information based on reviewed input.",
      description: "buchakhyeong keibeul jeongri keulrip 6gae seteu is shown for review.",
    },
  }), /LISTING_LOCALIZATION_REVIEW_REQUIRED/);
});

test("Shopee SG and Lazada MY update payloads keep their channel-localized copy", () => {
  const shopee = listingCoreContentForOperation({
    operation: "listing.update",
    central: { title: "중앙 상품명", description: "중앙 한국어 설명" },
    localized: {
      title: "Durable cable organizer clips",
      shortDescription: "Easy adhesive cable care",
      description: "Durable cable organizer clips keep charging cables tidy with an easy adhesive design.",
    },
  });
  const shopeePayload = {
    publish: { item: { item_name: shopee.title, description: shopee.description } },
  };
  assert.equal(assertListingPublicationSourceLocalized({
    channel: "shopee",
    expectedLocale: "en-SG",
    sourceArguments: shopeePayload,
  }).title, "Durable cable organizer clips");

  const lazada = listingCoreContentForOperation({
    operation: "listing.update",
    central: { title: "중앙 상품명", description: "중앙 한국어 설명" },
    localized: {
      title: "Klip kabel tahan lama",
      shortDescription: "Kabel kekal kemas",
      description: "Klip kabel yang tahan lama memastikan kabel kekal kemas dengan reka bentuk pelekat yang mudah digunakan.",
    },
  });
  const lazadaPayload = {
    request: { Request: { Product: { Attributes: { name: lazada.title, description: lazada.description } } } },
  };
  assert.equal(assertListingPublicationSourceLocalized({
    channel: "lazada",
    expectedLocale: "ms-MY",
    sourceArguments: lazadaPayload,
  }).title, "Klip kabel tahan lama");
});

test("published listing update drafts bind the immutable remote product identity", () => {
  assert.deepEqual(
    prepareListingUpdateArguments("qoo10", { params: { ItemTitle: "수정 상품" } }, listing),
    { params: { ItemTitle: "수정 상품", ItemCode: "123456789" } },
  );
  assert.deepEqual(
    prepareListingUpdateArguments("coupang", { body: { sellerProductName: "수정 상품", deliveryCharge: 0, requested: false } }, listing),
    { body: { sellerProductName: "수정 상품", sellerProductId: 123456789 } },
  );
  assert.deepEqual(
    prepareListingUpdateArguments("smartstore", { body: { originProduct: { name: "수정 상품", salePrice: 1000 }, smartstoreChannelProduct: { channelProductName: "수정 상품", channelProductDisplayStatusType: "ON" } } }, listing),
    {
      body: {
        originProduct: { name: "수정 상품" },
        smartstoreChannelProduct: { channelProductName: "수정 상품" },
      },
      originProductNo: "123456789",
    },
  );
});

test("the server-side update identity reader rejects missing or conflicting remote IDs", () => {
  assert.equal(listingUpdateRemoteIdentity("qoo10", { params: { ItemCode: "123" } }), "123");
  assert.equal(listingUpdateRemoteIdentity("lazada", { itemId: 456 }), "456");
  assert.equal(listingUpdateRemoteIdentity("coupang", { body: { sellerProductId: 789 } }), "789");
  assert.equal(listingUpdateRemoteIdentity("smartstore", { originProductNo: "999" }), "999");
  assert.equal(listingUpdateRemoteIdentity("shopee", { localItemId: "101", body: { item_id: 101 } }), "101");
  assert.throws(() => listingUpdateRemoteIdentity("shopee", { localItemId: "101", body: { item_id: 102 } }), /IDENTITY_MISMATCH/);
  assert.throws(() => listingUpdateRemoteIdentity("shopee", { itemId: "101", body: { item_id: 101 } }), /LOCAL_ITEM_ID_REQUIRED/);
  assert.throws(() => listingUpdateRemoteIdentity("shopee", { localItemId: "101", globalItemId: "101", body: { item_id: 101 } }), /LOCAL_ITEM_ID_REQUIRED/);
  assert.throws(() => listingUpdateRemoteIdentity("qoo10", { params: {} }), /IDENTITY_REQUIRED/);
});

test("Shopee update uses the published local item body instead of the global create body", () => {
  assert.deepEqual(prepareListingUpdateArguments("shopee", {
    globalProduct: true,
    shopId: "456",
    body: { global_item_name: "글로벌 원본" },
    publish: { item: { item_name: "현지 수정 상품", description: "현지 설명" } },
  }, listing), {
    shopId: "456",
    localItemId: "123456789",
    body: { item_name: "현지 수정 상품", description: "현지 설명", item_id: 123456789 },
  });
});

test("update preparation is idempotent and only retains channel fields with verified update contracts", () => {
  const createDraft = {
    sellerpilotAssets: { galleryImageUrls: ["https://cdn.example.com/hero.jpg"] },
    body: {
      sellerProductName: "수정 상품",
      deliveryChargeType: "FREE",
      outboundShippingPlaceCode: 9988,
      returnCenterCode: "return-center",
      saleStartedAt: "2026-01-01",
      requested: true,
      items: [{
        externalVendorSku: "SKU-1",
        itemName: "수정 옵션",
        salePrice: 1000,
        maximumBuyCount: 999,
        outboundShippingTimeDay: 1,
        images: [{ vendorPath: "https://cdn.example.com/hero.jpg" }],
      }],
    },
  };
  const once = prepareListingUpdateArguments("coupang", createDraft, listing);
  const twice = prepareListingUpdateArguments("coupang", once, listing);
  assert.deepEqual(twice, once);
  assert.deepEqual(once, {
    sellerpilotAssets: createDraft.sellerpilotAssets,
    body: {
      sellerProductName: "수정 상품",
      sellerProductId: 123456789,
      items: [{
        itemName: "수정 옵션",
        images: [{ vendorPath: "https://cdn.example.com/hero.jpg" }],
        sellerpilotItemMatchId: "SKU-1",
      }],
    },
  });

  assert.deepEqual(prepareListingUpdateArguments("qoo10", {
    params: {
      ItemTitle: "수정 상품",
      ItemDescription: "<p>수정 설명</p>",
      ItemPrice: "1000",
      ItemQty: "999",
      ShippingNo: "0",
      ExpireDate: "20991231",
    },
  }, listing), {
    params: { ItemTitle: "수정 상품", ItemDescription: "<p>수정 설명</p>", ShippingNo: "0", ItemCode: "123456789" },
  });

  assert.deepEqual(prepareListingUpdateArguments("lazada", {
    request: {
      Request: {
        Product: {
          PrimaryCategory: "1001",
          Attributes: { name: "수정 상품", description: "수정 설명" },
          Images: { Image: ["https://cdn.example.com/hero.jpg"] },
          Skus: { Sku: [{ SellerSku: "SKU-1", price: "1.00", quantity: "999", Status: "active" }] },
        },
      },
    },
  }, listing), {
    itemId: "123456789",
    sellerpilotExpectedSellerSkus: ["SKU-1"],
    request: {
      Request: {
        Product: {
          PrimaryCategory: "1001",
          Attributes: { name: "수정 상품", description: "수정 설명" },
          Images: { Image: ["https://cdn.example.com/hero.jpg"] },
          Skus: { Sku: [{ SellerSku: "SKU-1", price: "1.00", quantity: "999" }] },
        },
      },
    },
  });
});

test("Coupang read-before-write merge preserves remote commerce policy fields", () => {
  const merged = mergeCoupangListingUpdateBody({
    sellerProductId: 123456789,
    sellerProductName: "기존 상품",
    deliveryChargeType: "CONDITIONAL_FREE",
    outboundShippingPlaceCode: 9988,
    returnCenterCode: "return-center",
    requested: true,
    items: [{
      vendorItemId: 77,
      externalVendorSku: "SKU-1",
      itemName: "기존 옵션",
      salePrice: 12_340,
      maximumBuyCount: 3,
      outboundShippingTimeDay: 5,
    }],
  }, {
    sellerProductId: 123456789,
    sellerProductName: "수정 상품",
    items: [{ sellerpilotItemMatchId: "SKU-1", itemName: "수정 옵션" }],
  });
  assert.deepEqual(merged, {
    sellerProductId: 123456789,
    sellerProductName: "수정 상품",
    deliveryChargeType: "CONDITIONAL_FREE",
    outboundShippingPlaceCode: 9988,
    returnCenterCode: "return-center",
    requested: true,
    items: [{
      vendorItemId: 77,
      externalVendorSku: "SKU-1",
      itemName: "수정 옵션",
      salePrice: 12_340,
      maximumBuyCount: 3,
      outboundShippingTimeDay: 5,
    }],
  });
});

test("normalized update readback rejects unchanged requested mutable fields", () => {
  const argumentsValue = prepareListingUpdateArguments("smartstore", {
    body: { originProduct: { name: "수정 상품", detailContent: "<p>새 설명</p>", salePrice: 1000 } },
  }, listing);
  assert.deepEqual(verifyListingUpdateReadback("smartstore", argumentsValue, {
    originProduct: { name: "수정 상품", detailContent: "<p>새 설명</p>", salePrice: 55_000 },
  }), { ok: true, mismatches: [] });
  const mismatch = verifyListingUpdateReadback("smartstore", argumentsValue, {
    originProduct: { name: "기존 상품", detailContent: "<p>새 설명</p>", salePrice: 55_000 },
  });
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.mismatches, ["originProduct.name"]);
});

test("Lazada update keeps the verified XML request and adds a readback identity", () => {
  const request = { Request: { Product: { Attributes: { name: "수정 상품" } } } };
  assert.deepEqual(
    prepareListingUpdateArguments("lazada", { request, country: "my" }, listing),
    { request, country: "my", itemId: "123456789" },
  );
});

test("Lazada MY QA update retains the exact category and requested single-SKU price and stock contract", () => {
  const prepared = prepareListingUpdateArguments("lazada", {
    country: "my",
    sellerpilotLazadaPricePolicy: {
      contract: "lazada_krw_myr_reference_price_v1",
      sourceCurrency: "KRW",
      sourcePriceKrw: 5_000,
      targetCurrency: "MYR",
      targetPriceMyr: 14.29,
      rate: {
        krwPerMyr: 350,
        fetchedAt: "2026-08-30T00:00:00.000Z",
        asOf: "2026-08-30T00:00:00.000Z",
        source: "Coinbase Data API",
        sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
        frequency: "minute-market",
      },
    },
    request: {
      Request: {
        Product: {
          PrimaryCategory: "10100205",
          Attributes: {
            name: "Klip pengurusan kabel pelekat, set 6 unit",
            description: "Penerangan produk dalam Bahasa Melayu.",
          },
          Images: { Image: ["https://cdn.example.com/representative.jpg"] },
          Skus: { Sku: [{
            SellerSku: "QA-20260823-CC-001-MY",
            price: "14.29",
            quantity: "1",
            package_weight: "0.1",
            Status: "active",
          }] },
        },
      },
    },
  }, { ...listing, remoteId: "14976038919" });
  assert.equal(prepared.itemId, "14976038919");
  assert.deepEqual(prepared.sellerpilotLazadaPricePolicy, {
    contract: "lazada_krw_myr_reference_price_v1",
    sourceCurrency: "KRW",
    sourcePriceKrw: 5_000,
    targetCurrency: "MYR",
    targetPriceMyr: 14.29,
    rate: {
      krwPerMyr: 350,
      fetchedAt: "2026-08-30T00:00:00.000Z",
      asOf: "2026-08-30T00:00:00.000Z",
      source: "Coinbase Data API",
      sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
      frequency: "minute-market",
    },
  });
  assert.deepEqual(prepared.request, {
    Request: {
      Product: {
        PrimaryCategory: "10100205",
        Attributes: {
          name: "Klip pengurusan kabel pelekat, set 6 unit",
          description: "Penerangan produk dalam Bahasa Melayu.",
        },
        Images: { Image: ["https://cdn.example.com/representative.jpg"] },
        Skus: { Sku: [{
          SellerSku: "QA-20260823-CC-001-MY",
          price: "14.29",
          quantity: "1",
        }] },
      },
    },
  });
  const support = channelProductEditFieldSupport("lazada");
  assert.equal(support.price.state, "supported");
  assert.equal(support.price.operation, "listing.update");
  assert.equal(support.inventory.state, "supported");
  assert.equal(support.inventory.operation, "listing.update");
});

test("unpublished, identity-less, and unreleased update targets are blocked", () => {
  assert.throws(
    () => prepareListingUpdateArguments("qoo10", {}, { status: "draft", remoteId: "123" }),
    /PUBLISHED_REMOTE_LISTING_REQUIRED/,
  );
  assert.throws(
    () => prepareListingUpdateArguments("qoo10", {}, { status: "published", remoteId: null }),
    /PUBLISHED_REMOTE_LISTING_REQUIRED/,
  );
  assert.throws(
    () => prepareListingUpdateArguments("temu", {}, listing),
    /LISTING_UPDATE_NOT_RELEASED:temu/,
  );
  assert.deepEqual(
    prepareListingUpdateArguments("elevenst", { product: { prdNm: "수정 상품" } }, listing),
    { productNo: "123456789", productPatch: { prdNm: "수정 상품" } },
  );
});
