import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeChannelKeys } from "../lib/channels/catalog";
import { remoteEditMutationId } from "../app/product-publish-workbench";
import { emptyProductIntake } from "../lib/product-intake";
import {
  centralProductEditFieldSupport,
  channelProductEditFieldSupport,
  listingUpdateMutablePaths,
  legacyEbayListingUpdateCandidate,
  prepareListingUpdateArguments,
  productEditRemotePlan,
  qoo10RollbackListingUpdateCandidate,
  remoteProductEditIdempotencyKey,
} from "../lib/channels/listing-update";
import { lazadaRequestedUpdateQuantity } from "../lib/channels/lazada-listing-update";
import { channelOperationAvailable, channelOperationRelease } from "../lib/channels/operation-availability";

const publishedListing = {
  status: "published",
  remoteId: "987654321",
  publishedAt: "2026-08-25T00:00:00Z",
  requestedPublicationIntent: "live",
  remoteVisibility: "live",
};

test("중앙 편집과 원격 편집의 실제 지원 필드를 분리한다", () => {
  const central = centralProductEditFieldSupport();
  assert.equal(central.productName.state, "supported");
  assert.equal(central.saleConfiguration.state, "supported");
  assert.deepEqual(central.saleConfiguration.writablePaths, ["packageContents"]);
  assert.equal(central.price.state, "supported");
  assert.equal(central.inventory.state, "supported");
  assert.equal(central.options.state, "blocked");
  assert.equal(central.images.state, "blocked");
  const centrallyWritableFields = new Set(Object.values(central).flatMap((field) => field.writablePaths));
  assert.deepEqual(
    [...centrallyWritableFields].sort(),
    Object.keys(emptyProductIntake).sort(),
    "이미지 리비전과 별도 옵션 원장을 제외한 등록 입력값은 중앙 전체 수정에서 모두 보존되어야 합니다.",
  );

  for (const channel of ["qoo10", "shopee", "lazada", "coupang", "smartstore"] as const) {
    const remote = channelProductEditFieldSupport(channel);
    assert.equal(remote.productName.state, "supported", channel);
    assert.equal(remote.description.state, "supported", channel);
    assert.equal(remote.images.state, "supported", channel);
    assert.equal(remote.requiredInformation.state, "partial", channel);
    assert.equal(remote.options.state, "blocked", channel);
    assert.equal(remote.saleConfiguration.state, "blocked", channel);
    assert.equal(
      remote.price.state,
      channel === "lazada" || channel === "smartstore" ? "supported" : "blocked",
      channel,
    );
    assert.equal(remote.inventory.state, "supported", channel);
  }

  assert.equal(channelProductEditFieldSupport("temu").productName.state, "blocked");
  assert.equal(channelProductEditFieldSupport("temu").inventory.state, "supported");
  assert.equal(channelProductEditFieldSupport("ebay").inventory.state, "blocked");
  assert.match(channelProductEditFieldSupport("ebay").inventory.reason, /SKU/);
  assert.equal(channelProductEditFieldSupport("elevenst").productName.state, "supported");
  assert.equal(channelProductEditFieldSupport("elevenst").requiredInformation.state, "partial");
  assert.equal(channelProductEditFieldSupport("elevenst").inventory.state, "blocked");
});

test("가격 readback이 없는 채널은 API 구현 유무와 무관하게 출시 차단한다", () => {
  for (const channel of activeChannelKeys) {
    assert.equal(channelOperationAvailable(channel, "price.update"), false, channel);
    assert.equal(channelOperationRelease(channel, "price.update").available, false, channel);
  }
  assert.match(channelOperationRelease("qoo10", "price.update").reason, /가격|readback/);
  assert.equal(channelOperationRelease("temu", "listing.update").mode, "release_verification_required");
  assert.equal(channelOperationRelease("ebay", "listing.update").available, true);
  assert.equal(channelOperationAvailable("ebay", "listing.stop"), false);
  assert.match(channelOperationRelease("ebay", "listing.stop").reason, /offer ID|listing ID/);
});

