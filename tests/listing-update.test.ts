import assert from "node:assert/strict";
import test from "node:test";
import {
  listingCoreContentForOperation,
  listingUpdateRemoteIdentity,
  listingWriteOperation,
  mergeCoupangListingUpdateBody,
  prepareListingUpdateArguments,
  verifyListingUpdateReadback,
} from "../lib/channels/listing-update";

const listing = { status: "published", remoteId: "123456789" };

test("a failed update keeps using update when an earlier publication is proven", () => {
  const failedUpdate = { status: "failed", remoteId: "123456789", publishedAt: "2026-08-24T10:00:00.000Z" };
  assert.equal(listingWriteOperation(failedUpdate), "listing.update");
  assert.equal(listingWriteOperation({ status: "failed", remoteId: "123456789", publishedAt: null }), "listing.create");
  assert.equal(listingWriteOperation({ status: "published", remoteId: "123456789", publishedAt: null }), "listing.update");
  assert.deepEqual(
    prepareListingUpdateArguments("qoo10", { params: { ItemTitle: "재시도" } }, failedUpdate),
    { params: { ItemTitle: "재시도", ItemCode: "123456789" } },
  );
});

test("published updates use the central edited title and description without discarding localized assets", () => {
  assert.deepEqual(listingCoreContentForOperation({
    operation: "listing.update",
    central: { title: "중앙 수정 상품명", description: "중앙에서 사용자가 직접 수정한 상품 설명" },
    localized: { title: "Old localized title", shortDescription: "Old summary", description: "Old description" },
  }), {
    title: "중앙 수정 상품명",
    shortDescription: "중앙에서 사용자가 직접 수정한 상품 설명",
    description: "중앙에서 사용자가 직접 수정한 상품 설명",
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

test("update preparation is idempotent and strips create-only sale, stock, shipping, and policy defaults", () => {
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
    params: { ItemTitle: "수정 상품", ItemDescription: "<p>수정 설명</p>", ItemCode: "123456789" },
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
    request: {
      Request: {
        Product: {
          Attributes: { name: "수정 상품", description: "수정 설명" },
          Images: { Image: ["https://cdn.example.com/hero.jpg"] },
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
  assert.throws(
    () => prepareListingUpdateArguments("elevenst", {}, listing),
    /LISTING_UPDATE_NOT_RELEASED:elevenst/,
  );
});
