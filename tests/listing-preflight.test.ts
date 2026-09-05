import assert from "node:assert/strict";
import test from "node:test";
import { blockingListingRequirements, inspectListingDraft, setListingDraftValue } from "../lib/channels/listing-preflight";

test("eBay preflight blocks server-managed policy and location placeholders", () => {
  const draft = {
    inventoryItem: { product: { title: "Test item", description: "A real test item", imageUrls: ["https://example.com/item.jpg"] } },
    offer: {
      categoryId: "123",
      availableQuantity: 1,
      pricingSummary: { price: { value: "10", currency: "USD" } },
      listingPolicies: { fulfillmentPolicyId: "SERVER_MANAGED", paymentPolicyId: "SERVER_MANAGED", returnPolicyId: "SERVER_MANAGED" },
      merchantLocationKey: "SERVER_MANAGED",
    },
  };

  assert.deepEqual(
    blockingListingRequirements("ebay", draft).map((item) => item.key),
    ["fulfillment-policy", "payment-policy", "return-policy", "location"],
  );
  const accountFields = inspectListingDraft("ebay", draft).filter((item) => item.manualPath);
  assert.equal(accountFields.length, 4);
  assert.equal(accountFields.every((item) => item.status === "manual"), true);
  assert.equal(accountFields.every((item) => item.placeholder?.startsWith("Seller Hub")), true);

  assert.deepEqual(
    blockingListingRequirements("ebay", draft, "listing.update"),
    [],
    "an UPDATE preserves the exact remote offer policies and location read during provider preflight",
  );
  assert.deepEqual(
    inspectListingDraft("ebay", draft, "listing.update").map((item) => item.key),
    ["title", "description", "images"],
  );
});

test("manual policy input updates only the requested channel payload path", () => {
  const original = { offer: { listingPolicies: { fulfillmentPolicyId: "" } } };
  const updated = setListingDraftValue(original, ["offer", "listingPolicies", "fulfillmentPolicyId"], "policy-123");

  assert.equal((updated.offer as { listingPolicies: { fulfillmentPolicyId: string } }).listingPolicies.fulfillmentPolicyId, "policy-123");
  assert.equal((original.offer as { listingPolicies: { fulfillmentPolicyId: string } }).listingPolicies.fulfillmentPolicyId, "");
});

test("Coupang account fields are explicit runtime checks while unknown product facts block publishing", () => {
  const draft = {
    facts: { manufacturer: "미확인", countryOfOrigin: "대한민국", material: "PP" },
    body: {
      displayCategoryCode: 123,
      sellerProductName: "Storage box",
      brand: "No Brand",
      items: [{ salePrice: 10000, maximumBuyCount: 1, images: [{ vendorPath: "https://example.com/item.jpg" }] }],
    },
  };
  const requirements = inspectListingDraft("coupang", draft);

  assert.equal(requirements.find((item) => item.key === "manufacturer")?.status, "manual");
  assert.equal(requirements.find((item) => item.key === "outbound")?.status, "runtime");
  assert.equal(requirements.find((item) => item.key === "return")?.status, "runtime");
  assert.equal(requirements.find((item) => item.key === "notices")?.status, "manual");
  assert.equal(requirements.find((item) => item.key === "certification")?.status, "runtime");
  assert.equal(requirements.find((item) => item.key === "quantity-attribute")?.status, "runtime");
  assert.deepEqual(requirements.find((item) => item.key === "notices")?.manualPath, ["facts", "noticeContent"]);
  assert.ok(blockingListingRequirements("coupang", draft).some((item) => item.key === "notices"));
});

test("Coupang preflight rejects placeholder notices and accepts seller-confirmed notice content", () => {
  const draft = {
    facts: { manufacturer: "롯데", countryOfOrigin: "대한민국", material: "밀가루" },
    body: {
      displayCategoryCode: 76890,
      sellerProductName: "롯데샌드 쿠키",
      brand: "롯데",
      items: [{
        salePrice: 10000,
        maximumBuyCount: 1,
        images: [{ vendorPath: "https://example.com/cookie.jpg" }],
        notices: [{ noticeCategoryName: "식품", noticeCategoryDetailName: "원재료", content: "상품상세 참조" }],
      }],
    },
  };
  const envelope = JSON.stringify({
    noticeCategoryName: "식품",
    details: {
      제품명: "롯데샌드 쿠키",
      원재료: "밀가루, 설탕, 유지",
    },
  });

  assert.equal(inspectListingDraft("coupang", draft).find((item) => item.key === "notices")?.status, "manual");
  assert.equal(
    inspectListingDraft("coupang", setListingDraftValue(draft, ["facts", "noticeContent"], "밀가루, 설탕, 유지"))
      .find((item) => item.key === "notices")?.status,
    "manual",
  );
  const withFact = setListingDraftValue(draft, ["facts", "noticeContent"], envelope);
  assert.equal(inspectListingDraft("coupang", withFact).find((item) => item.key === "notices")?.status, "ready");
  assert.equal(
    inspectListingDraft("coupang", setListingDraftValue(draft, ["facts", "noticeContent"], "상품상세 참조"))
      .find((item) => item.key === "notices")?.status,
    "manual",
  );
  assert.equal(
    inspectListingDraft("coupang", {
      ...draft,
      body: {
        ...draft.body,
        items: [{
          ...draft.body.items[0],
          notices: [
            { noticeCategoryName: "식품", noticeCategoryDetailName: "제품명", content: "롯데샌드 쿠키" },
            { noticeCategoryName: "식품", noticeCategoryDetailName: "원재료", content: "밀가루, 설탕, 유지" },
          ],
        }],
      },
    }).find((item) => item.key === "notices")?.status,
    "ready",
  );
});