test("중앙 저장과 원격 전체 수정의 수동 반영 필드를 구조적으로 구분한다", () => {
  const qoo10 = productEditRemotePlan("qoo10", channelOperationAvailable("qoo10", "listing.update"));
  assert.equal(qoo10.state, "verified_partial_remote_update_available");
  assert.equal(qoo10.centralWrite, "separate");
  assert.equal(qoo10.remoteWrite, "not_automatic");
  assert.equal(qoo10.manualRequired, true);
  assert.deepEqual(qoo10.partiallyWritableFields, ["requiredInformation"]);
  assert.deepEqual(qoo10.manualFields, ["options", "saleConfiguration", "requiredInformation", "price"]);
  assert.match(qoo10.message, /중앙 원장|수동 반영/);

  const temu = productEditRemotePlan("temu", channelOperationAvailable("temu", "listing.update"));
  assert.equal(temu.state, "manual_external_update_required");
  assert.equal(temu.listingUpdateAvailable, false);
  assert.equal(temu.manualRequired, true);
  assert.match(temu.message, /원격 상품 쓰기를 실행하지 않습니다/);
  assert.match(temu.message, /외부 채널 수동 반영/);
  const ebay = productEditRemotePlan("ebay", channelOperationAvailable("ebay", "listing.update"));
  assert.equal(ebay.state, "verified_partial_remote_update_available");
  assert.equal(ebay.listingUpdateAvailable, true);
  assert.deepEqual(ebay.remotelyWritableFields, ["productName", "description", "images"]);
  assert.deepEqual(ebay.partiallyWritableFields, ["requiredInformation"]);
  const elevenst = productEditRemotePlan("elevenst", channelOperationAvailable("elevenst", "listing.update"));
  assert.equal(elevenst.state, "verified_partial_remote_update_available");
  assert.equal(elevenst.listingUpdateAvailable, true);
  assert.deepEqual(elevenst.remotelyWritableFields, ["productName", "description", "images"]);
  assert.deepEqual(elevenst.partiallyWritableFields, ["requiredInformation"]);
  assert.deepEqual(productEditRemotePlan("temu", false).remotelyWritableFields, ["inventory"]);
  assert.deepEqual(productEditRemotePlan("ebay", false).remotelyWritableFields, ["productName", "description", "images"]);
});

test("11번가는 전체 원본 patch를 만들고 eBay는 listing ID와 안전한 콘텐츠 patch만 고정한다", () => {
  assert.deepEqual(
    prepareListingUpdateArguments("elevenst", {
      product: { prdNm: "수정 상품", htmlDetail: "<p>수정 설명</p>", selPrc: "999999", prdSelQty: "999" },
    }, publishedListing),
    {
      productNo: publishedListing.remoteId,
      productPatch: { prdNm: "수정 상품", htmlDetail: "<p>수정 설명</p>" },
    },
  );
  assert.throws(
    () => prepareListingUpdateArguments("temu", { body: { title: "수정 상품" } }, publishedListing),
    /LISTING_UPDATE_NOT_RELEASED:temu/,
  );
  assert.deepEqual(
    prepareListingUpdateArguments("ebay", {
      sku: "SELLERPILOT-001",
      offer: {
        sku: "SELLERPILOT-001",
        marketplaceId: "EBAY_US",
        listingDescription: "<p>수정 설명</p>",
        listingPolicies: {
          fulfillmentPolicyId: "fulfillment-1",
          paymentPolicyId: "payment-1",
          returnPolicyId: "return-1",
        },
        merchantLocationKey: "seoul-warehouse",
      },
    }, publishedListing),
    {
      listingId: publishedListing.remoteId,
      offer: {
        listingDescription: "<p>수정 설명</p>",
      },
    },
  );
});

test("읽기 전용 불변 결속을 마친 legacy eBay 행만 서버 재검증 후보가 된다", () => {
  const legacy = {
    status: "failed",
    remoteId: "800551945442",
    marketplaceSku: "QA-20260823-CC-001-US",
    failureClass: "external_action" as const,
    publishedAt: null,
    requestedPublicationIntent: "live",
    remoteVisibility: "unknown",
  };
  assert.equal(legacyEbayListingUpdateCandidate("ebay", legacy), true);
  assert.equal(legacyEbayListingUpdateCandidate("qoo10", legacy), false);
  assert.equal(legacyEbayListingUpdateCandidate("ebay", { ...legacy, marketplaceSku: null }), false);
  assert.equal(legacyEbayListingUpdateCandidate("ebay", { ...legacy, remoteVisibility: "live" }), false);
  assert.deepEqual(
    prepareListingUpdateArguments("ebay", {
      inventoryItem: { product: { title: "Adhesive cable clips", imageUrls: ["https://example.com/clip.jpg"] } },
    }, legacy),
    {
      listingId: legacy.remoteId,
      inventoryItem: { product: { title: "Adhesive cable clips", imageUrls: ["https://example.com/clip.jpg"] } },
    },
  );
});

