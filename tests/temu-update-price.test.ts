import assert from "node:assert/strict";
import test from "node:test";
import { channelCatalog } from "../lib/channels/catalog";
import { executeChannelOperation } from "../lib/channels/operations";

const temuPayload = { app_key: "app-key", app_secret: "app-secret", access_token: "seller-token" };

function updateArguments(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      goodsBasic: {
        externalGoodsId: "TEST-TEMU-UPDATE",
        goodsName: "Update test",
        goodsDesc: "Updated description",
        goodsCarouselImage: ["https://cdn.example.com/hero.jpg"],
        detailImage: ["https://cdn.example.com/detail.jpg"],
      },
      skuList: [{ externalSkuId: "TEST-TEMU-UPDATE" }],
    },
    ...overrides,
  };
}

function priceArguments(overrides: Record<string, unknown> = {}) {
  return {
    goodsId: "900001",
    skuId: "700001",
    price: 12_900,
    ...overrides,
  };
}

test("Temu listing.update sends a full payload to bg.local.goods.update and verifies the detail readback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.local.goods.update") {
      return Response.json({ success: true, result: { goodsId: 900001, productType: 1 } });
    }
    return Response.json({
      success: true,
      result: {
        goodsId: 900001,
        goodsGallery: {
          goodsCarouselImage: ["https://cdn.example.com/hero.jpg"],
          detailImage: ["https://cdn.example.com/detail.jpg"],
        },
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.update",
      payload: temuPayload,
      arguments: updateArguments({ goodsId: "900001" }),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "900001");
    assert.deepEqual(calls.map((call) => call.type), [
      "bg.local.goods.update",
      "bg.local.goods.detail.query",
    ]);
    const updateCall = calls[0];
    assert.equal(updateCall.goodsId, 900001);
    assert.equal((updateCall.goodsBasic as Record<string, unknown>).externalGoodsId, "TEST-TEMU-UPDATE");
    assert.equal((updateCall.goodsBasic as Record<string, unknown>).goodsDesc, "Updated description");
    assert.equal((updateCall.skuList as Array<Record<string, unknown>>).length, 1);
    assert.equal(calls[1].versionQueryType, 1);
    assert.deepEqual(result.steps.map((item) => item.name), ["goods-update", "goods-detail-readback"]);
    assert.equal(result.steps[1].data.sellerpilotVerification, "GOODS_UPDATE_READBACK_VERIFIED");
    assert.equal(result.steps[1].data.actualCarouselImageCount, 1);
    assert.equal(result.steps[1].data.actualDetailImageCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu listing.update always overrides an embedded goodsId with the argument goodsId", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.type === "bg.local.goods.update") {
      return Response.json({ success: true, result: { goodsId: 900002 } });
    }
    return Response.json({
      success: true,
      result: {
        goodsId: 900002,
        goodsGallery: {
          goodsCarouselImage: ["https://cdn.example.com/hero.jpg"],
          detailImage: ["https://cdn.example.com/detail.jpg"],
        },
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.update",
      payload: temuPayload,
      arguments: updateArguments({ goodsId: "900002", body: { ...updateArguments().body, goodsId: "777777" } }),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0].goodsId, 900002);
    assert.equal(calls[1].goodsId, 900002);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu listing.update rejects missing body and non-numeric goodsId", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called for argument validation");
  };
  try {
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "listing.update",
        payload: temuPayload,
        arguments: { goodsId: "900001" },
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_REQUIRED:body/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "listing.update",
        payload: temuPayload,
        arguments: updateArguments({ goodsId: "not-a-number" }),
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:goodsId/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu listing.update fails closed when the provider rejects the write", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(String(body.type));
    if (body.type === "bg.local.goods.update") {
      return Response.json({ success: false, errorCode: 150010188, errorMsg: "The mall and goods not match." });
    }
    throw new Error("readback must not run after a failed write");
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.update",
      payload: temuPayload,
      arguments: updateArguments({ goodsId: "900001" }),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, "900001");
    assert.deepEqual(calls, ["bg.local.goods.update"]);
    assert.equal(result.steps[0].name, "goods-update");
    assert.equal(result.steps[0].ok, false);
    assert.match(result.safeMessage, /mall and goods not match/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu listing.update fails closed when the detail readback does not match", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "bg.local.goods.update") {
      return Response.json({ success: true, result: { goodsId: 900001 } });
    }
    return Response.json({
      success: true,
      result: {
        goodsId: 900001,
        goodsGallery: {
          goodsCarouselImage: ["https://cdn.example.com/hero.jpg"],
          detailImage: [],
        },
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "listing.update",
      payload: temuPayload,
      arguments: updateArguments({
        goodsId: "900001",
        body: {
          ...updateArguments().body,
          goodsBasic: {
            ...(updateArguments().body.goodsBasic as Record<string, unknown>),
            detailImage: ["https://cdn.example.com/detail-1.jpg", "https://cdn.example.com/detail-2.jpg"],
          },
        },
      }),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[1].name, "goods-detail-readback");
    assert.equal(result.steps[1].data.sellerpilotVerification, "TEMU_UPDATE_READBACK_MISSING");
    assert.equal(result.steps[1].data.expectedDetailImageCount, 2);
    assert.equal(result.steps[1].data.actualDetailImageCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu price.update changes the SKU base price via the price management API", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return Response.json({
      success: true,
      result: {
        successSkuList: [700001],
        failedSkuList: [],
        failedSkuReasonMap: {},
        successPriceOrderList: [{ skuIdList: [700001], priceOrderSn: "PO-1" }],
      },
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "price.update",
      payload: temuPayload,
      arguments: priceArguments({ currency: "KRW", reason: "SellerPilot price sync", rejectSkuPricing: true }),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "900001");
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.type, "bg.local.goods.priceorder.change.sku.price");
    assert.equal(call.goodsId, 900001);
    assert.equal(call.rejectSkuPricing, true);
    assert.deepEqual(call.changeSkuPriceDTOList, [
      {
        reason: "SellerPilot price sync",
        skuChangePriceBaseDTOList: [
          { skuId: 700001, newSupplierPrice: { amount: "12900", currency: "KRW" } },
        ],
      },
    ]);
    assert.equal(result.steps[0].name, "goods-price");
    assert.equal(result.steps[0].data.sellerpilotVerification, "SKU_PRICE_VERIFIED");
    assert.deepEqual(result.steps[0].data.remoteSuccessSkuList, ["700001"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu price.update defaults the currency to KRW and omits optional flags", async () => {
  const originalFetch = globalThis.fetch;
  let call: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    call = body;
    return Response.json({ success: true, result: { successSkuList: [700001], failedSkuList: [], failedSkuReasonMap: {} } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "price.update",
      payload: temuPayload,
      arguments: priceArguments(),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal("rejectSkuPricing" in call, false);
    assert.deepEqual(call.changeSkuPriceDTOList, [
      {
        skuChangePriceBaseDTOList: [
          { skuId: 700001, newSupplierPrice: { amount: "12900", currency: "KRW" } },
        ],
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu price.update treats an unchanged price as an idempotent success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    result: {
      successSkuList: [],
      failedSkuList: [700001],
      failedSkuReasonMap: { 700001: "Skc/Sku supply price has not changed" },
    },
  });
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "price.update",
      payload: temuPayload,
      arguments: priceArguments(),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.steps[0].data.sellerpilotVerification, "SKU_PRICE_VERIFIED");
    assert.deepEqual(result.steps[0].data.remoteFailedSkuList, ["700001"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu price.update fails closed when the provider rejects the SKU", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    result: {
      successSkuList: [],
      failedSkuList: [700001],
      failedSkuReasonMap: { 700001: "Sku has unfinished price order" },
    },
  });
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "price.update",
      payload: temuPayload,
      arguments: priceArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0].data.sellerpilotVerification, "TEMU_SKU_PRICE_REJECTED");
    assert.match(result.safeMessage, /unfinished price order/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu price.update fails closed on provider errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    errorCode: 150011101,
    errorMsg: "The price change in this request exceeds the allowed range.",
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await executeChannelOperation({
      channel: "temu",
      operation: "price.update",
      payload: temuPayload,
      arguments: priceArguments(),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0].ok, false);
    assert.match(result.safeMessage, /exceeds the allowed range/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu price.update rejects invalid arguments before any network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called for argument validation");
  };
  try {
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "price.update",
        payload: temuPayload,
        arguments: { skuId: "700001", price: 12_900 },
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:goodsId/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "price.update",
        payload: temuPayload,
        arguments: { goodsId: "900001", price: 12_900 },
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:skuId/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "price.update",
        payload: temuPayload,
        arguments: { goodsId: "900001", skuId: "700001", price: 0 },
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:price/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "price.update",
        payload: temuPayload,
        arguments: { goodsId: "abc", skuId: "700001", price: 12_900 },
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:goodsId/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Temu update capabilities pass the support gate while unsupported operations stay blocked", async () => {
  assert.equal(channelCatalog.temu.capabilities.listingUpdate.mode, "api");
  assert.equal(channelCatalog.temu.capabilities.price.mode, "api");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called for the gate check");
  };
  try {
    // The gate passes and validation runs, which proves the operation is supported.
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "price.update",
        payload: temuPayload,
        arguments: {},
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:goodsId/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "listing.update",
        payload: temuPayload,
        arguments: {},
        environment: "production",
      }),
      /CHANNEL_ARGUMENT_INVALID:goodsId/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "temu",
        operation: "inquiries.reply",
        payload: temuPayload,
        arguments: {},
        environment: "production",
      }),
      /CHANNEL_OPERATION_UNSUPPORTED:inquiries.reply/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
