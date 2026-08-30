import assert from "node:assert/strict";
import test from "node:test";
import { coupangListingUpdateWrite } from "../lib/channels/coupang-listing-update";
import { executeChannelOperation } from "../lib/channels/operations";

const existingNotices = [{
  noticeCategoryName: "기타 재화",
  noticeCategoryDetailName: "품명 및 모델명",
  content: "부착형 케이블 정리 클립 6개 세트",
}];

function currentProduct() {
  return {
    sellerProductId: 987654321,
    sellerProductName: "기존 상품",
    deliveryChargeType: "CONDITIONAL_FREE",
    items: [{
      vendorItemId: 4444,
      externalVendorSku: "SKU-1",
      itemName: "기존 옵션",
      notices: structuredClone(existingNotices),
    }],
  };
}

test("Coupang full-document update treats an empty notice draft as preserve, not delete", () => {
  const update = coupangListingUpdateWrite(currentProduct(), {
    sellerProductId: 987654321,
    sellerProductName: "수정 상품",
    items: [{
      sellerpilotItemMatchId: "SKU-1",
      itemName: "수정 옵션",
      notices: [],
    }],
  });

  assert.deepEqual(update.body.items[0].notices, existingNotices);
  assert.deepEqual(update.effectivePatch.items[0], {
    sellerpilotItemMatchId: "SKU-1",
    itemName: "수정 옵션",
  });
});

test("Coupang notice preservation fails closed without a trusted non-empty GET value", () => {
  const current = currentProduct();
  current.items[0].notices = [];
  assert.throws(
    () => coupangListingUpdateWrite(current, {
      sellerProductId: 987654321,
      items: [{ sellerpilotItemMatchId: "SKU-1", notices: [] }],
    }),
    /COUPANG_EXISTING_NOTICES_REQUIRED/,
  );
  assert.throws(
    () => coupangListingUpdateWrite(currentProduct(), {
      sellerProductId: 987654321,
      items: [{ sellerpilotItemMatchId: "SKU-1", notices: null }],
    }),
    /COUPANG_NOTICE_PATCH_INVALID/,
  );
});

test("Coupang executor proves GET-before-PUT and preserves notices in the transmitted body", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let readCount = 0;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.method === "PUT") {
      return Response.json({ code: "SUCCESS", data: null });
    }
    readCount += 1;
    const product = currentProduct();
    product.sellerProductName = readCount === 1 ? "기존 상품" : "수정 상품";
    product.items[0].itemName = readCount === 1 ? "기존 옵션" : "수정 옵션";
    return Response.json({ code: "SUCCESS", data: product });
  };

  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "listing.update",
      payload: {
        vendor_id: "A00012345",
        access_key: "access",
        secret_key: "secret",
        requested_by: "wing-user",
      },
      arguments: {
        body: {
          sellerProductId: 987654321,
          sellerProductName: "수정 상품",
          items: [{
            sellerpilotItemMatchId: "SKU-1",
            itemName: "수정 옵션",
            notices: [],
          }],
        },
      },
      environment: "production",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.init?.method), ["GET", "PUT", "GET"]);
    const transmitted = JSON.parse(String(calls[1].init?.body));
    assert.deepEqual(transmitted.items[0].notices, existingNotices);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