test("Qoo10 rollback-confirmed 후보는 이미지 재업로드 없이 UpdateGoods 필수값을 보존한다", () => {
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
  const prepared = prepareListingUpdateArguments("qoo10", {
    params: {
      SecondSubCat: "320002604",
      ItemTitle: "更新商品",
      ProductionPlaceType: "2",
      ProductionPlace: "KR",
      RetailPrice: "1871",
      ShippingNo: "0",
      AvailableDateType: "0",
      AvailableDateValue: "3",
      StandardImage: "https://source.example.test/item.jpg",
      ItemDescription: "<p>更新説明</p>",
    },
  }, rollback);
  assert.deepEqual(prepared.params, {
    SecondSubCat: "320002604",
    ItemTitle: "更新商品",
    ProductionPlaceType: "2",
    ProductionPlace: "KR",
    RetailPrice: "1871",
    ShippingNo: "0",
    AvailableDateType: "0",
    AvailableDateValue: "3",
    ItemDescription: "<p>更新説明</p>",
    ItemCode: "1217336970",
  });
});

test("상품 수정 payload는 원격 identity를 고정하고 Lazada 단일 SKU 외 가격·재고·옵션을 제거한다", () => {
  const qoo10 = prepareListingUpdateArguments("qoo10", {
    params: {
      ItemTitle: "수정 상품",
      ItemDescription: '<p>수정 설명</p><img src="1"><img src="2"><img src="3"><img src="4">',
      ItemPrice: "999999",
      ItemQty: "999",
      AdditionalOption: "unsafe-option",
    },
  }, publishedListing);
  assert.equal((qoo10.params as Record<string, unknown>).ItemCode, publishedListing.remoteId);
  assert.equal(Object.hasOwn(qoo10.params as object, "ItemPrice"), false);
  assert.equal(Object.hasOwn(qoo10.params as object, "ItemQty"), false);
  assert.equal(Object.hasOwn(qoo10.params as object, "AdditionalOption"), false);
  assert.deepEqual(listingUpdateMutablePaths("qoo10", qoo10), ["ItemTitle", "ItemDescription"]);

  const shopee = prepareListingUpdateArguments("shopee", {
    body: {
      item_name: "수정 상품",
      description: "수정 설명",
      original_price: 999999,
      seller_stock: [{ stock: 999 }],
      item_sku: "unsafe-new-sku",
      model: [{ model_id: 7 }],
    },
  }, publishedListing);
  const shopeeBody = shopee.body as Record<string, unknown>;
  assert.equal(shopeeBody.item_id, 987654321);
  assert.equal(Object.hasOwn(shopeeBody, "original_price"), false);
  assert.equal(Object.hasOwn(shopeeBody, "seller_stock"), false);
  assert.equal(Object.hasOwn(shopeeBody, "item_sku"), false);
  assert.equal(Object.hasOwn(shopeeBody, "model"), false);

  const lazada = prepareListingUpdateArguments("lazada", {
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
    request: { Request: { Product: {
      PrimaryCategory: "10100205",
      Attributes: { name: "수정 상품" },
      Images: { Image: ["https://images.example.test/1.jpg"] },
      Skus: { Sku: [{ SellerSku: "QA-20260823-CC-001-MY", price: "14.29", quantity: "1" }] },
    } } },
  }, publishedListing);
  const lazadaProduct = (((lazada.request as Record<string, unknown>).Request as Record<string, unknown>).Product as Record<string, unknown>);
  assert.deepEqual(lazadaProduct.Skus, {
    Sku: [{ SellerSku: "QA-20260823-CC-001-MY", price: "14.29", quantity: "1" }],
  });
  assert.equal(lazadaRequestedUpdateQuantity(lazada), 1);
  assert.deepEqual(listingUpdateMutablePaths("lazada", lazada), [
    "PrimaryCategory",
    "Attributes.name",
    "Images.Image[0]",
    "Skus.Sku[0].SellerSku",
    "Skus.Sku[0].price",
    "Skus.Sku[0].quantity",
  ]);

  const coupang = prepareListingUpdateArguments("coupang", {
    body: {
      sellerProductName: "수정 상품",
      saleStartedAt: "unsafe",
      items: [{ modelNo: "MATCH-1", itemName: "수정 상품", salePrice: 10, originalPrice: 10, maximumBuyCount: 999 }],
    },
  }, publishedListing);
  const coupangBody = coupang.body as Record<string, unknown>;
  const coupangItem = (coupangBody.items as Array<Record<string, unknown>>)[0];
  assert.equal(Object.hasOwn(coupangBody, "saleStartedAt"), false);
  assert.equal(Object.hasOwn(coupangItem, "salePrice"), false);
  assert.equal(Object.hasOwn(coupangItem, "originalPrice"), false);
  assert.equal(Object.hasOwn(coupangItem, "maximumBuyCount"), false);

  const smartstore = prepareListingUpdateArguments("smartstore", {
    body: {
      originProduct: {
        name: "수정 상품",
        detailContent: "수정 설명",
        salePrice: 999999,
        stockQuantity: 999,
        detailAttribute: { originAreaInfo: { originAreaCode: "04" }, optionInfo: { optionSimple: [] } },
      },
      smartstoreChannelProduct: { channelProductName: "수정 상품", channelProductDisplayStatusType: "OFF" },
    },
  }, publishedListing);
  const smartstoreBody = smartstore.body as Record<string, unknown>;
  const originProduct = smartstoreBody.originProduct as Record<string, unknown>;
  assert.equal(originProduct.salePrice, 999999);
  assert.equal(originProduct.stockQuantity, 999);
  assert.equal(Object.hasOwn(originProduct.detailAttribute as object, "optionInfo"), false);
  assert.deepEqual(smartstoreBody.smartstoreChannelProduct, { channelProductName: "수정 상품" });
});

