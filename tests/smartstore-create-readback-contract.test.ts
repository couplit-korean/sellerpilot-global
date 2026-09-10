import assert from "node:assert/strict";
import test from "node:test";

import {
  smartstoreCreateExactReadbackContract,
  smartstoreCreateExactReadbackGroups,
  verifySmartstoreCreateExactReadback,
} from "../lib/channels/smartstore-create-readback-contract";

function body() {
  return {
    originProduct: {
      statusType: "SALE",
      saleType: "NEW",
      leafCategoryId: "50022679",
      name: "exact readback fixture",
      salePrice: 10_000,
      stockQuantity: 1,
      deliveryInfo: {
        deliveryType: "DELIVERY",
        claimDeliveryInfo: {
          shippingAddressId: 123,
          returnAddressId: 456,
          returnDeliveryFee: 3_000,
          exchangeDeliveryFee: 6_000,
        },
      },
      images: {
        representativeImage: { url: "https://shop-phinf.pstatic.net/r.jpg" },
        optionalImages: [{ url: "https://shop-phinf.pstatic.net/d.jpg" }],
      },
      detailContent: '<img src="https://shop-phinf.pstatic.net/d.jpg" />',
      detailAttribute: {
        sellerCodeInfo: { sellerManagementCode: "SP-EXACT-001" },
        optionInfo: {
          optionCombinations: [
            { id: 101, stockQuantity: 2, price: 0, usable: true },
          ],
        },
        unitCapacity: { unitPriceYn: false },
        certificationTargetExcludeContent: {
          childCertifiedProductExclusionYn: true,
        },
        productAttributes: [
          { attributeSeq: 2, attributeValueSeq: 20 },
          { attributeSeq: 1, attributeValueSeq: 10 },
        ],
        naverShoppingSearchInfo: { brandName: "SellerPilot" },
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: "ETC",
          etc: { manufacturer: "SellerPilot" },
        },
        originAreaInfo: { originAreaCode: "04", content: "대한민국" },
        afterServiceInfo: {
          afterServiceTelephoneNumber: "02-1234-5678",
          afterServiceGuideContent: "판매자 안내",
        },
      },
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductName: "exact readback fixture",
      channelProductDisplayStatusType: "ON",
    },
  };
}

test("receipt binds all completion groups and ignores provider-only response fields", () => {
  const expected = body();
  const origin = structuredClone(expected.originProduct) as Record<string, unknown>;
  origin.statusType = "WAIT";
  origin.providerOnly = "ignored";
  const detail = origin.detailAttribute as {
    productAttributes: Array<Record<string, unknown>>;
  };
  detail.productAttributes.reverse();
  detail.productAttributes[0].providerOnly = true;
  const channel = {
    ...structuredClone(expected.smartstoreChannelProduct),
    channelProductDisplayStatusType: "WAIT",
    channelProductNo: 20000001,
  };
  const receipt = verifySmartstoreCreateExactReadback({
    expectedBody: expected,
    originReadback: { originProduct: origin },
    channelReadback: { smartstoreChannelProduct: channel },
    originProductNo: "10000001",
    channelProductNo: "20000001",
  });
  assert.equal(receipt.contract, smartstoreCreateExactReadbackContract);
  assert.equal(receipt.verified, true);
  assert.deepEqual(receipt.verifiedGroups, smartstoreCreateExactReadbackGroups);
  assert.deepEqual(receipt.mismatchGroups, []);
  assert.equal(receipt.expectedProjectionSha256, receipt.officialProjectionSha256);
});

test("missing official field is a mismatch and the expected body stays immutable", () => {
  const expected = body();
  const before = structuredClone(expected);
  const origin = structuredClone(expected.originProduct);
  delete origin.deliveryInfo.claimDeliveryInfo.returnAddressId;
  const receipt = verifySmartstoreCreateExactReadback({
    expectedBody: expected,
    originReadback: { originProduct: origin },
    channelReadback: {
      smartstoreChannelProduct: structuredClone(expected.smartstoreChannelProduct),
    },
    originProductNo: "10000001",
    channelProductNo: "20000001",
  });
  assert.equal(receipt.verified, false);
  assert.deepEqual(receipt.mismatchGroups, ["shippingAndReturns"]);
  assert.notEqual(receipt.expectedProjectionSha256, receipt.officialProjectionSha256);
  assert.deepEqual(expected, before);
});

test("option identity, price and stock drift fail the exact official readback", () => {
  const expected = body();
  const origin = structuredClone(expected.originProduct);
  origin.detailAttribute.optionInfo.optionCombinations[0].stockQuantity = 999;
  const receipt = verifySmartstoreCreateExactReadback({
    expectedBody: expected,
    originReadback: { originProduct: origin },
    channelReadback: {
      smartstoreChannelProduct: structuredClone(expected.smartstoreChannelProduct),
    },
    originProductNo: "10000001",
    channelProductNo: "20000001",
  });
  assert.equal(receipt.verified, false);
  assert.deepEqual(receipt.mismatchGroups, ["categoryAndAttributes"]);
});