test("zero price and stock are rejected before a write", () => {
  const draft = {
    params: {
      SecondSubCat: "123",
      ItemTitle: "Test",
      ProductionPlaceType: "2",
      ProductionPlace: "대한민국",
      StandardImage: "https://example.com/item.jpg",
      RetailPrice: "0",
      ItemPrice: "0",
      ItemQty: "0",
      ShippingNo: "0",
      AvailableDateType: "0",
      AvailableDateValue: "3",
    },
  };

  assert.deepEqual(
    blockingListingRequirements("qoo10", draft).map((item) => item.key),
    ["price", "stock"],
  );
});

test("Qoo10 UpdateGoods carrier fields are required before create or update preparation", () => {
  const params = {
    SecondSubCat: "320002604",
    ItemTitle: "Test",
    ProductionPlaceType: "2",
    ProductionPlace: "Japan",
    StandardImage: "https://example.com/item.jpg",
    ItemPrice: "1871",
    ItemQty: "1",
    ShippingNo: "0",
  };
  assert.deepEqual(
    blockingListingRequirements("qoo10", { params }, "listing.update").map((item) => item.key),
    ["retail-price", "available-date-type", "available-date-value"],
  );
  assert.deepEqual(
    blockingListingRequirements("qoo10", {
      params: {
        ...params,
        RetailPrice: "0",
        AvailableDateType: "0",
        AvailableDateValue: "3",
      },
    }, "listing.update"),
    [],
  );
  assert.deepEqual(
    blockingListingRequirements("qoo10", {
      params: {
        ...params,
        ProductionPlaceType: "",
        RetailPrice: "0",
        AvailableDateType: "0",
        AvailableDateValue: "3",
      },
    }, "listing.update").map((item) => item.key),
    ["origin-type"],
  );
});

test("Qoo10 unique account fields are editable instead of a dead-end checklist", () => {
  const requirements = inspectListingDraft("qoo10", {
    params: {
      SecondSubCat: "300000536",
      ItemTitle: "洋菓子の販売者確認済み商品",
      ProductionPlaceType: "2",
      ProductionPlace: "KR",
      StandardImage: "https://example.com/item.jpg",
      RetailPrice: "12",
      ItemPrice: "12",
      ItemQty: "1",
      ShippingNo: "0",
      AvailableDateType: "0",
      AvailableDateValue: "3",
    },
  });
  assert.deepEqual(
    requirements.filter((item) => item.manualPath).map((item) => item.key),
    ["title", "shipping", "available-date-type", "available-date-value"],
  );
  assert.equal(requirements.every((item) => item.status === "ready"), true);
});

test("11st processed-food notices stay hidden until that category is selected", () => {
  const cable = inspectListingDraft("elevenst", { product: { dispCtgrNo: "1341821" } });
  assert.equal(cable.some((item) => item.key.startsWith("food-notice-")), false);
  const food = inspectListingDraft("elevenst", {
    product: { dispCtgrNo: "1346631", ProductNotification: { item: [] } },
  });
  assert.equal(food.filter((item) => item.key.startsWith("food-notice-")).length > 0, true);
  assert.equal(food.find((item) => item.key === "food-notice-176398001")?.status, "manual");
});

test("Smartstore preflight exposes the official purchase-age and display-status fields", () => {
  const draft = {
    imageUrls: ["https://example.com/storage.jpg"],
    body: {
      originProduct: {
        leafCategoryId: "50001330",
        name: "[API TEST] 수납함",
        detailContent: "테스트 상세 설명",
        salePrice: 10_000,
        stockQuantity: 1,
        detailAttribute: {
          originAreaInfo: { content: "중국" },
          minorPurchasable: true,
          productInfoProvidedNotice: { productInfoProvidedNoticeType: "ETC" },
        },
      },
      smartstoreChannelProduct: { channelProductDisplayStatusType: "ON" },
    },
  };

  const requirements = inspectListingDraft("smartstore", draft);
  assert.equal(requirements.find((item) => item.key === "minor-purchasable")?.status, "ready");
  assert.equal(requirements.find((item) => item.key === "provided-notice")?.status, "ready");
  assert.equal(requirements.find((item) => item.key === "display-status")?.status, "ready");
  assert.deepEqual(blockingListingRequirements("smartstore", draft), []);
});

test("Temu preflight requires a numeric leaf category and an explicit shipping template", () => {
  const draft = {
    body: {
      goodsBasic: {
        extCatName: "생활 > 정리",
        costTemplate: "",
        goodsName: "부착형 케이블 정리 클립 6개 세트",
        goodsDesc: "케이블 정리 상품의 구성과 사용 방법을 안내합니다.",
        externalGoodsId: "QA-20260823-CC-001",
        goodsCarouselImage: ["https://example.com/hero.jpg"],
      },
      attributes: [
        { name: "Brand", value: ["COUPLIT"] },
        { name: "Manufacturer", value: ["QA manufacturer"] },
        { name: "Country of origin", value: ["China"] },
        { name: "Material", value: ["ABS"] },
      ],
      skuList: [{
        price: { basePrice: { amount: "5000", currency: "KRW" } },
        quantity: 1,
        packageInfo: { weight: "100", length: "10", width: "8", height: "2" },
      }],
    },
  };

  assert.deepEqual(
    blockingListingRequirements("temu", draft).map((item) => item.key),
    ["category", "shipping-template"],
  );
  const withCategory = setListingDraftValue(draft, ["body", "goodsBasic", "extCatName"], "601099");
  const ready = setListingDraftValue(withCategory, ["body", "goodsBasic", "costTemplate"], "QA_KR_STANDARD");
  assert.deepEqual(blockingListingRequirements("temu", ready), []);
});
