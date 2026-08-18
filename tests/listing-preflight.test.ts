import assert from "node:assert/strict";
import test from "node:test";
import { blockingListingRequirements, inspectListingDraft, setListingDraftValue } from "../lib/channels/listing-preflight";

test("eBay preflight exposes account auto-lookup fields with manual override paths", () => {
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

  assert.deepEqual(blockingListingRequirements("ebay", draft), []);
  const accountFields = inspectListingDraft("ebay", draft).filter((item) => item.manualPath);
  assert.equal(accountFields.length, 4);
  assert.equal(accountFields.every((item) => item.status === "runtime"), true);
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
});

test("zero price and stock are rejected before a write", () => {
  const draft = {
    params: {
      SecondSubCat: "123",
      ItemTitle: "Test",
      ProductionPlace: "대한민국",
      StandardImage: "https://example.com/item.jpg",
      ItemPrice: "0",
      ItemQty: "0",
      ShippingNo: "0",
    },
  };

  assert.deepEqual(
    blockingListingRequirements("qoo10", draft).map((item) => item.key),
    ["price", "stock"],
  );
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