test("같은 mutationId 재시도는 동일한 원격 멱등키를 사용한다", () => {
  const input = {
    productId: "11111111-1111-4111-8111-111111111111",
    listingId: "22222222-2222-4222-8222-222222222222",
    mutationId: "33333333-3333-4333-8333-333333333333",
  };
  const first = remoteProductEditIdempotencyKey(input);
  assert.equal(first, remoteProductEditIdempotencyKey({ ...input }));
  assert.notEqual(first, remoteProductEditIdempotencyKey({ ...input, mutationId: "44444444-4444-4444-8444-444444444444" }));
  assert.ok(first.length >= 16 && first.length <= 160);
});

test("동일한 편집 계약은 안정적인 UUID mutationId를 만들고 변경된 계약은 분리한다", async () => {
  const contract = { listingId: "listing-1", title: "수정 상품", retryGeneration: "attempt-1" };
  const first = await remoteEditMutationId(contract);
  const second = await remoteEditMutationId({ ...contract });
  const changed = await remoteEditMutationId({ ...contract, title: "다른 상품" });

  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(second, first);
  assert.notEqual(changed, first);
});

test("전용 route는 원장 listing ID와 bounded 재시도 경로만 generic gateway에 전달한다", () => {
  const source = readFileSync(new URL("../app/api/admin/products/[id]/remote-edit/route.ts", import.meta.url), "utf8");
  const centralSaveRoute = readFileSync(new URL("../app/api/admin/products/[id]/publish-context/route.ts", import.meta.url), "utf8");
  const workbench = readFileSync(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
  assert.match(source, /context: \{ params: Promise<\{ id: string \}> \}/);
  assert.match(source, /listingRecords\(loaded\.context\.listings\)\.find\(\(item\) => item\.id === body\.data\.listingId\)/);
  assert.match(source, /remoteProductEditIdempotencyKey/);
  assert.match(source, /new URL\("\/api\/admin\/channel-operations", request\.url\)/);
  assert.match(source, /AbortSignal\.timeout\(58_000\)/);
  assert.match(source, /operation: z\.literal\("listing\.update"\)/);
  assert.doesNotMatch(source, /z\.enum\(\["listing\.update", "price\.update"\]\)/);
  assert.doesNotMatch(source, /randomUUID/);
  assert.doesNotMatch(source, /operation:\s*"price\.update" as const/);
  assert.match(source, /productEditRemotePlan/);
  assert.match(source, /lazadaKrwMyrPricePolicyFromArguments/);
  assert.match(source, /sourceCurrency !== lazadaPricePolicy\.sourceCurrency/);
  assert.match(source, /requestedStock !== sourceStock/);
  assert.match(source, /const price = lazadaPricePolicy\?\.targetPriceMyr \?\? listingPrice/);
  assert.match(source, /requestedPublicationIntent:[\s\S]*remoteVisibility:/);
  assert.match(source, /providerStatus: typeof listing\.providerStatus === "string"/);
  const qooCandidateCheck = source.indexOf("qoo10RollbackListingUpdateCandidate(listing.channel, reference)");
  const qooIdentityRpc = source.indexOf('"sellerpilot_service_get_qoo10_rollback_update_identity"');
  const prepareUpdate = source.indexOf("prepareListingUpdateArguments(listing.channel");
  const authoritativeShippingNoBinding = source.indexOf(
    "argumentsValue = bindQoo10RollbackUpdateRecoveryArguments(",
  );
  const operationRequest = source.indexOf("const operationRequest = {");
  assert.ok(qooCandidateCheck >= 0);
  assert.ok(qooIdentityRpc > qooCandidateCheck);
  assert.ok(prepareUpdate > qooIdentityRpc, "Qoo10 rollback identity must be confirmed before update preparation");
  assert.ok(authoritativeShippingNoBinding > prepareUpdate, "the remote-edit proxy must replace client ShippingNo after normalization");
  assert.ok(operationRequest > authoritativeShippingNoBinding, "only the server-bound remote ShippingNo may reach the channel operation route");
  assert.match(source, /qoo10_create_rollback_confirmation_v1/);
  assert.match(source, /identity\.data\.listingId !== listing\.id/);
  assert.match(source, /identity\.data\.remoteId !== reference\.remoteId/);
  assert.match(source, /boundQoo10RollbackUpdateRecovery = identity\.data/);
  assert.match(source, /mode: "qoo10_rollback_identity_required"/);
  const legacyCandidateCheck = source.indexOf("legacyEbayListingUpdateCandidate(listing.channel, reference)");
  const immutableIdentityRpc = source.indexOf('"sellerpilot_service_get_ebay_listing_update_identity"');
  const executionBlock = source.indexOf("listingExecutionBlock(listing, verifiedLegacyEbayUpdate)");
  assert.ok(legacyCandidateCheck >= 0);
  assert.ok(immutableIdentityRpc > legacyCandidateCheck);
  assert.ok(executionBlock > immutableIdentityRpc, "the external_action fence may open only after the server-owned immutable identity RPC");
  assert.match(source, /identity\.listingId === reference\.remoteId/);
  assert.match(source, /identity\.sku === reference\.marketplaceSku/);
  assert.match(source, /identity\.marketplaceId === String\(listing\.targetId \?\? ""\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(source, /\["published", "paused", "failed"\]\.includes\(status\)/);
  assert.match(source, /centralWritePerformed:\s*false/);
  assert.match(source, /remoteWritePerformed:\s*false/);
  assert.match(source, /manualRequired:\s*true/);
  assert.match(centralSaveRoute, /centralSaved:\s*true/);
  assert.match(centralSaveRoute, /centralSaveScope:\s*"product_details_without_inventory"/);
  assert.match(centralSaveRoute, /inventoryWritePerformed:\s*false/);
  assert.match(centralSaveRoute, /remoteWritePerformed:\s*false/);
  assert.match(centralSaveRoute, /remoteUpdateStatus:\s*"not_attempted"/);
  assert.match(centralSaveRoute, /외부 판매채널 수정은 자동 실행하지 않았으며/);
  assert.match(workbench, /fetch\(`\/api\/admin\/products\/\$\{requestedProductId\}\/remote-edit`/);
  assert.match(workbench, /listingId: listing\.id/);
  assert.match(workbench, /mutationId: await remoteEditMutationId\(mutationContract\)/);
  assert.match(workbench, /className="remote-edit-support"/);
  assert.match(workbench, /remote-edit-support-reason/);
  assert.match(workbench, /중앙 저장 · 외부채널 수동 반영 필요/);
  assert.match(workbench, /operationRelease\.reason/);
  assert.match(workbench, /productEditRemotePlan\(channel, operationAvailable\)/);
  assert.match(workbench, /channelTargetOptionValue\(item\)/);
  assert.match(workbench, /providerStatus\?: string \| null/);
  assert.match(workbench, /qoo10RollbackListingUpdateCandidate\(channel, listing\)/);
  assert.match(workbench, /failureClass === "external_action" && !recoverableEbayUpdate/);
  assert.doesNotMatch(workbench, /failureClass === "external_action" && !recoverableEbayUpdate && !recoverableQoo10RollbackUpdate/);
  const channelOperations = readFileSync(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  assert.match(channelOperations, /boundListingCurrency = policy\.targetCurrency/);
  assert.match(channelOperations, /boundListingPrice = policy\.targetPriceMyr/);
  assert.match(channelOperations, /requestedStock !== centralStock/);
});
